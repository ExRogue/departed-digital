const { MAX_DOCUMENT_COUNT, MAX_DOCUMENT_SIZE_BYTES } = require('./_lib/config');
const { sendDocumentsUploadedEmails } = require('./_lib/email');
const { allowCors, methodNotAllowed, parseJsonBody, sendError, sendJson } = require('./_lib/http');
const { StoreConfigurationError, buildPublicCase, getCaseForPublic, uploadDocuments } = require('./_lib/store');

function normalizeString(value, maxLength = 400) {
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
    const caseId = normalizeString(body.id, 80);
    const publicToken = normalizeString(body.publicToken, 120);
    const files = Array.isArray(body.files) ? body.files.slice(0, MAX_DOCUMENT_COUNT) : [];

    if (!caseId || !publicToken) {
      sendError(res, 400, 'Case id and token are required.');
      return;
    }

    const caseRecord = await getCaseForPublic(caseId, publicToken);

    if (!caseRecord) {
      sendError(res, 404, 'Case not found.');
      return;
    }

    if (!files.length) {
      sendError(res, 400, 'At least one supporting document is required.');
      return;
    }

    for (const file of files) {
      const declaredSize = Number(file.size || 0);
      if (declaredSize > MAX_DOCUMENT_SIZE_BYTES) {
        sendError(res, 400, `Each file must be ${Math.round(MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024))}MB or smaller.`);
        return;
      }
    }

    const updated = await uploadDocuments(caseId, publicToken, {
      authorityBasis: normalizeString(body.authorityBasis, 180),
      notes: normalizeString(body.notes, 2400),
      files
    });

    if (!updated) {
      sendError(res, 404, 'Case not found.');
      return;
    }

    sendDocumentsUploadedEmails(updated, files.length).catch((error) => {
      console.error('documents_uploaded_email_failed', error);
    });

    sendJson(res, 200, {
      ok: true,
      case: buildPublicCase(updated)
    });
  } catch (error) {
    if (error instanceof StoreConfigurationError) {
      sendError(res, 503, error.message, { code: 'storage_not_configured' });
      return;
    }

    sendError(res, 500, 'We could not upload the supporting documents.');
  }
};
