const fs = require('fs');
const { Pool } = require('pg');

// PostgreSQL invalid_password code - what a rotated-out credential looks
// like when Secrets Manager has issued a new one but this process is still
// holding the old one.
const INVALID_PASSWORD = '28P01';

// RDS requires SSL and rejects plaintext connections outright (surfaces as
// "no pg_hba.conf entry ... no encryption"). Once SSL is on, Node's default
// trusted CA list doesn't include Amazon's RDS CA, so an unverified `ssl:
// true`/PGSSLMODE=require connection fails differently
// (SELF_SIGNED_CERT_IN_CHAIN) - and PGSSLMODE=no-verify "fixes" that by
// disabling validation entirely, which isn't acceptable long-term.
// DB_SSL_CA_PATH, when set, resolves both in one step: it turns SSL on
// *and* points node-postgres at a CA bundle it can validate the RDS
// certificate against (rejectUnauthorized: true). When unset, no `ssl` key
// is added to the pg config at all - node-postgres's own env-var fallback
// (PGSSLMODE, if some other process sets it) is untouched either way, and
// a plain local Postgres with no TLS support (docker compose) keeps working
// exactly as before.
function buildSslOption() {
  const caPath = process.env.DB_SSL_CA_PATH;
  if (!caPath) return undefined;

  let ca;
  try {
    ca = fs.readFileSync(caPath);
  } catch (err) {
    throw new Error(
      `DB_SSL_CA_PATH is set to "${caPath}" but that file could not be read ` +
      `(${err.code || err.message}). The Dockerfile writes the RDS global CA ` +
      'bundle to /app/certs/rds-ca-bundle.pem - confirm the path matches that.'
    );
  }
  return { rejectUnauthorized: true, ca };
}

let cachedCredentials = null;
let secretsClient = null; // only ever constructed if DB_SECRET_ARN is set

function usesSecretsManager() {
  return Boolean(process.env.DB_SECRET_ARN);
}

// The AWS SDK is required lazily, inside this branch, so that when
// DB_SECRET_ARN is unset (local/no-AWS testing) the module is never even
// loaded and no AWS call can be attempted.
async function fetchSecret() {
  if (!usesSecretsManager()) {
    return {
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    };
  }

  if (!secretsClient) {
    const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
    secretsClient = {
      client: new SecretsManagerClient({}),
      GetSecretValueCommand,
    };
  }

  const { client, GetSecretValueCommand } = secretsClient;
  const result = await client.send(new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN }));
  const parsed = JSON.parse(result.SecretString);
  return { username: parsed.username, password: parsed.password };
}

async function getCredentials(forceRefresh) {
  if (!cachedCredentials || forceRefresh) {
    cachedCredentials = await fetchSecret();
  }
  return cachedCredentials;
}

function makePool(host, creds) {
  const ssl = buildSslOption();
  return new Pool({
    host,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: creds.username,
    password: creds.password,
    // Spread so the key is entirely absent (not even `ssl: undefined`) when
    // DB_SSL_CA_PATH is unset - see buildSslOption() above.
    ...(ssl ? { ssl } : {}),
  });
}

const state = {
  primaryPool: null,
  readPool: null,
};

async function rebuildPools(forceRefresh) {
  const creds = await getCredentials(forceRefresh);
  const oldPrimary = state.primaryPool;
  const oldRead = state.readPool;

  state.primaryPool = makePool(process.env.DB_HOST, creds);

  const roHost = process.env.DB_HOST_RO;
  state.readPool = roHost ? makePool(roHost, creds) : state.primaryPool;

  // Close the pools this replaced, but never close a pool object that's
  // still in active use under a different name (e.g. readPool aliasing
  // primaryPool when DB_HOST_RO is unset).
  if (oldPrimary && oldPrimary !== state.primaryPool && oldPrimary !== state.readPool) {
    oldPrimary.end().catch(() => {});
  }
  if (oldRead && oldRead !== state.readPool && oldRead !== state.primaryPool && oldRead !== oldPrimary) {
    oldRead.end().catch(() => {});
  }
}

async function init() {
  await rebuildPools(false);
}

async function runWithRetry(role, text, params) {
  const pool = () => (role === 'read' ? state.readPool : state.primaryPool);
  try {
    return await pool().query(text, params);
  } catch (err) {
    if (err && err.code === INVALID_PASSWORD) {
      console.error(`[db] credential rejected (${INVALID_PASSWORD}) on ${role} pool - re-fetching secret and rebuilding pools`);
      await rebuildPools(true);
      return await pool().query(text, params);
    }
    throw err;
  }
}

// Writes and migrations - always the primary pool.
function query(text, params) {
  return runWithRetry('primary', text, params);
}

// Read-only routes - the replica pool if DB_HOST_RO is set, otherwise the
// same primary pool.
function queryRead(text, params) {
  return runWithRetry('read', text, params);
}

function getPool() {
  return state.primaryPool;
}

async function end() {
  const pools = new Set([state.primaryPool, state.readPool].filter(Boolean));
  await Promise.all(Array.from(pools).map((p) => p.end()));
}

module.exports = { init, query, queryRead, getPool, end, usesSecretsManager };
