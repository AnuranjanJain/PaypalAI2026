import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { getRequestId, parseRedirectUrl, paypalError } from "@/lib/paypal";
import { emitPactAgentEvent } from "@/lib/agents/events";

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

export async function POST(request: Request) {
  let body: { pactId?: unknown; milestoneId?: unknown; returnUrl?: unknown; cancelUrl?: unknown };
  try { body = await request.json(); } catch { return paypalError(400, "Request body must be valid JSON."); }
  if (!validId(body.pactId) || !validId(body.milestoneId)) return paypalError(400, "Pact and milestone are required.");
  const returnUrl = parseRedirectUrl(body.returnUrl);
  const cancelUrl = parseRedirectUrl(body.cancelUrl);
  if (!returnUrl || !cancelUrl) return paypalError(400, "Return and cancel URLs must be absolute HTTPS URLs.");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return paypalError(401, "Sign in to create a payment.");
  const { data: pact } = await supabase.from("pacts").select("workspace_id, status").eq("id", body.pactId).maybeSingle();
  if (!pact || pact.status !== "active") return paypalError(404, "Active Pact not found.");
  const { data: membership } = await supabase.from("workspace_members").select("role").eq("workspace_id", pact.workspace_id).eq("user_id", user.id).maybeSingle();
  if (membership?.role !== "owner") return paypalError(403, "Only the Pact owner can start checkout.");
  const { data: milestone } = await supabase.from("milestones").select("id, amount_cents, status").eq("id", body.milestoneId).eq("pact_id", body.pactId).maybeSingle();
  if (!milestone || milestone.status !== "approved") return paypalError(409, "Approve the milestone before starting PayPal checkout.");
  const [{ data: openDispute }, { data: pendingScope }] = await Promise.all([
    supabase.from("disputes").select("id").eq("pact_id", body.pactId).eq("milestone_id", body.milestoneId).in("status", ["open", "under_review"]).limit(1).maybeSingle(),
    supabase.from("scope_change_orders").select("id").eq("pact_id", body.pactId).eq("milestone_id", body.milestoneId).in("status", ["draft", "pending_owner", "pending_provider"]).limit(1).maybeSingle(),
  ]);
  if (openDispute) return paypalError(409, "Resolve the open milestone dispute before starting checkout.");
  if (pendingScope) return paypalError(409, "Resolve the pending scope change before starting checkout.");
  const admin = tryCreateAdminClient();
  if (!admin) return paypalError(503, "Payment storage is not configured for server-side settlement.");

  const existing = await supabase.from("pact_payment_events")
    .select("paypal_order_id, approval_url, status, payout_status")
    .eq("milestone_id", body.milestoneId)
    .in("status", ["created", "captured", "payout_pending", "paid_to_provider", "failed"])
    .order("created_at", { ascending: false });
  if (existing.error) return paypalError(503, "Payment storage is not ready. Apply the latest Supabase migration first.");
  const reusableEvent = (existing.data ?? []).find((event) => event.status !== "failed" || event.payout_status === "failed");
  if (reusableEvent?.paypal_order_id) return NextResponse.json({ mode: "existing", orderId: reusableEvent.paypal_order_id, approvalUrl: reusableEvent.approval_url, status: reusableEvent.status, payoutStatus: reusableEvent.payout_status });
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) return paypalError(503, "PayPal Sandbox credentials are not configured.");

  const baseUrl = (process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com").replace(/\/$/, "");
  const credentials = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  try {
    const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, { method: "POST", headers: { Accept: "application/json", "Accept-Language": "en_US", Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials", cache: "no-store" });
    if (!tokenResponse.ok) return paypalError(502, "PayPal authorization failed.");
    const token = await tokenResponse.json() as { access_token?: string };
    if (!token.access_token) return paypalError(502, "PayPal authorization returned an invalid response.");
    const amount = (milestone.amount_cents / 100).toFixed(2);
    const orderResponse = await fetch(`${baseUrl}/v2/checkout/orders`, { method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json", "PayPal-Request-Id": getRequestId(request, "pact-auth") }, body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ amount: { currency_code: "USD", value: amount }, description: "PayPal Pact milestone payment" }], application_context: { return_url: returnUrl, cancel_url: cancelUrl, user_action: "PAY_NOW" } }), cache: "no-store" });
    if (!orderResponse.ok) return paypalError(502, "PayPal order creation failed.");
    const order = await orderResponse.json() as { id?: string; status?: string; links?: unknown };
    if (!order.id) return paypalError(502, "PayPal returned an invalid order.");
    const approvalUrl = Array.isArray(order.links) ? (order.links as Array<{ rel?: string; href?: string }>).find((link) => link.rel === "approve")?.href ?? null : null;
    const { error: insertError } = await admin.rpc("record_pact_payment_event", { target_pact: body.pactId, target_milestone: body.milestoneId, target_order_id: order.id, target_approval_url: approvalUrl, target_amount_cents: milestone.amount_cents });
    if (insertError) {
      // A concurrent request may have won the milestone's unique active-order race.
      // Return that durable order so the caller can continue checkout instead of creating another one.
      const { data: recordedEvent } = await supabase.from("pact_payment_events")
        .select("paypal_order_id, approval_url, status, payout_status")
        .eq("milestone_id", body.milestoneId)
        .in("status", ["created", "captured", "payout_pending", "paid_to_provider", "failed"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (recordedEvent?.paypal_order_id) {
        return NextResponse.json({ mode: "existing", orderId: recordedEvent.paypal_order_id, approvalUrl: recordedEvent.approval_url, status: recordedEvent.status, payoutStatus: recordedEvent.payout_status });
      }
      return paypalError(409, "The PayPal order was created but could not be recorded. Reconcile this order before retrying.");
    }
    await emitPactAgentEvent(supabase, {
      pactId: body.pactId,
      aggregateType: "payment",
      aggregateId: body.milestoneId,
      eventType: "payment.order_created",
      payload: { milestoneId: body.milestoneId, orderId: order.id, amountCents: milestone.amount_cents },
      idempotencyKey: `payment.order_created:${order.id}`,
    });
    return NextResponse.json({ mode: "paypal-sandbox", orderId: order.id, status: order.status, links: order.links, approvalUrl });
  } catch { return paypalError(502, "PayPal is temporarily unavailable."); }
}
