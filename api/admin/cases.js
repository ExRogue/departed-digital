const { CASE_STATUSES, PACKAGE_CONFIG, PAYMENT_STATUSES } = require('../_lib/config');
const { allowCors, methodNotAllowed, parseJsonBody, sendError, sendJson } = require('../_lib/http');
const { requireAdminKey } = require('../_lib/security');
const { listAdminCases, updateAdminCase } = require('../_lib/store');

function normalizeString(value, maxLength = 4000) {
  return String(value || '').trim().slice(0, maxLength);
}

module.exports = async function handler(req, res) {
  allowCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const adminCheck = requireAdminKey(req);

  if (!adminCheck.ok) {
    sendError(res, adminCheck.statusCode, adminCheck.message);
    return;
  }

  try {
    if (req.method === 'GET') {
      const cases = await listAdminCases();
      sendJson(res, 200, { ok: true, cases });
      return;
    }

    if (req.method === 'PATCH') {
      const body = await parseJsonBody(req);
      const caseId = normalizeString(body.id, 80);

      if (!caseId) {
        sendError(res, 400, 'Case id is required.');
        return;
      }

      const updated = await updateAdminCase(caseId, {
        selectedPackage: PACKAGE_CONFIG[body.selectedPackage] ? body.selectedPackage : '',
        status: CASE_STATUSES.includes(body.status) ? body.status : '',
        paymentStatus: PAYMENT_STATUSES.includes(body.paymentStatus) ? body.paymentStatus : '',
        authorityBasis: normalizeString(body.authorityBasis, 180),
        internalNotes: normalizeString(body.internalNotes, 4000),
        activityEvent: 'admin_case_updated',
        activityMetadata: {
          status: body.status || '',
          paymentStatus: body.paymentStatus || ''
        }
      });

      if (!updated) {
        sendError(res, 404, 'Case not found.');
        return;
      }

      sendJson(res, 200, { ok: true, case: updated });
      return;
    }

    methodNotAllowed(res, ['GET', 'PATCH', 'OPTIONS']);
  } catch (error) {
    sendError(res, 500, 'We could not load the case dashboard.');
  }
};
