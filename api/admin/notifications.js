const { allowCors, methodNotAllowed, parseJsonBody, sendError, sendJson } = require('../_lib/http');
const { sendManualCaseEmail, getEmailHealth } = require('../_lib/email');
const { requireAdminAccess } = require('../_lib/security');
const { getCaseForAdmin, updateAdminCase } = require('../_lib/store');

function normalizeString(value, maxLength = 6000) {
  return String(value || '').trim().slice(0, maxLength);
}

module.exports = async function handler(req, res) {
  allowCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const adminCheck = requireAdminAccess(req);

  if (!adminCheck.ok) {
    sendError(res, adminCheck.statusCode, adminCheck.message);
    return;
  }

  try {
    if (req.method !== 'POST') {
      methodNotAllowed(res, ['POST', 'OPTIONS']);
      return;
    }

    const emailHealth = getEmailHealth();

    if (!emailHealth.enabled) {
      sendError(res, 503, 'Email delivery is not configured yet.');
      return;
    }

    const body = await parseJsonBody(req);
    const caseId = normalizeString(body.id, 80);
    const kind = normalizeString(body.kind, 80) || 'client_update';
    const subject = normalizeString(body.subject, 200);
    const message = normalizeString(body.message, 6000);

    if (kind === 'operations_summary' && !emailHealth.hasOperationsAlertEmail) {
      sendError(res, 503, 'Operations alert email is not configured yet.');
      return;
    }

    if (!caseId) {
      sendError(res, 400, 'Case id is required.');
      return;
    }

    if (!subject || !message) {
      sendError(res, 400, 'Email subject and message are required.');
      return;
    }

    const caseRecord = await getCaseForAdmin(caseId);

    if (!caseRecord) {
      sendError(res, 404, 'Case not found.');
      return;
    }

    const delivery = await sendManualCaseEmail(caseRecord, {
      kind,
      subject,
      message
    });

    await updateAdminCase(caseId, {
      activityEvent: 'admin_email_sent',
      activityMetadata: {
        kind,
        subject
      }
    });

    sendJson(res, 200, {
      ok: true,
      delivery
    });
  } catch (error) {
    sendError(res, 500, error.message || 'We could not send the email.');
  }
};
