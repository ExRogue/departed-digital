const fs = require('node:fs/promises');
const path = require('node:path');

const { createOperationsRepository } = require('../api/_lib/operations-repository');

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function main() {
  const exportDir = path.join(process.cwd(), 'exports');
  const stamp = timestampSlug();
  const outputPath = path.join(exportDir, `ops-snapshot-${stamp}.json`);

  await fs.mkdir(exportDir, { recursive: true });

  const repository = createOperationsRepository();

  const [users, rawCases, adminCases, analyticsEvents, documentInventory] = await Promise.all([
    repository.listAdminUsersForMigration(),
    repository.listCaseRecordsForMigration(),
    repository.listAdminCases(),
    repository.listAnalyticsEventsForMigration(),
    repository.getDocumentInventory()
  ]);
  const storage = repository.getStorageHealth();

  const snapshot = {
    exportedAt: new Date().toISOString(),
    source: {
      cwd: process.cwd(),
      provider: repository.provider,
      storage,
      architecture: repository.getArchitectureProfile()
    },
    summary: {
      adminUsers: users.length,
      rawCases: rawCases.length,
      adminCases: adminCases.length,
      analyticsEvents: analyticsEvents.length,
      documentObjects: documentInventory.length
    },
    users,
    rawCases,
    adminCases,
    analyticsEvents,
    documentInventory
  };

  await fs.writeFile(outputPath, JSON.stringify(snapshot, null, 2));

  process.stdout.write(JSON.stringify({
    ok: true,
    outputPath,
    summary: snapshot.summary
  }, null, 2) + '\n');
}

main().catch((error) => {
  console.error('ops_snapshot_export_failed');
  console.error(error);
  process.exitCode = 1;
});
