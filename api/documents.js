const { MAX_DOCUMENT_COUNT, MAX_DOCUMENT_SIZE_BYTES } = require('./_lib/config');
const { sendDocumentsUploadedEmails } = require('./_lib/email');
const { allowCors, handleBadJson, methodNotAllowed, parseJsonBody, sendError, sendJson } = require('./_lib/http');
const {
  DocumentValidationError,
  PaymentRequiredError,
  StoreConfigurationError,
  buildPublicCase,
  getCaseForPublic,
  isUuidLike,
  uploadDocuments
} = require('./_lib/store');

function normalizeString(value, maxLength = 400) {
  return String(value || '').trim().slice(0, maxLength);
}

// Files arrive as base64 data URLs; the decoded payload is ~3/4 of the string.
function estimateDecodedBytes(file) {
  const data = String((file && file.data) || '');
  const commaIndex = data.indexOf(',');
  const base64Length = data.length - (commaIndex >= 0 ? commaIndex + 1 : 0);
  return Math.floor(base64Length * 0.75);
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
    const files = Array.isArray(body.files) ? body.files.slice(0, MAX_DOCUMENT_COUNT) : [];
    // The upload page sends files one request at a time and asks for the
    // confirmation email only with the final request.
    const notify = body.notify !== false;

    if (!caseId || !publicToken) {
      sendError(res, 400, 'Case id and token are required.');
      return;
    }

    if (!isUuidLike(caseId)) {
      sendError(res, 404, 'Case not found.');
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
      const size = Math.max(Number(file.size || 0), estimateDecodedBytes(file));
      if (size > MAX_DOCUMENT_SIZE_BYTES) {
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

    if (notify) {
      const totalDocuments = Array.isArray(updated.documents) ? updated.documents.length : files.length;
      sendDocumentsUploadedEmails(updated, totalDocuments).catch((error) => {
        console.error('documents_uploaded_email_failed', error);
      });
    }

    sendJson(res, 200, {
      ok: true,
      case: buildPublicCase(updated)
    });
  } catch (error) {
    if (handleBadJson(res, error)) {
      return;
    }

    if (error instanceof DocumentValidationError) {
      sendError(res, 400, error.message);
      return;
    }

    if (error instanceof PaymentRequiredError) {
      sendError(res, 409, error.message, { code: 'payment_required' });
      return;
    }

    if (error instanceof StoreConfigurationError) {
      sendError(res, 503, error.message, { code: 'storage_not_configured' });
      return;
    }

    console.error('document upload failed', error);
    sendError(res, 500, 'We could not upload the supporting documents.');
  }
};
