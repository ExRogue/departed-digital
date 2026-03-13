const { allowCors, methodNotAllowed, sendError, sendJson } = require('../_lib/http');
const { requireAdminKey } = require('../_lib/security');
const { getDocumentInventory, getStorageHealth, listAdminCases } = require('../_lib/store');

module.exports = async function handler(req, res) {
  allowCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET', 'OPTIONS']);
    return;
  }

  const adminCheck = requireAdminKey(req);

  if (!adminCheck.ok) {
    sendError(res, adminCheck.statusCode, adminCheck.message);
    return;
  }

  try {
    const cases = await listAdminCases();
    const blobs = await getDocumentInventory();
    const storage = getStorageHealth();

    const stats = {
      totalCases: cases.length,
      awaitingPayment: cases.filter((entry) => entry.status === 'awaiting_payment').length,
      awaitingDocuments: cases.filter((entry) => entry.status === 'awaiting_documents' || entry.status === 'paid').length,
      activeCases: cases.filter((entry) => entry.status === 'documents_received' || entry.status === 'active' || entry.status === 'submitted').length,
      completedCases: cases.filter((entry) => entry.status === 'completed').length,
      paidCases: cases.filter((entry) => entry.paymentStatus === 'paid').length,
      documentsStored: blobs.length,
      storage
    };

    sendJson(res, 200, { ok: true, stats });
  } catch (error) {
    sendError(res, 500, 'We could not load dashboard stats.');
  }
};
