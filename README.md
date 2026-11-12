# PayPal Pact

**Work is verified. Progress is paid.**

PayPal Pact is a PayPal AI Hackathon prototype for milestone-controlled payments. A project owner creates a Pact, both participants connect private GitHub and Figma resources, four policy-aware agents evaluate the evidence, and the owner accepts or requests a revision before the corresponding PayPal milestone payment can be captured.

The public landing page explains the product and links into Supabase email or Google sign-in. The authenticated workspace flow supports account access, dynamic Owner / Buyer and Provider / Seller paths, workspace selection and creation, Pact drafts, editable budgets and milestone schedules, email-bound provider invitations, and owner-controlled workspace deletion with confirmation. A provider accepts an invitation by signing in with the invited email; acceptance activates the Pact and grants access only to that Pact. One Supabase account can be an owner in one workspace and a provider in another. `/walkthrough` is a clearly labelled, repeatable sample journey for judges.

![PayPal Pact](public/pact-supplied-artwork.png)

## Judge workflow

1. Open `/walkthrough` and review the generated 30/50/75/100% Pact for the **Brand identity kit**.
2. Select the 50% milestone, which is waiting for owner review.
3. Choose **Request revision** to demonstrate a failed second verification step. Payment remains blocked.
4. Choose **Resubmit evidence** to return the milestone to review.
5. Open **View evidence** and choose **Run evidence check**. The report identifies whether Muse or the deterministic verifier returned the result. The listed evidence is sample metadata, not uploaded files.
6. Choose **Approve & pay $200** to create a PayPal order after an eligible result. With no credentials it returns an explicit sandbox fallback; with sandbox credentials it opens a PayPal approval state.
7. Choose **Open PayPal sandbox approval**, complete buyer approval in the sandbox, return to Pact, and choose **I approved in PayPal — capture payment**. The pending order is retained in the same browser tab for recovery after a refresh; cancelling PayPal approval leaves it unpaid.
8. Switch to **Provider** to see the evidence checklist and resubmission path.
9. Switch back to **Owner**, choose **Request change**, and review the AI-detected out-of-scope mobile-app change order.

The intended product rule is: **the Delivery Agent checks completion; the Project Owner confirms acceptance; PayPal moves only the approved milestone amount.**

## Hackathon alignment

PayPal is the settlement authority. The sandbox path creates an order for the exact approved milestone, waits for buyer approval, captures the order, and records provider payout status separately. The PayPal webhook route verifies signed deliveries and reconciles capture and payout states. When Payouts is unavailable, capture remains recorded and the provider payout is visibly blocked. Meta Muse powers Progress, ScopeShield, DisputeShield, and Negotiation agents; only low-risk progress and scope checks can use a labeled deterministic fallback. Owner acceptance, negotiation decisions, buyer approval, capture, and PayPal payout confirmation remain mandatory gates.

The prototype is designed for the hackathon requirements: a working web experience, a public source repository with a license, documented setup, a clear PayPal + AI explanation, and a short end-to-end demo. The Pact Ledger is an inspectable ledger surface for milestone, evidence, decision, and payment events. Sponsor tools are only described as integrations when they are present and verified in the repository.

## Current integration boundaries and limitations

