const dotenv = require('dotenv');

dotenv.config();

function useMockDb() {
  const v = process.env.USE_MOCK_DB;
  return v === '1' || /^true$/i.test(String(v || '')) || /^yes$/i.test(String(v || ''));
}

if (useMockDb()) {
  const { createMemoryDb } = require('./memoryDb');
  console.warn('[db] USE_MOCK_DB: in-memory database (not for production; data resets on cold start).');
  module.exports = createMemoryDb();
} else {
  const { Pool } = require('pg');

  let pool;

  function getPool() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required in .env (or set USE_MOCK_DB=true for testing)');
    }
    if (!pool) {
      pool = new Pool({ connectionString });
    }
    return pool;
  }

  module.exports = {
    query: (text, params) => getPool().query(text, params),
    get pool() {
      return getPool();
    },
  };
}
