const { methodNotAllowed } = require('./_lib/http');

// Returns the visitor's country so the front end can localise wording and
// pricing. Vercel supplies the header on every edge request.
module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET']);
    return;
  }

  const country = String(req.headers['x-vercel-ip-country'] || '').toUpperCase().slice(0, 2);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.end(JSON.stringify({ country }));
};
