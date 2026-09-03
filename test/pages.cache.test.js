// Exercises src/routes/pages.js directly, not src/server.js: server.js calls
// main() unconditionally at import time (db.init(), server.listen(), ...),
// which would need a live DB and a real port. The page-cache behaviour lives
// entirely in the router module, so a minimal express app is enough here -
// same /static mount as server.js (see server.js's own comment on maxAge/
// immutable), just without helmet/rate-limit/db, which this test never
// exercises.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const { baseUrlMiddleware } = require('../src/lib/baseUrl');

const PAGES_ROUTER_PATH = require.resolve('../src/routes/pages');
const STATIC_DIR = path.join(__dirname, '..', 'src', 'public');
const VIEWS_DIR = path.join(__dirname, '..', 'src', 'views');

// PAGE_CACHE_MAX_AGE is read once, at module load, by src/routes/pages.js -
// so each case needs a fresh module instance loaded under its own env value,
// not the one cached from a previous require() in this same test run.
function loadRouterWith(envValue) {
  delete require.cache[PAGES_ROUTER_PATH];
  if (envValue === undefined) {
    delete process.env.PAGE_CACHE_MAX_AGE;
  } else {
    process.env.PAGE_CACHE_MAX_AGE = envValue;
  }
  return require(PAGES_ROUTER_PATH);
}

function buildApp(envValue) {
  const router = loadRouterWith(envValue);
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', VIEWS_DIR);
  app.use(baseUrlMiddleware);
  app.use('/static', express.static(STATIC_DIR, { maxAge: '1y', immutable: true }));
  app.use('/', router);
  return app;
}

async function withServer(app, run) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('PAGE_CACHE_MAX_AGE unset -> no Cache-Control header on /', async () => {
  const app = buildApp(undefined);
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.has('cache-control'), false);
  });
});

test('PAGE_CACHE_MAX_AGE=600 -> public, max-age=600 on /', async () => {
  const app = buildApp('600');
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=600');
  });
});

test('/static is unaffected by PAGE_CACHE_MAX_AGE, unset case', async () => {
  const app = buildApp(undefined);
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/static/css/style.css`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  });
});

test('/static is unaffected by PAGE_CACHE_MAX_AGE, set case', async () => {
  const app = buildApp('600');
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/static/css/style.css`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  });
});

test('PAGE_CACHE_MAX_AGE="0" and "off" also mean no header', () => {
  for (const value of ['0', 'off']) {
    delete require.cache[PAGES_ROUTER_PATH];
    process.env.PAGE_CACHE_MAX_AGE = value;
    assert.doesNotThrow(() => require(PAGES_ROUTER_PATH));
  }
});

test('PAGE_CACHE_MAX_AGE with an invalid value fails fast, by name', () => {
  for (const value of ['-5', '3.5', 'banana']) {
    delete require.cache[PAGES_ROUTER_PATH];
    process.env.PAGE_CACHE_MAX_AGE = value;
    assert.throws(() => require(PAGES_ROUTER_PATH), /PAGE_CACHE_MAX_AGE/);
  }
  delete require.cache[PAGES_ROUTER_PATH];
  delete process.env.PAGE_CACHE_MAX_AGE;
});
