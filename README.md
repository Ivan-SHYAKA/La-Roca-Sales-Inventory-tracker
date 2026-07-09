# La Roca Operations System

React (Vite) + Supabase rebuild of the La Roca prototype. Screens, roles, and business
logic follow `../la_roca_build_spec.md` and the original `../la_roca_system.jsx`; only
the data layer changed (Supabase Postgres + Auth + Realtime instead of `window.storage`).

## One-time Supabase setup

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. In the SQL Editor, run `supabase/migrations/0001_init.sql` once. This creates the
   tables, the inventory-ledger trigger, and all RLS policies.
3. Deploy the `admin-users` edge function (creates staff accounts — needs the
   service_role key, which never reaches the browser):
   - Via CLI: `npx supabase login`, then `npx supabase link --project-ref <ref>`,
     then `npx supabase functions deploy admin-users`.
   - Or paste `supabase/functions/admin-users/index.ts` into the Dashboard's
     Edge Functions editor and deploy from there.
4. Copy `.env.example` to `.env.local` and fill in Project Settings -> API:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

## Local development

```
npm install
npm run dev
```

Open the printed local URL. Since no accounts exist yet, you'll land on "Set up La
Roca" — create the first manager account there.

## Notes on the auth model

The UI keeps the original username/password login (no email field, to preserve the
screens as specified). Under the hood each user gets a synthetic Supabase Auth email
of `<username>@laroca.internal`; this is invisible to staff.

Only a manager can create or disable accounts. Creating an account (including the
very first bootstrap manager) goes through the `admin-users` edge function, since
that's the only place allowed to hold the service_role key. Disabling/enabling an
existing account is a direct, RLS-checked update from the client.

## Deploying

Not done yet — this repo currently targets local development against your Supabase
project. Vercel or Netlify (free tier) both work for the static Vite build; ask when
you're ready and we'll wire up the deploy.
