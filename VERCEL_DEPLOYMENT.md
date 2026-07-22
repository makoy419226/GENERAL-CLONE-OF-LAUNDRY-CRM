# Vercel deployment

This project deploys its Vite frontend as static files and its Express API as a
Vercel Node.js Function.

## 1. Create PostgreSQL

Create a managed PostgreSQL database that supports serverless connections, such
as Neon or Supabase. Import `database_export.sql` directly into that private
database; never commit or upload the export to the public GitHub repository.

## 2. Configure Vercel

Import the GitHub repository into Vercel. Keep the project root as the repository
root. `vercel.json` supplies the build command, output directory, API rewrite,
and SPA fallback.

Add these environment variables in Vercel for Production, Preview, and
Development as appropriate:

- `DATABASE_URL`
- `SESSION_SECRET`
- `BUSINESS_SECRETS_KEY`
- `SUPER_ADMIN_USERNAME`, `SUPER_ADMIN_PASSWORD`, `SUPER_ADMIN_NAME`, and `SUPER_ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_PIN`
- `ADMIN_EMAIL`
- `ADMIN_REPORT_EMAIL`
- `RESEND_API_KEY` and `RESEND_FROM_EMAIL`, or the SMTP variables

Use `.env.example` as the complete starting list. Do not add `.env` files to
Git.

The multi-business account bootstrap and platform-owner variables are described
in `MULTI_BUSINESS_SETUP.md`.

## 3. Prepare the schema

From a trusted local environment with `DATABASE_URL` pointing to the new hosted
database, run:

```bash
npm ci
npm run db:migrate
```

Import the existing SQL data only after confirming that the destination is the
correct private database.

## Runtime notes

- In-process scheduled reports are disabled on Vercel because functions do not
  stay alive between requests. Move scheduled reports to Vercel Cron before
  relying on them in production.
- Keep uploaded photos outside the function filesystem. Use object storage for
  durable uploads.
- Large delivery-photo request bodies should be uploaded directly to object
  storage rather than sent through the API function.
- The PostgreSQL pool is limited to one connection per function instance to
  reduce connection pressure during serverless scaling.
