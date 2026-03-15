const { allowCors, methodNotAllowed, parseJsonBody, sendError, sendJson } = require('../_lib/http');
const {
  buildLogoutCookie,
  buildSessionCookie,
  createAdminSession,
  invalidateAdminSession,
  getAdminSession,
  getRolePermissions,
  getLoginDefaults,
  verifyAdminCredentials
} = require('../_lib/security');

function normalizeString(value, maxLength = 240) {
  return String(value || '').trim().slice(0, maxLength);
}

module.exports = async function handler(req, res) {
  allowCors(res, req);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    if (req.method === 'GET') {
      const session = await getAdminSession(req);
      const defaults = await getLoginDefaults();

      if (!session) {
        sendJson(res, 200, {
          ok: true,
          authenticated: false,
          username: defaults.username
        });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        authenticated: true,
        username: session.username,
        session: {
          id: session.userId,
          username: session.username,
          name: session.name,
          role: session.role,
          permissions: getRolePermissions(session.role),
          expiresAt: session.expiresAt
        }
      });
      return;
    }

    if (req.method === 'POST') {
      const body = await parseJsonBody(req);
      const username = normalizeString(body.username, 120);
      const password = normalizeString(body.password, 240);
      const auth = await verifyAdminCredentials(username, password);

      if (!auth.ok) {
        sendError(res, auth.statusCode, auth.message);
        return;
      }

      const session = await createAdminSession(auth.user);
      res.setHeader('Set-Cookie', buildSessionCookie(session.token));
      sendJson(res, 200, {
        ok: true,
        authenticated: true,
        sessionToken: session.token,
        session: {
          id: auth.user.id,
          username: auth.user.username,
          name: auth.user.name,
          role: auth.user.role,
          permissions: auth.user.permissions,
          expiresAt: session.expiresAt
        }
      });
      return;
    }

    if (req.method === 'DELETE') {
      await invalidateAdminSession(req);
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
