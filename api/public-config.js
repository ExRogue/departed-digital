const { getPublicConfig } = require('./_lib/config');
const { allowCors, methodNotAllowed, sendJson } = require('./_lib/http');
const { getStorageHealth } = require('./_lib/store');

module.exports = async function handler(req, res) {
  allowCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET', 'OPTIONS']);
    return;
  }

  sendJson(res, 200, {
    ok: true,
    config: getPublicConfig(),
    storage: getStorageHealth()
  });
};
