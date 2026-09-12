require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const pagesRouter = require('./routes/pages');

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

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
