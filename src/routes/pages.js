const express = require('express');
const db = require('../db');

const router = express.Router();

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
