const { Pool } = require('pg');

let pool = null;

function normalizeEnvValue(value) {
  return String(value || '').replace(/(?:\r|\n|\\r|\\n)+$/g, '').trim();
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getDatabaseUrl() {
  return normalizeEnvValue(process.env.DATABASE_URL);
}

function hasDatabaseConnection() {
  return Boolean(getDatabaseUrl());
}

function getClientConfig() {
  if (!hasDatabaseConnection()) {
    throw new Error('DATABASE_URL is not configured.');
  }

  const connectionString = getDatabaseUrl()
    .replace(/\?sslmode=require$/i, '')
    // Supabase's session-mode pooler on 5432 is fragile for serverless bursts.
    // Prefer the transaction pooler on 6543 when a pooler host is detected.
    .replace(/(@[^/]*pooler\.supabase\.com):5432\//i, '$1:6543/');

  return {
    connectionString,
    statement_timeout: parsePositiveInteger(process.env.PG_STATEMENT_TIMEOUT_MS, 15000),
    query_timeout: parsePositiveInteger(process.env.PG_QUERY_TIMEOUT_MS, 15000),
    connectionTimeoutMillis: parsePositiveInteger(process.env.PG_CONNECTION_TIMEOUT_MS, 5000),
    max: parsePositiveInteger(process.env.PG_POOL_MAX, 3),
    idleTimeoutMillis: parsePositiveInteger(process.env.PG_IDLE_TIMEOUT_MS, 10000),
    maxUses: parsePositiveInteger(process.env.PG_MAX_USES, 7500),
    ssl: connectionString.includes('supabase.co')
      ? { rejectUnauthorized: false }
      : undefined
  };
}

function getPool() {
  if (!pool) {
    pool = new Pool(getClientConfig());
    pool.on('error', () => {
      // Drop the shared pool if it enters a bad state so the next request can recreate it.
      pool = null;
    });
  }

  return pool;
}

async function withClient(callback) {
  const client = await getPool().connect();

  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

async function query(text, params = []) {
  return getPool().query(text, params);
}

async function withTransaction(callback) {
  return withClient(async (client) => {
    await client.query('begin');

    try {
      const result = await callback(client);
      await client.query('commit');
      return result;
    } catch (error) {
      try {
        await client.query('rollback');
      } catch (rollbackError) {
        // Keep the original error as the primary failure.
      }
      throw error;
    }
  });
}

async function closePool() {
  if (!pool) {
    return;
  }

  const existingPool = pool;
  pool = null;
  await existingPool.end().catch(() => {});
}

module.exports = {
  closePool,
  getDatabaseUrl,
  getPool,
  hasDatabaseConnection,
  query,
  withTransaction
};
