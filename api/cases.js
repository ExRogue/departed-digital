const { PACKAGE_CONFIG } = require('./_lib/config');
const { sendCaseCreatedEmails } = require('./_lib/email');
const { allowCors, methodNotAllowed, parseJsonBody, sendError, sendJson } = require('./_lib/http');
const {
  StoreConfigurationError,
  buildPublicCase,
  createCase,
  getCaseForPublic,
  updatePublicCase
} = require('./_lib/store');

function normalizeString(value, maxLength = 1200) {
  return String(value || '').trim().slice(0, maxLength);
}

function validateCreatePayload(payload) {
  const clientName = normalizeString(payload.clientName, 140);
  const clientEmail = normalizeString(payload.clientEmail, 180);
  const deceasedName = normalizeString(payload.deceasedName, 140);

  if (!clientName || !clientEmail || !deceasedName) {
    return {
      ok: false,
      message: 'Name, email, and the deceased’s name are required.'
    };
  }

  return {
    ok: true,
    value: {
      clientName,
      clientEmail,
      deceasedName,
      preferredOutcome: normalizeString(payload.preferredOutcome, 60) || 'not_sure',
      caseDetails: normalizeString(payload.caseDetails, 4000),
      relationshipToDeceased: normalizeString(payload.relationshipToDeceased, 140),
      knownPlatforms: normalizeString(payload.knownPlatforms, 1200),
      profileUrls: normalizeString(payload.profileUrls, 2000),
      urgency: normalizeString(payload.urgency, 40) || 'standard',
      selectedPackage: PACKAGE_CONFIG[payload.selectedPackage] ? payload.selectedPackage : 'standard',
      intakeSource: normalizeString(payload.intakeSource, 80) || 'website',
      referralSource: normalizeString(payload.referralSource, 180)
    }
  };
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
      const caseId = normalizeString(req.query.id, 80);
      const publicToken = normalizeString(req.query.token, 120);

      if (!caseId || !publicToken) {
        sendError(res, 400, 'Case id and token are required.');
        return;
      }

      const caseRecord = await getCaseForPublic(caseId, publicToken);

      if (!caseRecord) {
        sendError(res, 404, 'Case not found.');
        return;
      }

      sendJson(res, 200, {
        ok: true,
        case: buildPublicCase(caseRecord)
      });
      return;
    }

    if (req.method === 'POST') {
      const body = await parseJsonBody(req);
      const validation = validateCreatePayload(body);

      if (!validation.ok) {
        sendError(res, 400, validation.message);
        return;
      }

      const caseRecord = await createCase(validation.value);

      sendCaseCreatedEmails(caseRecord).catch((error) => {
        console.error('case_created_email_failed', error);
      });

      sendJson(res, 201, {
        ok: true,
        case: buildPublicCase(caseRecord),
        publicToken: caseRecord.publicToken
      });
      return;
    }

    if (req.method === 'PATCH') {
      const body = await parseJsonBody(req);
      const caseId = normalizeString(body.id, 80);
      const publicToken = normalizeString(body.publicToken, 120);

      if (!caseId || !publicToken) {
        sendError(res, 400, 'Case id and token are required.');
        return;
      }

      const caseRecord = await getCaseForPublic(caseId, publicToken);

      if (!caseRecord) {
        sendError(res, 404, 'Case not found.');
        return;
      }

      const updated = await updatePublicCase(caseId, publicToken, {
        selectedPackage: normalizeString(body.selectedPackage, 40),
        relationshipToDeceased: normalizeString(body.relationshipToDeceased, 140),
        knownPlatforms: normalizeString(body.knownPlatforms, 1200),
        profileUrls: normalizeString(body.profileUrls, 2000),
        paymentStatus: normalizeString(body.paymentStatus, 40),
        status: normalizeString(body.status, 40),
        activityEvent: normalizeString(body.activityEvent, 80),
        activityMetadata: body.activityMetadata && typeof body.activityMetadata === 'object' ? body.activityMetadata : {}
      });

      sendJson(res, 200, {
        ok: true,
        case: buildPublicCase(updated)
      });
      return;
    }

    methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'OPTIONS']);
  } catch (error) {
    if (error instanceof StoreConfigurationError) {
      sendError(res, 503, error.message, { code: 'storage_not_configured' });
      return;
    }

    sendError(res, 500, 'We could not process the case request just now.');
  }
};
