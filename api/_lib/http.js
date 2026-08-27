async function readRawBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
}

class InvalidJsonBodyError extends Error {
  constructor() {
    super('Request body must be valid JSON.');
    this.name = 'InvalidJsonBodyError';
    this.statusCode = 400;
  }
}

async function parseJsonBody(req) {
  try {
    if (req.body && typeof req.body === 'object') {
      return req.body;
    }

    if (typeof req.body === 'string') {
      return req.body ? JSON.parse(req.body) : {};
    }

    const raw = await readRawBody(req);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    throw new InvalidJsonBodyError();
  }
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.end(JSON.stringify(payload));
}

function sendError(res, statusCode, message, extra = {}) {
  sendJson(res, statusCode, {
    ok: false,
    error: message,
    ...extra
  });
}

// Returns true when it fully handled the request (bad JSON → 400).
// Call from handler catch blocks before falling back to a 500.
function handleBadJson(res, error) {
  if (error instanceof InvalidJsonBodyError || error.statusCode === 400) {
    sendError(res, 400, error.message || 'Invalid request body.');
    return true;
  }
  return false;
}

function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  sendError(res, 405, 'Method not allowed');
}

// The site and admin panel are served from the same origin as the API, so no
// cross-origin access is granted. OPTIONS preflights are still answered by the
// individual handlers.
function allowCors() {}

module.exports = {
  allowCors,
  handleBadJson,
  InvalidJsonBodyError,
  methodNotAllowed,
  parseJsonBody,
  sendError,
  sendJson
};
