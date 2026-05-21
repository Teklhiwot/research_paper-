const express = require('express');
const app = express();

app.get('/', (_req, res) => {
  res.json({ service: 'api-gateway', status: 'ok' });
});

module.exports = app;
