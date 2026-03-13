const { allowCors, methodNotAllowed, parseJsonBody, sendError, sendJson } = require('../_lib/http');
const {
  buildLogoutCookie,
  buildSessionCookie,
  createAdminSession,
  getAdminSession,
  getConfiguredAdminCredentials,
  verifyAdminCredentials
} = require('../_lib/security');

function normalizeString(value, maxLength = 240) {
  return String(value || '').trim().slice(0, maxLength);
}

module.exports = async function handler(req, res) {
  allowCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    if (req.method === 'GET') {
      const session = getAdminSession(req);

      if (!session) {
        sendJson(res, 200, {
          ok: true,
          authenticated: false,
          username: getConfiguredAdminCredentials().username
        });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        authenticated: true,
        session: {
          username: session.username,
          expiresAt: session.expiresAt
        }
      });
      return;
    }

    if (req.method === 'POST') {
      const body = await parseJsonBody(req);
      const username = normalizeString(body.username, 120);
      const password = normalizeString(body.password, 240);
      const auth = verifyAdminCredentials(username, password);

      if (!auth.ok) {
        sendError(res, auth.statusCode, auth.message);
        return;
      }

      const session = createAdminSession(auth.username);
      res.setHeader('Set-Cookie', buildSessionCookie(session.token));
      sendJson(res, 200, {
        ok: true,
        authenticated: true,
        session: {
          username: auth.username,
          expiresAt: session.expiresAt
        }
      });
      return;
    }

    if (req.method === 'DELETE') {
      res.setHeader('Set-Cookie', buildLogoutCookie());
      sendJson(res, 200, {
        ok: true,
        authenticated: false
      });
      return;
    }

    methodNotAllowed(res, ['GET', 'POST', 'DELETE', 'OPTIONS']);
  } catch (error) {
    sendError(res, 500, error.message || 'We could not process the admin login.');
  }
};
