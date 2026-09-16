require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const pagesRouter = require('./routes/pages');
const seo = require('./seo');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// How many proxy hops to trust when working out req.ip. Getting this wrong is
// silent: the rate limiter below still appears to work, it just stops limiting
// the right thing.
//
// On the Oracle deployment the chain is Cloudflare -> Caddy -> this app, and
// the app receives:
//
//   X-Forwarded-For: <visitor>, <cloudflare edge>      (Caddy appends its peer)
//   socket peer:     <caddy>
//
// Express counts hops from the app backwards, so 1 trusts only Caddy and makes
// req.ip the RIGHTMOST entry, which is Cloudflare's edge address, not the
// visitor. Every visitor arriving through the same edge then shares one
// rate-limit bucket, and anyone landing on a different edge gets a fresh one.
// Measured on the live site before this was changed: two consecutive requests
// from one browser returned remaining counts of 496 then 499, because they hit
// different edges.
//
// 2 trusts Caddy and the Cloudflare edge, so req.ip is the visitor. It is also
// the safe ceiling: Cloudflare appends the true client to any X-Forwarded-For a
// visitor sends, so a spoofed value lands further left and is ignored at 2. A
// higher number would start trusting attacker-supplied input.
//
// AWS happens to need 2 as well, for CloudFront then the ALB.
app.set('trust proxy', 2);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // No 'unsafe-inline' needed - every template-side style is a class
      // now, and fonts are self-hosted, so there's nothing external left
      // to allow here.
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

// No rate limit on static assets - a single page view alone fires ~30
// requests (marquee logos, fonts, hero icons, JS/CSS), so counting those
// against the same budget as page requests burns through it in a couple
// of reloads. Real abuse protection belongs on the page routes.
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(process.env.UPLOAD_DIR || path.join(__dirname, 'public', 'uploads')));

// Used by the ALB target group / Route 53 health check.
app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok' }));

// What crawlers ask for by fixed path. Cheap, so they sit with the static
// files rather than under the page rate limit; a crawler that hits the limit
// on robots.txt stops indexing. The favicon is here because browsers ask for
// /favicon.ico whatever the page declares, and every visit was a 404 in the
// access log until 2026-09-16.
const ICON_DIR = path.join(__dirname, 'public', 'icons');
app.get('/favicon.ico', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(ICON_DIR, 'favicon.ico'));
});
app.get('/robots.txt', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('text/plain').send(seo.robotsTxt());
});
app.get('/sitemap.xml', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT slug, created_at FROM projects WHERE is_draft = FALSE ORDER BY sort_order ASC'
    );
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('application/xml').send(seo.sitemapXml(rows));
  } catch (err) {
    next(err);
  }
});

// Title, description, canonical, preview tags for the page being rendered.
// The default is per path; a route that knows better (a project page, the
// 404) replaces res.locals.seo before rendering.
app.use((req, res, next) => {
  res.locals.seo = seo.forRequest(req.path);
  next();
});

// AWS's own WAF guidance is the reference here (this app deploys behind
// an ALB): a blanket rate-based rule of 500 requests / 5 min per IP for
// general traffic, with tighter limits reserved for specific sensitive
// endpoints - https://aws.amazon.com/blogs/security/three-most-important-aws-waf-rate-based-rules/
// None of these page routes are sensitive (no auth, no mutation), so the
// blanket figure applies as-is rather than something stricter.
app.use(rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 500,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.use('/', pagesRouter);

app.use((req, res) => {
  res.status(404).render('404', { title: 'Not found', seo: seo.forNotFound(req.path) });
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

const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// Shut down when asked, rather than being killed.
//
// Docker sends SIGTERM on every stop and every recreate. Until this existed the
// process had no handler, so nothing happened: docker waited out its full ten
// second grace period and then SIGKILLed, which meant every deployment reported
// `die exit=137`, took ten seconds longer than it needed to, and cut off
// whatever requests were in flight rather than finishing them.
//
// Found on 2026-09-12 in the container event log, not by guessing. The exit code
// had been read as evidence of something else entirely.
const shutdown = (signal) => {
  console.log(`${signal} received, shutting down`);

  // Stop accepting new connections and let in-flight responses finish.
  server.close((err) => {
    if (err) console.error('error closing the server', err);
    // Require it here rather than at the top: this file does not otherwise use
    // the pool, and require() returns the same instance the routes hold.
    require('./db').end()
      .catch((poolErr) => console.error('error closing the database pool', poolErr))
      .then(() => {
        console.log('shutdown complete');
        process.exit(0);
      });
  });

  // server.close() waits for every open connection to end, and the reverse
  // proxy in front of this app holds keep-alive connections open by design, so
  // without this the callback above might never run. Drops the connections that
  // are sitting idle; anything mid-response is left alone to finish.
  if (typeof server.closeIdleConnections === 'function') {
    server.closeIdleConnections();
  }

  // Backstop, well inside docker's ten second grace period. A process that
  // refuses to exit is the exact failure this handler was written to remove, so
  // it must not be able to reintroduce it.
  setTimeout(() => {
    console.error('shutdown timed out, exiting anyway');
    process.exit(1);
  }, 8000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
