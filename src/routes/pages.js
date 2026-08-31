const express = require('express');
const db = require('../db');

const router = express.Router();

// Behind a CDN, an unset Cache-Control means every request is forwarded to
// the origin - nothing ever cached at the edge. Configurable so it can be
// lowered during development (e.g. PAGE_CACHE_MAX_AGE=0) without a rebuild.
const parsedMaxAge = Number(process.env.PAGE_CACHE_MAX_AGE);
const PAGE_CACHE_MAX_AGE = Number.isFinite(parsedMaxAge) && parsedMaxAge >= 0 ? parsedMaxAge : 300;

router.use((req, res, next) => {
  res.set('Cache-Control', `public, max-age=${PAGE_CACHE_MAX_AGE}`);
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
