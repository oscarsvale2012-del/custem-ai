# VYRON accounts — Supabase setup (about 10 minutes)

VYRON accounts (website + app) use a free Supabase project that **you** own.

## 1. Create the project
1. Go to https://supabase.com and sign up (free).
2. **New project** → name `vyron`, pick a strong database password (save it somewhere), region **Central EU (Frankfurt)** or the closest one.
3. Wait until it says the project is ready.

## 2. Create the data table
**SQL Editor → New query**, paste this, press **Run**:

```sql
-- One row per VYRON account: that person's saved VYRON data.
create table if not exists public.vyron_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Only the signed-in owner can read or change their own row.
alter table public.vyron_data enable row level security;

create policy "own data: read"   on public.vyron_data for select using (auth.uid() = user_id);
create policy "own data: insert" on public.vyron_data for insert with check (auth.uid() = user_id);
create policy "own data: update" on public.vyron_data for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own data: delete" on public.vyron_data for delete using (auth.uid() = user_id);
```

## 3. Make the emails send a code
**Authentication → Emails → Templates.** For each of these three templates, replace the message body:

- **Confirm signup** — subject `Your VYRON code`:
  ```html
  <h2>Welcome to VYRON</h2>
  <p>Your code is:</p>
  <p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
  <p>Type it in VYRON or on the VYRON website. If you didn't ask for this, ignore this email.</p>
  ```
- **Magic Link** — subject `Your VYRON login code`: same body, first line `<h2>Log in to VYRON</h2>`.
- **Reset Password** — subject `Reset your VYRON password`: same body, first line `<h2>Reset your VYRON password</h2>`.

**Authentication → Sign In / Providers → Email**: keep **Email** on and **Confirm email** on. Set the minimum password length to **8**.

## 4. Sending emails to everyone
Supabase's built-in email only sends to your own team's emails and only a few per hour — fine for testing, not for other people.
For real users: **Authentication → Emails → SMTP Settings**, turn on custom SMTP and use a free email service such as Resend or Brevo (they give you the host, port, user and password).

## 5. Give VYRON the project address and key
**Project Settings → API** (or **Connect**):
- **Project URL** — looks like `https://abcdxyz.supabase.co`
- **Publishable key** (or **anon public** key) — starts with `sb_publishable_` or `eyJ`

Send these two to Claude. They are **meant to be public** (the website and the app use them); never share the **secret** / **service_role** key.

## 6. "Continue with Google"
1. https://console.cloud.google.com → create a project (e.g. `VYRON`).
2. **APIs & Services → OAuth consent screen**: External, app name `VYRON`, your email. Publish it (or add yourself as a test user).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web application**.
   Under **Authorized redirect URIs** add: `https://YOUR-PROJECT.supabase.co/auth/v1/callback` (your Project URL + `/auth/v1/callback`).
4. Copy the **Client ID** and **Client secret**.
5. Supabase → **Authentication → Sign In / Providers → Google** → turn on, paste both, Save.
6. Supabase → **Authentication → URL Configuration → Redirect URLs** → add both:
   - `http://127.0.0.1:47212/**` (the VYRON app)
   - `https://oscarsvale2012-del.github.io/custem-ai/**` (the website)

## 7. Turn on the website
GitHub repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch **main**, folder **/docs** → Save.
After a minute it is live at `https://oscarsvale2012-del.github.io/custem-ai/`.
Then in Supabase **Authentication → URL Configuration**, set **Site URL** to that address.