- `/walkthrough` uses seeded client-side state so the judge journey is repeatable without credentials. It is separate from authenticated workspaces.
- The visible approval interaction calls the PayPal order and capture routes. PayPal Sandbox credentials are required; an unavailable PayPal capability remains blocked and is never presented as paid.
- `POST /api/paypal/order` creates a PayPal Sandbox order when credentials are configured. `POST /api/paypal/order/[orderId]/capture` captures that order only after PayPal confirms buyer approval.
- PayPal Orders lifecycle: create the order (`CREATED`) with `POST /api/paypal/order`, send the user to the returned PayPal approval link, receive the user at the validated `returnUrl` or `cancelUrl`, then capture the approved order with `POST /api/paypal/order/[orderId]/capture`. Preserve the returned PayPal links and reconcile the final state from webhooks in production. Redirect URLs must be HTTPS (localhost HTTP is allowed for local development).
- `POST /api/pact/verify` uses a validated structured AI Responses API adapter when `AI_API_KEY` (or `MODEL_API_KEY`) and `AI_API_URL` are configured, and falls back to the deterministic verifier when the provider is unavailable or returns invalid output.
- The prototype does not claim legal escrow, autonomous production settlement, production fraud detection, or a legally binding contract. The correct description is **sandbox milestone-controlled settlement**.
- Authenticated accounts, workspace membership, Pact drafts, draft editing, provider invitations, evidence notes and links, owner review, verification results, connector snapshots, agent runs, exceptions, negotiations, and payment events use Supabase. The connector layer supports private GitHub repositories and Figma files with encrypted server-side tokens, one-time OAuth state, resource webhooks, normalized events, and idempotent evidence snapshots. Any capability not configured in the current Supabase, provider OAuth app, Meta Muse, or PayPal project is shown as unavailable or pending. The walkthrough's evidence and payment state is illustrative and must not be used to protect real transactions.
- `src/proxy.ts` refreshes Supabase browser sessions at the request boundary; page, action, and API authorization checks still run independently.
- After capture, the owner can request a separate provider payout. The payout route reconciles PayPal Payouts responses into `payout_pending`, `paid_to_provider`, or `failed`; an unavailable Payouts capability leaves the captured payment recorded and visibly blocked.
- `/api/agents/worker` is protected by `AGENT_WORKER_SECRET` or `CRON_SECRET`. It claims one queued run at a time, persists typed output and provenance, and is safe to invoke repeatedly from a Vercel Cron job or another scheduler. `/api/connectors/reconcile` uses the same protection and refreshes expired connector tokens, detects deleted private resources, and backfills a bounded recent GitHub/Figma evidence window when a webhook was missed.

## Run locally

Account access requires a Supabase project:

1. Create a project at https://supabase.com/dashboard. In its Connect/API settings, find the project URL and publishable (or legacy anon) key. Add these to `.env.local`:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
   APP_URL=http://localhost:3000
   ```

   For legacy projects, `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also supported. Do not put the service-role or secret key in a `NEXT_PUBLIC_` variable.
2. In Supabase SQL Editor, run every file in `supabase/migrations/` in filename order. Migrations `202611120025_connector_foundation.sql` and `202611120026_connector_participant_access.sql` add encrypted connector metadata, OAuth state, resource mapping, and connector event storage. Migration `202611120027_agent_runtime.sql` adds the immutable Pact event outbox, agent runs/actions, progress snapshots, scope changes, disputes, and negotiations. `202611120028_connector_picker_metadata.sql` adds private resource filters and Figma picker metadata, while `202611120029_security_and_payout_hardening.sql` closes direct browser writes to participant-visible tables and prevents payouts from starting after a failed capture. `202611120030_human_decisions.sql` adds participant dispute creation and two-party negotiation decisions. `202611120031_payment_mutation_hardening.sql` restricts payment order, capture, payout, and cancellation ledger mutators to the Supabase service role used by the PayPal server routes. `202611120032_payment_service_role_context.sql` makes those server-only RPCs resolve the Pact owner correctly when called with the service role. Each file is a complete query and should be pasted into a fresh SQL editor query. Use a new project or check for conflicting objects before applying them.

   If Supabase reports that a newly created table or function is missing from the schema cache, run `NOTIFY pgrst, 'reload schema';` once in the SQL Editor, wait a few seconds, and rerun `npm run check:supabase`.

   Paste each migration as its own complete query. If the SQL editor adds an `ALTER TABLE current_status ENABLE ROW LEVEL SECURITY` line or `-- source: dashboard` metadata inside a `$$` function body, clear those injected lines and paste the migration text again; `current_status` is a function variable, not a table.

   If migration 016 was interrupted by the SQL editor, do not rerun or partially select 016. After migrations 004 and 008 are present, paste `supabase/migrations/202611110021_repair_payout_ledger_complete.sql` as one complete query and run it once. It replaces the three payout functions together and is safe to run again. Migrations 018, 019, and 020 are equivalent per-function recovery files for older checkouts. Finally run migrations `202611110022_provider_payment_visibility.sql`, `202611110023_harden_evidence_links.sql`, and `202611120024_delete_workspace.sql` so accepted providers can follow payment status, direct RPC evidence submissions use the same URL rules as the UI, and owners can delete a workspace from Settings.
3. In Authentication URL Configuration, set the site URL to `http://localhost:3000` and add `http://localhost:3000/auth/callback` to the redirect allowlist. For a deployed app, add its HTTPS origin and callback as well.
4. Enable the email provider. To enable Google, create a Google OAuth web client, add the Supabase Google callback URL shown in the Supabase provider settings to Google's authorized redirect URIs, then enter that client's ID and secret in Supabase. Keep Google credentials out of this repository.
5. Set `APP_URL` to the app's public HTTPS origin when deployed. Restart the dev server after adding environment variables. Visit `/`, choose **Sign in** or **Create account**, confirm the email if required, and choose or create a workspace. Creating a Pact opens its detail page, where the owner can edit the draft or choose **Continue setup** to invite a provider. The provider signs in with the invited email, accepts the Pact, and lands on its active detail page.

