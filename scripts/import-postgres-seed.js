const fs = require('node:fs/promises');
const path = require('node:path');

const { closePool, query } = require('../api/_lib/db');

async function main() {
  const seedPath = process.argv[2];

  if (!seedPath) {
    console.error('Usage: npm run db:import-seed -- exports/<seed-file>.sql');
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), seedPath);
  const sql = await fs.readFile(resolvedPath, 'utf8');

  await query(sql);

  process.stdout.write(JSON.stringify({
    ok: true,
    imported: resolvedPath
  }, null, 2) + '\n');
}

main()
  .catch((error) => {
    console.error('postgres_seed_import_failed');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
