const { getPublicConfig } = require('./_lib/config');
const { allowCors, methodNotAllowed, sendError, sendJson } = require('./_lib/http');
const { getStorageHealth } = require('./_lib/store');

module.exports = async function handler(req, res) {
  allowCors(res, req);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET', 'OPTIONS']);
    return;
  }

  try {
    const storage = getStorageHealth();

    sendJson(res, 200, {
      ok: true,
      config: getPublicConfig(),
      storage: {
        requiresConfiguration: Boolean(storage && storage.requiresConfiguration)
      }
    });
  } catch (error) {
    console.error('public config failed', error);
    sendError(res, 500, 'We could not load the site configuration.');
  }
};
