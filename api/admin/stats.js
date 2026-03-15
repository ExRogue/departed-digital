const { ADMIN_ROLES, getPublicConfig } = require('../_lib/config');
const { getEmailHealth } = require('../_lib/email');
const { allowCors, methodNotAllowed, sendError, sendJson } = require('../_lib/http');
const { requireAdminAccess } = require('../_lib/security');
const { createOperationsRepository } = require('../_lib/operations-repository');

module.exports = async function handler(req, res) {
  allowCors(res, req);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET', 'OPTIONS']);
    return;
  }

  const adminCheck = await requireAdminAccess(req, 'dashboard.view');

  if (!adminCheck.ok) {
    sendError(res, adminCheck.statusCode, adminCheck.message);
    return;
  }

  try {
    const requestUrl = new URL(req.url, 'http://localhost');
    const view = requestUrl.searchParams.get('view') || 'operations';
    const repository = createOperationsRepository();
    const permissions = (adminCheck.session && adminCheck.session.permissions) || [];
    const shouldLoadCases = view === 'operations' || view === 'summary' || view === 'all';
    const shouldLoadAnalytics = view === 'analytics' || view === 'all';
    const shouldLoadPartners = view === 'partners' || view === 'all';
    const shouldLoadUsers = permissions.includes('users.manage') && (view === 'team' || view === 'all');
    const shouldLoadJobs = view === 'operations' || view === 'summary' || view === 'all';

    const storage = repository.getStorageHealth();
    const email = getEmailHealth();
    const [
      cases,
      analytics,
      jobs,
      users,
      partners
    ] = await Promise.all([
      shouldLoadCases ? repository.listAdminCaseSummaries() : Promise.resolve([]),
      shouldLoadAnalytics
        ? repository.getAnalyticsSummary()
        : Promise.resolve({}),
      shouldLoadJobs ? repository.getOpsJobSummary() : Promise.resolve({ queued: 0, dueNow: 0, failed: 0 }),
      shouldLoadUsers ? repository.listAdminUsers() : Promise.resolve([]),
      shouldLoadPartners ? repository.listPartnerAccounts() : Promise.resolve([])
    ]);
    const architecture = repository.getArchitectureProfile();
    const activeCases = cases.filter((entry) => !entry.archivedAt);
    const publicConfig = getPublicConfig();
    const configuredPaymentLinks = Object.values((publicConfig && publicConfig.paymentLinks) || {}).filter(Boolean);
    const automatedCheckoutEnabled = configuredPaymentLinks.length > 0;

    const blockedOrOverdueCases = activeCases.filter((entry) => entry.status === 'blocked' || (entry.workflow && (entry.workflow.queueKey === 'blocked' || entry.workflow.overdue))).length;

    const stats = {
      totalCases: activeCases.length,
      archivedCases: cases.filter((entry) => entry.archivedAt).length,
      awaitingPayment: activeCases.filter((entry) => entry.status === 'awaiting_payment').length,
      awaitingDocuments: activeCases.filter((entry) => entry.status === 'awaiting_documents' || entry.status === 'paid').length,
      activeCases: activeCases.filter((entry) => entry.status === 'documents_received' || entry.status === 'active' || entry.status === 'submitted').length,
      completedCases: activeCases.filter((entry) => entry.status === 'completed').length,
      blockedCases: activeCases.filter((entry) => entry.status === 'blocked' || (entry.workflow && entry.workflow.queueKey === 'blocked')).length,
      blockedOrOverdueCases,
      paidCases: activeCases.filter((entry) => entry.paymentStatus === 'paid').length,
      urgentCases: activeCases.filter((entry) => entry.priority === 'urgent').length,
      partnerCases: activeCases.filter((entry) => entry.referralPartnerType === 'funeral_director').length,
      partnerProspects: partners.filter((entry) => entry.status === 'prospect').length,
      unassignedCases: activeCases.filter((entry) => !entry.assignedTo).length,
      overdueCases: activeCases.filter((entry) => entry.workflow && entry.workflow.overdue).length,
      attentionCases: activeCases.filter((entry) => entry.workflow && entry.workflow.needsAttention).length,
      waitingOnClientCases: activeCases.filter((entry) => entry.workflow && (entry.workflow.waitingOn === 'client_payment' || entry.workflow.waitingOn === 'client_documents')).length,
      readyForSubmissionCases: activeCases.filter((entry) => entry.workflow && entry.workflow.queueKey === 'submission_queue').length,
      openReminders: activeCases.reduce((count, entry) => count + ((entry.workflow && entry.workflow.openReminderCount) || 0), 0),
      escalatedReminders: activeCases.reduce((count, entry) => count + ((entry.workflow && entry.workflow.escalatedReminderCount) || 0), 0),
      queuedAutomationJobs: jobs.queued,
      dueAutomationJobs: jobs.dueNow,
      failedAutomationJobs: jobs.failed,
      teamUsers: users.length,
      payments: {
        automatedCheckoutEnabled,
        configuredPackageCount: configuredPaymentLinks.length,
        mode: automatedCheckoutEnabled ? 'automated_checkout' : 'manual_handoff'
      },
      storage,
      email,
      architecture
    };

    if (shouldLoadAnalytics) {
      stats.analytics = analytics;
    }

    sendJson(res, 200, {
      ok: true,
      stats,
      cases,
      partners,
      users,
      roles: permissions.includes('users.manage') ? ADMIN_ROLES : []
    });
  } catch (error) {
    sendError(res, 500, 'We could not load dashboard stats.');
  }
};
