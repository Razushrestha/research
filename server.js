require('dotenv').config();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required in .env');
  process.exit(1);
}

const createApp = require('./src/app');

const app = createApp();
const port = Number(process.env.PORT) || 4000;

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
