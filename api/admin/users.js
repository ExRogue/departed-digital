const { ADMIN_ROLES } = require('../_lib/config');
const { allowCors, methodNotAllowed, parseJsonBody, sendError, sendJson } = require('../_lib/http');
const {
  createAdminUser,
  listAdminUsers,
  requireAdminAccess,
  updateAdminUser
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

  const adminCheck = await requireAdminAccess(req, 'users.manage');

  if (!adminCheck.ok) {
    sendError(res, adminCheck.statusCode, adminCheck.message);
    return;
  }

  try {
    if (req.method === 'GET') {
      const users = await listAdminUsers();
      sendJson(res, 200, {
        ok: true,
        users,
        roles: ADMIN_ROLES
      });
      return;
    }

    if (req.method === 'POST') {
      const body = await parseJsonBody(req);
      const user = await createAdminUser({
        name: normalizeString(body.name, 160),
        username: normalizeString(body.username, 120),
        password: normalizeString(body.password, 240),
        role: normalizeString(body.role, 80)
      });

      sendJson(res, 200, {
        ok: true,
        user
      });
      return;
    }

    if (req.method === 'PATCH') {
      const body = await parseJsonBody(req);
      const id = normalizeString(body.id, 120);

      if (!id) {
        sendError(res, 400, 'User id is required.');
        return;
      }

      const updated = await updateAdminUser(id, {
        name: normalizeString(body.name, 160),
        role: normalizeString(body.role, 80),
        status: normalizeString(body.status, 40),
        password: normalizeString(body.password, 240)
      });

      if (!updated) {
        sendError(res, 404, 'User not found.');
        return;
      }

      sendJson(res, 200, {
        ok: true,
        user: updated
      });
      return;
    }

    methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'OPTIONS']);
  } catch (error) {
    sendError(res, 500, error.message || 'We could not update the admin users.');
  }
};
