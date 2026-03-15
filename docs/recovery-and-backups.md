# Recovery And Backups

## Purpose

This document explains how to recover operational data and how to create a safe snapshot before any risky change.

## Production data locations

- Cases, analytics, sessions, partner prospects: `Supabase Postgres`
- Supporting documents: `Vercel Blob`
- Code and static pages: GitHub + Vercel deployments

## Snapshot workflow

Create a fresh operations snapshot before:

- changing schema
- changing storage providers
- doing a production cutover
- testing destructive case changes in bulk

### Export a snapshot

```bash
npm run ops:backup
```

This writes a timestamped JSON file into `exports/`.

## Security note

Snapshot files may contain sensitive personal data and should not be committed, shared casually, or left sitting in a sync folder. The repo now ignores `exports/` and `supabase/.temp/`.

## Render a Postgres seed

```bash
npm run ops:render-seed -- exports/<snapshot-file>.json
```

This creates SQL that can be imported into Postgres for recovery or cutover work.

## Import a Postgres seed

```bash
npm run db:import-seed -- exports/<seed-file>.sql
```

Only do this against the intended target database.

## Recommended operating rhythm

- Before structural changes: take a fresh snapshot
- After important launches: take a fresh snapshot
- Before deleting or bulk-archiving records: take a fresh snapshot

## Recovery priorities

If production has an issue, restore in this order:

1. Admin access
2. Case records
3. Document metadata
4. Partner prospects
5. Analytics history

## Manual document recovery note

Case records and document metadata live separately from the document blobs themselves. If Blob access fails, preserve the case database first, then restore document access paths and verify references against the case records.
