require('./src/db');
const createApp = require('./src/app');

const app = createApp();
const port = Number(process.env.PORT) || 4000;

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
