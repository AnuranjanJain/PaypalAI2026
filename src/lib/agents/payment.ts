import type { SupabaseClient } from "@supabase/supabase-js";

type AutopilotOrder = { orderId: string; approvalUrl: string | null; status: string };

async function accessToken(baseUrl: string) {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(`${baseUrl}/v1/oauth2/token`, { method: "POST", headers: { Accept: "application/json", "Accept-Language": "en_US", Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials", cache: "no-store" });
  if (!response.ok) return null;
  const payload = await response.json() as { access_token?: string };
  return payload.access_token ?? null;
}

/** Create a buyer-approval order after all server-side policy gates pass. Capture remains human/PayPal-authoritative. */
export async function createAutopilotOrder(admin: SupabaseClient, pactId: string, milestoneId: string): Promise<AutopilotOrder | null> {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET || !process.env.APP_URL) return null;
  const { data: pact } = await admin.from("pacts").select("workspace_id, status").eq("id", pactId).maybeSingle();
  const { data: milestone } = await admin.from("milestones").select("id, amount_cents, status").eq("id", milestoneId).eq("pact_id", pactId).maybeSingle();
  if (!pact || pact.status !== "active" || !milestone || milestone.status !== "approved") return null;
  const [{ data: dispute }, { data: scope }, { data: owner }] = await Promise.all([
    admin.from("disputes").select("id").eq("pact_id", pactId).eq("milestone_id", milestoneId).in("status", ["open", "under_review"]).limit(1).maybeSingle(),
    admin.from("scope_change_orders").select("id").eq("pact_id", pactId).eq("milestone_id", milestoneId).in("status", ["draft", "pending_owner", "pending_provider"]).limit(1).maybeSingle(),
    admin.from("workspace_members").select("user_id").eq("workspace_id", pact.workspace_id).eq("role", "owner").limit(1).maybeSingle(),
  ]);
  if (dispute || scope || !owner?.user_id) return null;
  const { data: existing } = await admin.from("pact_payment_events").select("paypal_order_id, approval_url, status").eq("milestone_id", milestoneId).in("status", ["created", "captured", "payout_pending", "paid_to_provider"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing?.paypal_order_id) return { orderId: existing.paypal_order_id, approvalUrl: existing.approval_url, status: existing.status };
  const baseUrl = (process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com").replace(/\/$/, "");
  const token = await accessToken(baseUrl);
  if (!token) return null;
  const returnUrl = `${process.env.APP_URL.replace(/\/$/, "")}/workspace/${pact.workspace_id}/pact/${pactId}?payment=approved`;
  const cancelUrl = `${process.env.APP_URL.replace(/\/$/, "")}/workspace/${pact.workspace_id}/pact/${pactId}?payment=cancelled`;
  // Keep retries for the same milestone on one PayPal idempotency key. A worker
  // can crash after PayPal accepts the order but before the ledger insert.
  const requestId = `pact-autopilot-${milestoneId}`;
  const orderResponse = await fetch(`${baseUrl}/v2/checkout/orders`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": requestId }, body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ amount: { currency_code: "USD", value: (Number(milestone.amount_cents) / 100).toFixed(2) }, description: "PayPal Pact milestone payment" }], application_context: { return_url: returnUrl, cancel_url: cancelUrl, user_action: "PAY_NOW" } }), cache: "no-store" });
  if (!orderResponse.ok) return null;
  const order = await orderResponse.json() as { id?: string; status?: string; links?: Array<{ rel?: string; href?: string }> };
  if (!order.id) return null;
  const approvalUrl = order.links?.find((link) => link.rel === "approve")?.href ?? null;
  const { error } = await admin.from("pact_payment_events").insert({ pact_id: pactId, milestone_id: milestoneId, owner_id: owner.user_id, paypal_order_id: order.id, approval_url: approvalUrl, amount_cents: milestone.amount_cents, currency: "USD", status: "created" });
  if (error) {
    const { data: raced } = await admin.from("pact_payment_events").select("paypal_order_id, approval_url, status").eq("milestone_id", milestoneId).in("status", ["created", "captured", "payout_pending", "paid_to_provider"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (raced?.paypal_order_id) return { orderId: raced.paypal_order_id, approvalUrl: raced.approval_url, status: raced.status };
    return null;
  }
  const { data: eventId } = await admin.rpc("record_pact_event", {
    target_pact: pactId,
    target_event_type: "payment.order_created",
    target_aggregate_type: "payment",
    target_aggregate_id: milestoneId,
    target_payload: { milestoneId, orderId: order.id, amountCents: milestone.amount_cents, source: "agent-autopilot" },
    target_actor_type: "worker",
    target_idempotency_key: `payment.order_created:${order.id}`,
  });
  if (typeof eventId === "string") {
    await admin.rpc("enqueue_agent_run", { target_event_id: eventId, target_agent: "dispute_shield", target_input_snapshot: { milestoneId, orderId: order.id, source: "agent-autopilot" }, target_max_attempts: 3 });
  }
  return { orderId: order.id, approvalUrl, status: order.status ?? "CREATED" };
}
