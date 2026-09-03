const express = require('express');
const db = require('../db');

const router = express.Router();

// Unset by default, deliberately - not a fallback to some old default. Behind
// CloudFront's CachingOptimized policy, an origin Cache-Control header is
// honoured at the edge AND forwarded straight to the viewer's browser, where
// a CloudFront invalidation can never reach it. With no header at all,
// CloudFront applies its own policy default at the edge and sends nothing to
// the viewer, so an invalidation is instantly reflected - the whole point of
// letting CloudFront, not this app, own page cache lifetime. Setting
// PAGE_CACHE_MAX_AGE is an optional, advanced knob for a reader who wants
// app-level control instead; see PAGE_CACHE_MAX_AGE in .env.example.
function parsePageCacheMaxAge() {
  const raw = process.env.PAGE_CACHE_MAX_AGE;
  if (raw === undefined || raw === '' || raw === '0' || raw === 'off') {
    return null; // no Cache-Control header on page routes at all
  }
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  // Fail fast and by name, the same way DB_SSL_CA_PATH does in src/db.js for
  // an unreadable CA bundle - a silently-ignored bad value here would mean
  // the app quietly serves cacheable pages with no Cache-Control header at
  // all, indistinguishable from the deliberate "unset" case above.
  throw new Error(
    `PAGE_CACHE_MAX_AGE is set to "${raw}", which isn't a valid value. Leave ` +
    'it unset (or set it to "0" or "off") to send no Cache-Control header on ' +
    "page routes and let CloudFront's own cache policy own the page lifetime, " +
    'or set it to a positive whole number of seconds to send ' +
    '"Cache-Control: public, max-age=<n>" instead.'
  );
}

const PAGE_CACHE_MAX_AGE = parsePageCacheMaxAge();

router.use((req, res, next) => {
  if (PAGE_CACHE_MAX_AGE !== null) {
    res.set('Cache-Control', `public, max-age=${PAGE_CACHE_MAX_AGE}`);
  }
  next();
});

router.get('/', (req, res) => {
  res.render('index', { title: 'Home' });
});

router.get('/about', (req, res) => {
  res.render('about', { title: 'About' });
});

router.get('/experience', (req, res) => {
  res.render('experience', { title: 'Experience' });
});

router.get('/projects', async (req, res, next) => {
  try {
    const { rows } = await db.queryRead(
      'SELECT slug, title, summary, tags, image_filename FROM projects WHERE is_draft = FALSE ORDER BY sort_order ASC'
    );
    res.render('projects', { title: 'Projects', projects: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/projects/:slug', async (req, res, next) => {
  try {
    const { rows } = await db.queryRead(
      'SELECT * FROM projects WHERE slug = $1 AND is_draft = FALSE',
      [req.params.slug]
    );
    if (rows.length === 0) {
      return res.status(404).render('404', { title: 'Not found' });
    }
    res.render('project-detail', { title: rows[0].title, project: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/contact', (req, res) => {
  res.render('contact', { title: 'Contact' });
});

module.exports = router;
