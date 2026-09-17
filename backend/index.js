const express = require('express');
const cors = require('cors');
const serverless = require('serverless-http');
const { randomUUID } = require('crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');

const TABLE = process.env.TODOS_TABLE || 'todos';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://app.largou.com.br';
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// ---------------------------------------------------------------
// Observabilidade
// ---------------------------------------------------------------

// Guarda o request_id da requisição em curso, acessível de qualquer camada
// (inclusive dentro das chamadas ao banco) sem passar parâmetro em toda rota.
const obsCtx = new AsyncLocalStorage();

function logJson(fields) {
  const store = obsCtx.getStore();
  // Um objeto por registro. Nunca incluir senha, token ou string de conexão.
  console.log({
    timestamp: new Date().toISOString(),
    service: 'app-backend',
    request_id: store?.requestId ?? null,
    ...fields,
  });
}

// Envolve toda chamada ao DynamoDB, medindo duração e resultado.
async function send(operation, command) {
  const t0 = Date.now();
  try {
    const out = await db.send(command);
    logJson({
      level: 'INFO',
      event: 'dynamodb_call',
      operation,
      table: TABLE,
      duration_ms: Date.now() - t0,
      success: true,
    });
    return out;
  } catch (err) {
    logJson({
      level: 'ERROR',
      event: 'dynamodb_call',
      operation,
      table: TABLE,
      duration_ms: Date.now() - t0,
      success: false,
      error_type: err.name,
      error_message: err.message,
    });
    throw err;
  }
}

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

// Abre o contexto da requisição e registra o resultado quando a resposta fecha.
app.use((req, res, next) => {
  const t0 = Date.now();
  const requestId = req.awsRequestId || randomUUID();

  res.on('finish', () => {
    // req.route só existe depois que uma rota casa; em 404 usamos req.path
    // para não gravar rota vazia.
    const route = req.route ? req.baseUrl + req.route.path : req.path;
    logJson({
      request_id: requestId,
      level: res.statusCode >= 500 ? 'ERROR' : 'INFO',
      event: 'request_completed',
      http_method: req.method,
      route,
      status_code: res.statusCode,
      duration_ms: Date.now() - t0,
    });
  });

  obsCtx.run({ requestId }, next);
});

// ---------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------

// Rota para obter todas as tarefas (GET)
app.get('/todos', async (req, res) => {
  try {
    const { Items } = await send('scan', new ScanCommand({ TableName: TABLE }));
    res.json(Items ?? []);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Rota para adicionar uma nova tarefa (POST)
app.post('/todos', async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ message: 'O campo "text" é obrigatório' });
  }

  const todo = { _id: randomUUID(), text, completed: false };

  try {
    await send('put', new PutCommand({ TableName: TABLE, Item: todo }));
    res.status(201).json(todo);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Rota para marcar uma tarefa como concluída (PATCH)
app.patch('/todos/:id', async (req, res) => {
  const Key = { _id: req.params.id };

  try {
    const { Item } = await send('get', new GetCommand({ TableName: TABLE, Key }));

    if (!Item) {
      return res.status(404).json({ message: 'Tarefa não encontrada' });
    }

    const { Attributes } = await send('update', new UpdateCommand({
      TableName: TABLE,
      Key,
      UpdateExpression: 'SET #c = :c',
      ExpressionAttributeNames: { '#c': 'completed' },
      ExpressionAttributeValues: { ':c': !Item.completed },
      ReturnValues: 'ALL_NEW',
    }));

    res.json(Attributes);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Rota para excluir a tarefa (DELETE)
app.delete('/todos/:id', async (req, res) => {
  try {
    const { Attributes } = await send('delete', new DeleteCommand({
      TableName: TABLE,
      Key: { _id: req.params.id },
      ReturnValues: 'ALL_OLD',
    }));

    if (!Attributes) {
      return res.status(404).json({ message: 'Tarefa não encontrada' });
    }

    res.json({ message: 'Tarefa excluída com sucesso' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Traz o awsRequestId do Lambda para dentro do Express, para correlacionar
// o log de aplicação com o log do próprio runtime.
module.exports.handler = serverless(app, {
  request(req, event, context) {
    req.awsRequestId = context.awsRequestId;
  },
});
