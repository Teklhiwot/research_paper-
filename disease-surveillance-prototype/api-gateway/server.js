const express = require('express');
const app = express();

app.get('/', (_req, res) => {
  res.json({ service: 'api-gateway', status: 'ok' });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`API gateway listening on port ${port}`);
  });
}

module.exports = app;
