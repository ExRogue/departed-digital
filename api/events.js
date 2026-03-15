const { allowCors, methodNotAllowed, parseJsonBody, sendError, sendJson } = require('./_lib/http');
const { recordAnalyticsEvent, recordEvent } = require('./_lib/store');

function normalizeString(value, maxLength = 120) {
  return String(value || '').trim().slice(0, maxLength);
}

module.exports = async function handler(req, res) {
  allowCors(res, req);

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
    const caseId = normalizeString(body.id, 80);
    const publicToken = normalizeString(body.publicToken, 120);
    const eventType = normalizeString(body.eventType, 80);

    if (!caseId || !publicToken || !eventType) {
      sendError(res, 400, 'Case id, token, and event type are required.');
      return;
    }

    const updated = await recordEvent(caseId, publicToken, eventType, body.metadata && typeof body.metadata === 'object' ? body.metadata : {});

    if (!updated) {
      sendError(res, 404, 'Case not found.');
      return;
    }

    if (body.analytics && typeof body.analytics === 'object') {
      await recordAnalyticsEvent({
        eventType,
        path: body.analytics.path,
        label: body.analytics.label,
        sessionId: body.analytics.sessionId,
        pageTitle: body.analytics.pageTitle,
        referrer: body.analytics.referrer,
        caseId,
        metadata: body.analytics.metadata
      });
    }

    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendError(res, 500, 'We could not save that event.');
  }
};
