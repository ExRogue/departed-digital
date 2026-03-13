const { allowCors, methodNotAllowed, parseJsonBody, sendError, sendJson } = require('./_lib/http');
const { recordAnalyticsEvent } = require('./_lib/store');

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

  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST', 'OPTIONS']);
    return;
  }

  try {
    const body = await parseJsonBody(req);
    const eventType = normalizeString(body.eventType, 80);
    const sessionId = normalizeString(body.sessionId, 120);

    if (!eventType || !sessionId) {
      sendError(res, 400, 'Event type and session id are required.');
      return;
    }

    await recordAnalyticsEvent({
      eventType,
      sessionId,
      path: normalizeString(body.path, 240),
      label: normalizeString(body.label, 180),
      pageTitle: normalizeString(body.pageTitle, 240),
      referrer: normalizeString(body.referrer, 500),
      caseId: normalizeString(body.caseId, 80),
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {}
    });

    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendError(res, 500, 'We could not save the analytics event.');
  }
};
