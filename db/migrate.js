const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

function useMockDb() {
  const v = process.env.USE_MOCK_DB;
  return v === '1' || /^true$/i.test(String(v || '')) || /^yes$/i.test(String(v || ''));
}

if (useMockDb()) {
  console.log('[migrate] USE_MOCK_DB is enabled. Skipping SQL migration.');
  process.exit(0);
}

const db = require('../src/db');

function splitSqlStatements(sql) {
  // Keeps simple SQL migration support; current init.sql does not require advanced parser rules.
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function migrate() {
  const initSqlPath = path.join(__dirname, 'init.sql');
  const rawSql = fs.readFileSync(initSqlPath, 'utf8');
  const statements = splitSqlStatements(rawSql);

  for (const statement of statements) {
    await db.query(`${statement};`);
  }

  console.log(`[migrate] Applied ${statements.length} SQL statements from db/init.sql`);
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[migrate] Migration failed:', error);
    process.exit(1);
  });
