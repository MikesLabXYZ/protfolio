require('dotenv').config();
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const db = require('./db');
const uploads = require('./lib/uploads');
const { baseUrlMiddleware } = require('./lib/baseUrl');
const pagesRouter = require('./routes/pages');
// Requiring admin.js is safe even when ADMIN_UPLOAD_TOKEN is unset - the
// module itself exports null in that case. The route is only ever
// registered below when it's non-null, which is the actual enforcement of
// "not registered at all" rather than just unauthenticated.
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// This app sits behind TWO chained proxies on the AWS target - CloudFront,
// then the internal ALB - so req.ip needs to skip 2 hops of X-Forwarded-For
// to land on the real client IP, not CloudFront's own IP. `trust proxy: 1`
// would stop one hop too early and make every client look like it's
// CloudFront, which quietly defeats the per-IP rate limiter below (every
// request would share one bucket). Locally (docker compose, bare `node`),
// there's no proxy in front of the app at all, so this number is simply
// unused - Express only consults X-Forwarded-* once a request actually
// arrives through that many trusted hops.
app.set('trust proxy', 2);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // No 'unsafe-inline' needed - every template-side style is a class,
      // and fonts are self-hosted, so there's nothing external left to
      // allow here. Uploaded project images are served same-origin under
      // /uploads, so 'self' already covers them too - no imgSrc change.
      styleSrc: ["'self'"],
      fontSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
}));
app.use(compression());

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(baseUrlMiddleware);

// No rate limit on static assets - a single page view alone fires ~30
// requests (marquee logos, fonts, hero icons, JS/CSS), so counting those
// against the same budget as page requests burns through it in a couple
// of reloads. Real abuse protection belongs on the page routes.
//
// maxAge/immutable produce `Cache-Control: public, max-age=31536000,
// immutable` - safe because these assets are versioned by deploy, not by
// filename, so a CDN in front of this origin can cache them indefinitely.
app.use('/static', express.static(path.join(__dirname, 'public'), {
  maxAge: '1y',
  immutable: true,
}));
app.use('/uploads', express.static(uploads.uploadPath));

// Used by the ALB target group / ECS task health check. Deliberately does
// NOT touch the database - a DB blip must not cause every healthy task to
// be killed and replaced at once. /healthz/deep below is the DB-aware
// version, for manual use. Both are no-store: a CDN or intermediary caching
// a stale "ok" would defeat the entire point of a health check.
app.get('/healthz', (req, res) => res.set('Cache-Control', 'no-store').status(200).json({ status: 'ok' }));

app.get('/healthz/deep', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    await db.query('SELECT 1');
    res.status(200).json({ status: 'ok', db: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'unreachable' });
  }
});

// AWS's own WAF guidance is the reference here (this app deploys behind
// an ALB): a blanket rate-based rule of 500 requests / 5 min per IP for
// general traffic, with tighter limits reserved for specific sensitive
// endpoints - https://aws.amazon.com/blogs/security/three-most-important-aws-waf-rate-based-rules/
// None of these page routes are sensitive (no auth, no mutation), so the
// blanket figure applies as-is rather than something stricter. The admin
// upload router (when registered) carries its own, much tighter limiter.
app.use(rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 500,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.use('/', pagesRouter);

if (adminRouter) {
  app.use('/admin', adminRouter);
}

app.use((req, res) => {
  res.status(404).render('404', { title: 'Not found' });
});

// Final error handler - never leak stack traces or query details to the
// client; the real error still goes to the server logs.
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500);
  if (isProd) {
    res.type('text/plain').send('Something went wrong.');
  } else {
    res.type('text/plain').send(err.stack);
  }
});

let server;

// A misconfigured TLS_CERT_PATH/TLS_KEY_PATH used to surface as a raw
// ENOENT stack trace with no indication of which variable was wrong - fine
// on a terminal, useless in a log aggregator where the orchestrator only
// ever reports "essential container exited". This logs exactly which
// variable, which path it resolved to, and what's actually in that path's
// parent directory, then exits deliberately (instead of letting an
// unhandled exception produce an unrelated-looking crash).
function readTlsFileOrExit(varName, filePath) {
  try {
    return fs.readFileSync(filePath);
  } catch (err) {
    const dir = path.dirname(filePath);
    let dirListing;
    try {
      const entries = fs.readdirSync(dir);
      dirListing = entries.length ? entries.join(', ') : '(empty)';
    } catch (dirErr) {
      dirListing = `(could not read "${dir}": ${dirErr.code || dirErr.message})`;
    }
    console.error(
      `[startup] ${varName} is set to "${filePath}" but that file could not be read ` +
      `(${err.code || err.message}).\n` +
      `[startup] Parent directory "${dir}" actually contains: ${dirListing}\n` +
      '[startup] The Dockerfile writes the self-signed LB-to-task cert to ' +
      '/app/certs/tls.crt and /app/certs/tls.key - TLS_CERT_PATH/TLS_KEY_PATH ' +
      'should normally point there exactly.'
    );
    process.exit(1);
  }
}

function createServer() {
  const certPath = process.env.TLS_CERT_PATH;
  const keyPath = process.env.TLS_KEY_PATH;

  // Both must be set to enable TLS - these are only ever set in the ECS
  // task definition, never defaulted in the image, so local/no-AWS testing
  // (docker compose, bare `node src/server.js`) always gets plain HTTP with
  // zero certificate configuration required. The load balancer terminates
  // public TLS in front of this; this cert only covers the LB-to-task hop.
  if (certPath && keyPath) {
    const options = {
      cert: readTlsFileOrExit('TLS_CERT_PATH', certPath),
      key: readTlsFileOrExit('TLS_KEY_PATH', keyPath),
    };
    return https.createServer(options, app);
  }
  return http.createServer(app);
}

function shutdown(signal) {
  console.log(`[shutdown] Received ${signal}, draining...`);
  if (!server) {
    process.exit(0);
    return;
  }
  // ECS sends SIGTERM before stopping a task; server.close() stops
  // accepting new connections but lets in-flight requests finish before
  // its callback fires. A hard-exit safety net guards against a stuck
  // connection hanging shutdown indefinitely.
  const forceExit = setTimeout(() => {
    console.error('[shutdown] Timed out waiting for connections to drain, forcing exit.');
    process.exit(1);
  }, 25000);
  forceExit.unref();

  server.close(async () => {
    try {
      await db.end();
    } catch (err) {
      console.error('[shutdown] Error draining DB pools:', err);
    }
    console.log('[shutdown] Complete, exiting.');
    clearTimeout(forceExit);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));

async function main() {
  await db.init();
  uploads.ensureUploadPath();

  server = createServer();
  const usingTls = server instanceof https.Server;
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT} (${usingTls ? 'https' : 'http'})`);
  });
}

main().catch((err) => {
  console.error('[startup] Fatal error during startup:', err);
  process.exit(1);
});
