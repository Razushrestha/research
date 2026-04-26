require('dotenv').config();

function useMockDb() {
  const v = process.env.USE_MOCK_DB;
  return v === '1' || /^true$/i.test(String(v || '')) || /^yes$/i.test(String(v || ''));
}

if (!useMockDb() && !process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required in .env (or set USE_MOCK_DB=true for API testing without Postgres)');
  process.exit(1);
}

const createApp = require('./src/app');

const app = createApp();
const port = Number(process.env.PORT) || 4000;

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
