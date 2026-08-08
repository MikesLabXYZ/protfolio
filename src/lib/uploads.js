const fs = require('fs');

const uploadPath = process.env.UPLOAD_PATH || './uploads';

let writable = false;

// On AWS this directory is an EFS mount governed by an access point with a
// fixed POSIX uid/gid - never chown or chmod it here, that will simply fail
// (or silently no-op) against EFS. If it's missing entirely (e.g. a fresh
// local volume), create it; if it exists but isn't writable, log exactly
// why and keep serving read-only rather than crashing the whole process.
function ensureUploadPath() {
  try {
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    fs.accessSync(uploadPath, fs.constants.W_OK);
    writable = true;
  } catch (err) {
    writable = false;
    const uid = typeof process.getuid === 'function' ? process.getuid() : 'unknown';
    console.error(
      `[startup] Upload path "${uploadPath}" is not writable (running as uid=${uid}). ` +
      `Serving existing files read-only; uploads will be rejected until this is fixed. ` +
      `Underlying error: ${err.message}`
    );
  }
  return writable;
}

module.exports = {
  uploadPath,
  ensureUploadPath,
  isWritable: () => writable,
};
