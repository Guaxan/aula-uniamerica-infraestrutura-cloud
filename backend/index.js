const express = require('express');
const cors = require('cors');
const serverless = require('serverless-http');
const { randomUUID } = require('crypto');
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

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

// Rota para obter todas as tarefas (GET)
app.get('/todos', async (req, res) => {
  try {
    const { Items } = await db.send(new ScanCommand({ TableName: TABLE }));
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
    await db.send(new PutCommand({ TableName: TABLE, Item: todo }));
    res.status(201).json(todo);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Rota para marcar uma tarefa como concluída (PATCH)
app.patch('/todos/:id', async (req, res) => {
  const Key = { _id: req.params.id };

  try {
    const { Item } = await db.send(new GetCommand({ TableName: TABLE, Key }));

    if (!Item) {
      return res.status(404).json({ message: 'Tarefa não encontrada' });
    }

    const { Attributes } = await db.send(new UpdateCommand({
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
    const { Attributes } = await db.send(new DeleteCommand({
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

module.exports.handler = serverless(app);