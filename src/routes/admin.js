const crypto = require('crypto');
const path = require('path');
const fs = require('fs/promises');
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');

const db = require('../db');
const uploads = require('../lib/uploads');

// This entire module is only ever required by server.js when
// ADMIN_UPLOAD_TOKEN is set - see the require site. That's the actual
// enforcement of "route must not be registered at all when unset"; this
// check here is a second, defensive guard against the module being
// required some other way.
if (!process.env.ADMIN_UPLOAD_TOKEN) {
  module.exports = null;
} else {
  const router = express.Router();

  const ALLOWED_TYPES = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
  };
  const MAX_BYTES = 2 * 1024 * 1024;

  // Deliberately much tighter than the page-route limiter (500 / 5 min) -
  // this is a rarely-used admin action, not general traffic.
  const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES },
    fileFilter(req, file, cb) {
      if (!ALLOWED_TYPES[file.mimetype]) {
        cb(new Error('Unsupported file type'));
        return;
      }
      cb(null, true);
    },
  });

  function timingSafeEqualStr(a, b) {
    const bufA = Buffer.from(String(a || ''), 'utf8');
    const bufB = Buffer.from(String(b || ''), 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  function requireAdminToken(req, res, next) {
    const header = req.get('authorization') || '';
    const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!timingSafeEqualStr(presented, process.env.ADMIN_UPLOAD_TOKEN)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  }

  router.post(
    '/projects/:slug/image',
    uploadLimiter,
    requireAdminToken,
    (req, res, next) => {
      upload.single('image')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        next();
      });
    },
    async (req, res, next) => {
      try {
        if (!uploads.isWritable()) {
          return res.status(503).json({ error: 'Upload storage is not writable right now' });
        }
        if (!req.file) {
          return res.status(400).json({ error: 'No image file provided' });
        }

        const { rows } = await db.query('SELECT slug FROM projects WHERE slug = $1', [req.params.slug]);
        if (rows.length === 0) {
          return res.status(404).json({ error: 'Project not found' });
        }

        // Filename is entirely server-generated - the client's original
        // filename is never read or used, so there's nothing to path-
        // traverse or inject with.
        const ext = ALLOWED_TYPES[req.file.mimetype];
        const filename = `${crypto.randomUUID()}${ext}`;
        const destination = path.join(uploads.uploadPath, filename);

        await fs.writeFile(destination, req.file.buffer);
        await db.query('UPDATE projects SET image_filename = $1 WHERE slug = $2', [filename, req.params.slug]);

        res.status(200).json({ status: 'ok', image_filename: filename });
      } catch (err) {
        next(err);
      }
    }
  );

  module.exports = router;
}
