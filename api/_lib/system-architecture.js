const { getStorageHealth } = require('./store');

function hasDatabaseRuntime() {
  return Boolean(process.env.DATABASE_URL);
}

function getSystemArchitectureProfile() {
  const storage = getStorageHealth();
  const usingDatabase = hasDatabaseRuntime();
  const documentStore = storage.backingStore === 'blob' ? 'vercel_blob' : 'local_filesystem';
  const hasQueuedJobs = Boolean(usingDatabase && process.env.CRON_SECRET);

  return {
    current: {
      applicationHost: 'vercel',
      caseStore: usingDatabase ? 'postgres' : storage.mode,
      documentStore,
      auth: usingDatabase ? 'database_backed_sessions' : 'session_cookie',
      analyticsStore: usingDatabase ? 'postgres' : storage.mode,
      workflowEngine: hasQueuedJobs ? 'queued_jobs' : 'inline'
    },
    target: {
      applicationHost: 'vercel',
      caseStore: 'postgres',
      documentStore: 'object_storage',
      auth: 'database_backed_sessions',
      analyticsStore: 'postgres',
      workflowEngine: 'queued_jobs'
    },
    readiness: {
      transactionalCaseStore: usingDatabase,
      durableDocumentStore: storage.backingStore === 'blob',
      durableAnalyticsStore: usingDatabase || storage.mode === 'blob',
      productionGrade: usingDatabase && storage.backingStore === 'blob' && hasQueuedJobs
    },
    approvalGates: [
      'Resend is still required before outbound email automation can go live.',
      'Stripe is still required before payment webhooks and auto-activation can go live.',
      'Queued jobs are active only when CRON_SECRET is configured and the Vercel cron route is deployed.'
    ]
  };
}

module.exports = {
  getSystemArchitectureProfile,
  hasDatabaseRuntime
};