6. For GitHub, use an OAuth application: register `${APP_URL}/api/connectors/github/callback`, grant repository read access, pull request read access, and repository webhook administration, and set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_OAUTH_SCOPES`. GitHub App installation setup is intentionally disabled for new connections until the setup callback can associate its `installation_id` with the installing GitHub user; the App credentials remain in the environment template for a future verified flow. For Figma, create an OAuth app with `${APP_URL}/api/connectors/figma/callback`, PKCE enabled, and `current_user:read`, `projects:read`, file-content, comments, and webhook scopes; set `FIGMA_CLIENT_ID`, `FIGMA_CLIENT_SECRET`, and `FIGMA_OAUTH_SCOPES`. Generate a 32-byte key for `CONNECTOR_TOKEN_ENCRYPTION_KEY`; never expose it through `NEXT_PUBLIC_*` variables.
7. Configure `SUPABASE_SERVICE_ROLE_KEY`, `AGENT_WORKER_SECRET` (or `CRON_SECRET`), and the PayPal `PAYPAL_WEBHOOK_ID` in the deployment environment. Register `/api/paypal/webhook` in PayPal Developer Dashboard for capture and payout events. The webhook route rejects unsigned or unmatched deliveries and never marks a payment paid without a PayPal status. The included Vercel schedules run once daily on Hobby plans; each worker tick drains a bounded `AGENT_BATCH_SIZE` queue (12 by default). Invoke `/api/agents/worker` and `/api/connectors/reconcile` manually with the worker secret for an immediate demo run, or switch the schedules to per-minute/per-five-minute expressions on a Vercel plan that supports them.

The public landing page is at `/`; the repeatable sample journey is at `/walkthrough`; authenticated workspace routes live under `/workspace`. Do not deploy seeded walkthrough payment endpoints as production transaction endpoints. A successful PayPal capture is distinct from a provider payout, and the UI must retain that distinction.

```bash
npm install
npm run dev
```

Open http://localhost:3000 (or the alternate port printed by Next.js).

After applying the Supabase migrations, run `npm run check:supabase`. It checks the connector, evidence, agent, dispute, and negotiation objects through the public API without printing credentials. Run `npm run check:muse` to exercise all four structured Meta Muse contracts and `npm run check:paypal` to create a small sandbox order and verify that PayPal rejects capture before buyer approval. A non-zero result means the database, AI provider, or PayPal sandbox is not ready for the authenticated Pact flow.

## Demo video

The repository does not include a video binary. For a clean submission capture, record the landing page and the verified `/walkthrough` or authenticated flow at 16:9, then link the published video here. Keep the export framed to the viewport so the README embed has no letterbox bars.

Useful checks:

```bash
npm run check:supabase
npm run check:muse
npx eslint
npx next build
npm test
```

`npm run check:supabase` is read-only. It checks the connector and agent objects in the configured Supabase schema, reports server-only configuration without printing values, verifies a valid `APP_URL`, GitHub OAuth, Figma OAuth, and `PAYPAL_WEBHOOK_ID`, and verifies PayPal Sandbox OAuth when its credentials are present. A missing object means migrations `202611120025` through `202611120032` still need to be run after the earlier Pact migrations.

## Architecture

- Next.js App Router + TypeScript
- Server-side PayPal Orders, capture, payout reconciliation, and signed webhooks
- Structured Meta Muse outputs validated before they can create a proposal or snapshot
- PostgreSQL persistence for Pacts, milestones, connector evidence, approvals, payments, agents, change orders, disputes, negotiations, and audit events
- Vercel-compatible protected worker endpoint with Supabase RLS and service-role reconciliation

The target architecture represents sandbox milestone-controlled settlement: the AI verifies objective evidence, the owner approves the outcome, and PayPal moves the approved amount.

## Security boundaries

PayPal credentials and AI keys must stay server-side. Amount limits, milestone totals, owner approval, idempotency, and webhook verification must be enforced by the backend. The Delivery Agent cannot release funds.

## License

MIT. See [LICENSE](LICENSE).
