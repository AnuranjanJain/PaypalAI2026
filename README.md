# PayPal Pact

**Work is verified. Progress is paid.**

PayPal Pact is a PayPal AI Hackathon prototype for milestone-controlled payments. A project owner reviews a four-stage Pact, a Delivery Agent checks objective evidence, and the owner accepts or requests a revision before the corresponding progress payment is released.

The current browser experience is a deterministic seeded demo. Approval states include creating an order, capturing a payment, a pending/non-completed response, local cancellation of the in-flight attempt, and an error with retry. It is designed to make the complete product story reviewable without PayPal credentials: verification, revision, approval, progressive payment state, owner/provider views, and scope-change handling are all available from the dashboard. The repository also contains server-side PayPal order/capture and Pact verification routes.

## Demo workflow

1. Review the generated 30/50/75/100% Pact for the **Brand identity kit**.
2. Select the 50% milestone, which is waiting for owner review.
3. Choose **Request revision** to demonstrate a failed second verification step. Payment remains blocked.
4. Choose **Resubmit evidence** to return the milestone to review.
5. Choose **Approve & pay $200** to call the payment adapter. With no credentials it returns an explicit demo fallback; with sandbox credentials it creates and captures a PayPal order.
6. Switch to **Provider** to see the evidence checklist and resubmission path.
7. Switch back to **Owner**, choose **Request change**, and review the AI-detected out-of-scope mobile-app change order.

The intended product rule is: **the Delivery Agent checks completion; the Project Owner confirms acceptance; PayPal moves only the approved milestone amount.**

## Hackathon alignment

PayPal is central to the product concept and integration boundary. The target flow uses PayPal Orders/Checkout for milestone payment creation and capture, with Payouts, webhooks, and refund/cancellation handling as the production expansion path. AI is used to turn a natural-language brief into milestone acceptance criteria, compare evidence with those criteria, explain missing requirements, and flag scope changes. Owner approval remains mandatory.

The prototype is designed for the hackathon requirements: a working web experience, a public source repository with a license, documented setup, a clear PayPal + AI explanation, and a short end-to-end demo. The Pact Ledger is the planned AG Grid surface for milestone, evidence, decision, and payment events; APIMatic, Render, and Postman are documented as optional integration surfaces for the next build boundary.

## Current integration boundaries and limitations

- The dashboard currently uses seeded client-side state so the demo is repeatable without credentials.
- The visible approval interaction calls the PayPal order and capture routes. Without credentials those routes return a labelled demo fallback; with credentials they call PayPal Sandbox.
- `POST /api/paypal/order` creates a PayPal sandbox order when credentials are configured and returns a deterministic demo fallback otherwise. `POST /api/paypal/order/[orderId]/capture` captures a configured sandbox order or completes a demo order.
- PayPal Orders lifecycle: create the order (`CREATED`) with `POST /api/paypal/order`, send the user to the returned PayPal approval link, receive the user at the validated `returnUrl` or `cancelUrl`, then capture the approved order with `POST /api/paypal/order/[orderId]/capture`. Preserve the returned PayPal links and reconcile the final state from webhooks in production. Redirect URLs must be HTTPS (localhost HTTP is allowed for local development).
- `POST /api/pact/verify` currently uses the deterministic verifier in `src/lib/pact.ts`. It is provider-ready, but no external model call is included in the current repository.
- The prototype does not claim legal escrow, autonomous production settlement, production fraud detection, or a legally binding contract. The correct description is **sandbox milestone-controlled settlement**.
- Persistence, authenticated owner/provider roles, evidence uploads, webhook reconciliation, idempotency storage, and production AI adapters are planned integration work.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 (or the alternate port printed by Next.js).

Useful checks:

```bash
npx eslint
npx next build
```

## Architecture target

- Next.js App Router + TypeScript
- Server-side PayPal Orders, capture, refunds, and webhooks
- Structured AI outputs validated before they can affect Pact state
- PostgreSQL persistence for Pacts, milestones, evidence, approvals, payments, change orders, and audit events
- AG Grid Pact Ledger
- Render-hosted demo and Postman API collection

The target architecture represents sandbox milestone-controlled settlement: the AI verifies objective evidence, the owner approves the outcome, and PayPal moves the approved amount.

## Security boundaries

PayPal credentials and AI keys must stay server-side. Amount limits, milestone totals, owner approval, idempotency, and webhook verification must be enforced by the backend. The Delivery Agent cannot release funds.

## License

MIT. See [LICENSE](LICENSE).
