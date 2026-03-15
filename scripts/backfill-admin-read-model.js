const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile(envPath) {
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) {
      continue;
    }
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function main() {
  const envPath = process.argv[2];
  if (envPath) {
    loadEnvFile(path.resolve(envPath));
  }

  const { backfillAdminReadModel } = require('../api/_lib/store');
  const result = await backfillAdminReadModel();
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
