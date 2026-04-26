const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

let pool;

function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required in .env');
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
