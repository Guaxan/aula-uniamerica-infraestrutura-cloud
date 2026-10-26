const os = require('os');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const { AsyncLocalStorage } = require('node:async_hooks');

// Configuração vem do ConfigMap (PORT, CORS_ORIGIN) e do Secret (MONGO_URI).
const PORT = process.env.PORT || 5000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const MONGO_URI = process.env.MONGO_URI;
// Nome do Pod que atende a requisição — usado para demonstrar o balanceamento.
const POD_NAME = process.env.POD_NAME || os.hostname();

if (!MONGO_URI) {
  console.error('MONGO_URI não definida');
  process.exit(1);
}

const Todo = mongoose.model('Todo', new mongoose.Schema({
  text: { type: String, required: true },
  completed: { type: Boolean, default: false },
}));

// ---------------------------------------------------------------
// Observabilidade
// ---------------------------------------------------------------

// Guarda o request_id da requisição em curso, acessível de qualquer camada
// (inclusive dentro das chamadas ao banco) sem passar parâmetro em toda rota.
const obsCtx = new AsyncLocalStorage();

function logJson(fields) {
  const store = obsCtx.getStore();
  // Um objeto por linha. Nunca incluir senha, token ou string de conexão.
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    service: 'app-backend',
    pod: POD_NAME,
    request_id: store?.requestId ?? null,
    ...fields,
  }));
}

// Envolve toda chamada ao MongoDB, medindo duração e resultado.
async function send(operation, fn) {
  const t0 = Date.now();
  try {
    const out = await fn();
    logJson({
      level: 'INFO',
      event: 'db_call',
      operation,
      collection: 'todos',
      duration_ms: Date.now() - t0,
      success: true,
    });
    return out;
  } catch (err) {
    logJson({
      level: 'ERROR',
      event: 'db_call',
      operation,
      collection: 'todos',
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

// Toda resposta informa qual Pod a atendeu.
app.use((req, res, next) => {
  res.set('X-Served-By', POD_NAME);
  next();
});

// Probes do Kubernetes: ficam fora do middleware de log para não poluí-lo.
app.get('/health', (req, res) => {
  const dbOk = mongoose.connection.readyState === 1;
  res.status(dbOk ? 200 : 503).json({ status: dbOk ? 'ok' : 'db_unavailable', pod: POD_NAME });
});

// Abre o contexto da requisição e registra o resultado quando a resposta fecha.
app.use((req, res, next) => {
  const t0 = Date.now();
  const requestId = req.get('x-request-id') || randomUUID();

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

// Mostra qual Pod respondeu — usado na demonstração do balanceamento.
app.get('/whoami', (req, res) => {
  res.json({ pod: POD_NAME });
});

// Rota para obter todas as tarefas (GET)
app.get('/todos', async (req, res) => {
  try {
    const todos = await send('find', () => Todo.find());
    res.json(todos);
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

  try {
    const todo = await send('insert', () => Todo.create({ text }));
    res.status(201).json(todo);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Rota para marcar uma tarefa como concluída (PATCH)
app.patch('/todos/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ message: 'Tarefa não encontrada' });
  }

  try {
    const todo = await send('find_one', () => Todo.findById(req.params.id));

    if (!todo) {
      return res.status(404).json({ message: 'Tarefa não encontrada' });
    }

    todo.completed = !todo.completed;
    await send('update', () => todo.save());
    res.json(todo);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Rota para excluir a tarefa (DELETE)
app.delete('/todos/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ message: 'Tarefa não encontrada' });
  }

  try {
    const todo = await send('delete', () => Todo.findByIdAndDelete(req.params.id));

    if (!todo) {
      return res.status(404).json({ message: 'Tarefa não encontrada' });
    }

    res.json({ message: 'Tarefa excluída com sucesso' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------

// O servidor sobe mesmo sem banco; o /health devolve 503 até a conexão
// existir, e o Kubernetes só manda tráfego quando a readinessProbe passar.
mongoose.connection.on('connected', () => logJson({ level: 'INFO', event: 'db_connected' }));
mongoose.connection.on('disconnected', () => logJson({ level: 'ERROR', event: 'db_disconnected' }));

async function connectWithRetry() {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  } catch (err) {
    logJson({ level: 'ERROR', event: 'db_connect_failed', error_type: err.name });
    setTimeout(connectWithRetry, 5000);
  }
}

const server = app.listen(PORT, () => {
  logJson({ level: 'INFO', event: 'server_started', port: Number(PORT) });
  connectWithRetry();
});

// O Kubernetes envia SIGTERM antes de remover o Pod.
process.on('SIGTERM', () => {
  logJson({ level: 'INFO', event: 'shutdown' });
  server.close(() => mongoose.disconnect().then(() => process.exit(0)));
});
