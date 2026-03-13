const crypto = require('node:crypto');

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

function requireAdminKey(req) {
  const configuredKey = process.env.ADMIN_ACCESS_TOKEN;
  const providedKey = req.headers['x-admin-key'] || req.headers['X-Admin-Key'];

  if (!configuredKey) {
    return {
      ok: false,
      statusCode: 503,
      message: 'ADMIN_ACCESS_TOKEN is not configured yet.'
    };
  }

  if (!providedKey || !safeEqual(providedKey, configuredKey)) {
    return {
      ok: false,
      statusCode: 401,
      message: 'Admin access token is invalid.'
    };
  }

  return { ok: true };
}

module.exports = {
  requireAdminKey,
  safeEqual
};
