const { getPublicConfig } = require('./_lib/config');
const { getEmailHealth } = require('./_lib/email');
const { allowCors, methodNotAllowed, sendJson } = require('./_lib/http');
const { createOperationsRepository } = require('./_lib/operations-repository');

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

  const repository = createOperationsRepository();
  const storage = repository.getStorageHealth();
  const architecture = repository.getArchitectureProfile();
  const jobs = await repository.getOpsJobSummary();
  const analytics = await repository.getAnalyticsSummary();
  const email = getEmailHealth();

  sendJson(res, 200, {
    ok: true,
    config: getPublicConfig(),
    storage,
    health: {
      checkedAt: new Date().toISOString(),
      productionGrade: Boolean(architecture.readiness && architecture.readiness.productionGrade),
      caseStore: architecture.current.caseStore,
      analyticsStore: architecture.current.analyticsStore,
      documentStore: architecture.current.documentStore,
      auth: architecture.current.auth,
      workflowEngine: architecture.current.workflowEngine,
      queuedJobs: jobs.queued,
      dueJobs: jobs.dueNow,
      failedJobs: jobs.failed,
      emailProvider: email.provider,
      emailEnabled: email.enabled,
      analyticsEvents: analytics.totalEvents
    }
  });
};
