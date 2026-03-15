# Supabase Setup

This folder makes Departed Digital ready to move from the current Blob-backed prototype into a proper Supabase-backed operating system.

## What is already prepared

- Supabase-native migrations in `supabase/migrations/`
- a local Supabase config in `supabase/config.toml`
- export tooling for the current live operational state
- SQL seed rendering for the first import

## What has **not** happened yet

- no Supabase cloud project has been created
- no paid infrastructure has been provisioned
- no production cutover has happened

## Recommended rollout

1. Create a free Supabase project.
2. Copy the project URL and keys.
3. Link this repo to that project.
4. Push the migrations in `supabase/migrations/`.
5. Export the current operational data from the live-configured app environment.
6. Render the seed SQL and import it.
7. Switch the application repository from Blob case storage to Postgres-backed case storage.

## Commands

Log in to Supabase CLI:

```bash
npx supabase login
```

Link the project:

```bash
npx supabase link --project-ref <project-ref>
```

Push schema changes:

```bash
npx supabase db push
```

Generate database types after linking:

```bash
mkdir -p supabase/types
npx supabase gen types typescript --linked --schema public > supabase/types/database.generated.ts
```

Import a rendered seed into the hosted database:

```bash
DATABASE_URL="postgresql://..." npm run db:import-seed -- exports/<seed-file>.sql
```

## Environment variables we will need later

- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## Approval gate

Before any hosted setup:

- Steven approves `Supabase`
- Steven approves `free tier only` or a paid ceiling
- Steven approves the project creation step
