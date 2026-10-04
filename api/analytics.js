const { allowCors, handleBadJson, methodNotAllowed, parseJsonBody, sendError, sendJson } = require('./_lib/http');
const { isUuidLike, recordAnalyticsEvent } = require('./_lib/store');

function normalizeString(value, maxLength = 240) {
  return String(value || '').trim().slice(0, maxLength);
}

const CRAWLER_PATTERN = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|pingdom|uptimerobot|facebookexternalhit|bingpreview|python|curl|wget|httpclient|phantomjs|puppeteer|playwright|selenium/i;

// Facts the server knows about the request and the browser cannot be trusted
// to report: the country Vercel resolved for it, and whether the user agent
// is a known crawler. Neither the IP address nor the user agent is stored.
function requestContext(req) {
  const headers = (req && req.headers) || {};
  const country = String(headers['x-vercel-ip-country'] || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  const userAgent = String(headers['user-agent'] || '');

  return {
    country,
    isBot: !userAgent || CRAWLER_PATTERN.test(userAgent)
  };
}

function sanitizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  try {
    // Round-trip strips functions/undefined; an escaped NUL (backslash-u0000)
    // in the serialized JSON is rejected by Postgres jsonb, so drop those.
    const serialized = JSON.stringify(value);
    if (serialized.length > 4000 || serialized.includes('\\u0000')) {
      return {};
    }
    return JSON.parse(serialized);
  } catch (error) {
    return {};
  }
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
    const eventType = normalizeString(body.eventType, 80);
    const sessionId = normalizeString(body.sessionId, 120);

    if (!eventType || !sessionId) {
      sendError(res, 400, 'Event type and session id are required.');
      return;
    }

    const caseId = normalizeString(body.caseId, 80);
    const metadata = Object.assign(sanitizeMetadata(body.metadata), requestContext(req));

    await recordAnalyticsEvent({
      eventType,
      sessionId,
      path: normalizeString(body.path, 240),
      label: normalizeString(body.label, 180),
      pageTitle: normalizeString(body.pageTitle, 240),
      referrer: normalizeString(body.referrer, 500),
      caseId: isUuidLike(caseId) ? caseId : '',
      metadata
    });

    sendJson(res, 200, { ok: true });
  } catch (error) {
    if (handleBadJson(res, error)) {
      return;
    }
    console.error('analytics event failed', error);
    sendError(res, 500, 'We could not save the analytics event.');
  }
};
