const { listAdminUsers, listAdminUsersForMigration } = require('./security');
const {
  getAnalyticsSummary,
  getAnalyticsOverview,
  getAdminCaseById,
  getDocumentInventory,
  getOpsJobSummary,
  getStorageHealth,
  listPartnerAccounts,
  listAdminCases,
  listAdminCaseSummaries,
  listAnalyticsEventsForMigration,
  listCaseRecordsForMigration
} = require('./store');
const { getSystemArchitectureProfile, hasDatabaseRuntime } = require('./system-architecture');

function createOperationsRepository() {
  const storage = getStorageHealth();

  return {
    provider: hasDatabaseRuntime() ? 'postgres' : storage.mode,
    getArchitectureProfile: getSystemArchitectureProfile,
    getAnalyticsOverview,
    getAnalyticsSummary,
    getAdminCaseById,
    getDocumentInventory,
    getOpsJobSummary,
    getStorageHealth,
    listPartnerAccounts,
    listAdminCases,
    listAdminCaseSummaries,
    listAdminUsers,
    listAdminUsersForMigration,
    listAnalyticsEventsForMigration,
    listCaseRecordsForMigration
  };
}

module.exports = {
  createOperationsRepository
};
