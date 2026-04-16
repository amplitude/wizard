const express = require('express');

const app = express();
const port = process.env.PORT || 3000;

app.get('/', (_req, res) => {
  res.send('JavaScript Node Test App');
});

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
