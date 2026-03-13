const { getEmailHealth } = require('../_lib/email');
const { allowCors, methodNotAllowed, sendError, sendJson } = require('../_lib/http');
const { requireAdminAccess } = require('../_lib/security');
const { getAnalyticsSummary, getDocumentInventory, getStorageHealth, listAdminCases } = require('../_lib/store');

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

  const adminCheck = requireAdminAccess(req);

  if (!adminCheck.ok) {
    sendError(res, adminCheck.statusCode, adminCheck.message);
    return;
  }

  try {
    const cases = await listAdminCases();
    const blobs = await getDocumentInventory();
    const storage = getStorageHealth();
    const analytics = await getAnalyticsSummary();
    const email = getEmailHealth();

    const stats = {
      totalCases: cases.length,
      awaitingPayment: cases.filter((entry) => entry.status === 'awaiting_payment').length,
      awaitingDocuments: cases.filter((entry) => entry.status === 'awaiting_documents' || entry.status === 'paid').length,
      activeCases: cases.filter((entry) => entry.status === 'documents_received' || entry.status === 'active' || entry.status === 'submitted').length,
      completedCases: cases.filter((entry) => entry.status === 'completed').length,
      paidCases: cases.filter((entry) => entry.paymentStatus === 'paid').length,
      documentsStored: blobs.length,
      urgentCases: cases.filter((entry) => entry.priority === 'urgent').length,
      partnerCases: cases.filter((entry) => entry.referralPartnerType === 'funeral_director').length,
      unassignedCases: cases.filter((entry) => !entry.assignedTo).length,
      overdueCases: cases.filter((entry) => entry.workflow && entry.workflow.overdue).length,
      attentionCases: cases.filter((entry) => entry.workflow && entry.workflow.needsAttention).length,
      waitingOnClientCases: cases.filter((entry) => entry.workflow && (entry.workflow.waitingOn === 'client_payment' || entry.workflow.waitingOn === 'client_documents')).length,
      readyForSubmissionCases: cases.filter((entry) => entry.workflow && entry.workflow.queueKey === 'submission_queue').length,
      storage,
      analytics,
      email
    };

    sendJson(res, 200, { ok: true, stats });
  } catch (error) {
    sendError(res, 500, 'We could not load dashboard stats.');
  }
};
