# implexa-dashboard

Next.js 14 web dashboard for Implexa. Pages: login, signup, onboarding (Plan A picker), skills, pricing, settings (billing + api-keys).

## Quick start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#         NEXT_PUBLIC_IMPLEXA_API_URL (default: http://localhost:8001)

# 3. Run
npm run dev      # → http://localhost:3001
```

## Pages

| Route | Purpose |
|---|---|
| `/` | Redirects to `/login` or `/skills` based on auth |
| `/login` | Email/password + Google + Microsoft OAuth |
| `/signup` | New account → email confirmation OR direct OAuth |
| `/auth/callback` | OAuth/magic-link exchange → routes to onboarding or skills |
| `/onboarding` | Plan A picker — join existing same-domain org OR create fresh |
| `/skills` | Skill library (post-login landing) |
| `/pricing` | 4-tier plan picker with Stripe Checkout |
| `/settings/billing` | Current plan, balance, Stripe Customer Portal |
| `/settings/api-keys` | Generate / revoke `IMPLEXA_API_KEY` values for the plugin |

## How auth works

1. User signs up via Supabase Auth (email/password or OAuth).
2. `/auth/callback` exchanges the code for a session.
3. If the user has no `users` row → redirected to `/onboarding`.
4. `/onboarding` calls `GET /api/v2/auth/org-suggestion?email=...` to check if anyone with the same domain is already on Implexa.
5. If yes → "Join their workspace?" popup. User picks.
6. `POST /api/v2/auth/provision` finalizes — either joins an existing org or creates a fresh one. Personal-email domains never auto-create org rows with an email_domain.

## How billing works

1. User clicks "Upgrade" on `/pricing` → `POST /api/v2/billing/checkout`.
2. Backend creates a Stripe Customer (if needed) + Checkout Session.
3. User completes payment on Stripe Checkout.
4. Stripe redirects back to `/settings/billing?success=1`.
5. Stripe webhook fires `checkout.session.completed` → backend grants initial credits + activates subscription.
6. On `invoice.paid` (monthly), backend grants the next month's credit allotment.

## Tech

- Next.js 14 App Router
- `@supabase/ssr` for server-side auth (cookie-based)
- Tailwind CSS
- TypeScript

## Ports

- `3001` (Implexa dashboard) — to avoid clashing with the typical Next.js default of 3000

## Phase 2 polish (not yet shipped)

- Real skill detail pages
- Edit / activate / archive flows
- Outcome ROI page
- Share preview rendering at `/s/[token]`
- Audit log (Pro plan)
