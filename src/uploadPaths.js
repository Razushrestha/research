const path = require('path');

function getUploadDirName() {
  return process.env.UPLOAD_DIR || 'uploads';
}

function isVercelRuntime() {
  return Boolean(process.env.VERCEL);
}

/** Writable absolute path for Multer + static files (Vercel: only /tmp is writable). */
function getUploadAbsolutePath() {
  const name = getUploadDirName();
  if (isVercelRuntime()) {
    return path.join('/tmp', name);
  }
  return path.resolve(__dirname, '..', name);
}

module.exports = {
  getUploadDirName,
  getUploadAbsolutePath,
  isVercelRuntime,
};
