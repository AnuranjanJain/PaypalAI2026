import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type PayPalWebhookEvent = {
  id?: string;
  event_type?: string;
  resource?: {
    id?: string;
    status?: string;
    supplementary_data?: { related_ids?: { order_id?: string } };
    payout_item?: { payout_item_id?: string; transaction_status?: string; payout_batch_id?: string };
    payout_batch_id?: string;
  };
  transmission_id?: string;
};

function headerValue(request: Request, name: string) {
  return request.headers.get(name) ?? "";
}

async function getAccessToken(baseUrl: string, clientId: string, clientSecret: string) {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Language": "en_US",
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!response.ok) return null;
  const payload = await response.json() as { access_token?: string };
  return payload.access_token ?? null;
}

async function verifyWebhook(
  baseUrl: string,
  accessToken: string,
  body: string,
  request: Request,
) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  const response = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_algo: headerValue(request, "paypal-auth-algo"),
      cert_url: headerValue(request, "paypal-cert-url"),
      transmission_id: headerValue(request, "paypal-transmission-id"),
      transmission_sig: headerValue(request, "paypal-transmission-sig"),
      transmission_time: headerValue(request, "paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: JSON.parse(body) as PayPalWebhookEvent,
    }),
    cache: "no-store",
  });
  if (!response.ok) return false;
  const result = await response.json() as { verification_status?: string };
  return result.verification_status === "SUCCESS";
}

function orderIdFor(event: PayPalWebhookEvent) {
  return event.resource?.supplementary_data?.related_ids?.order_id ?? null;
}

function payoutBatchIdFor(event: PayPalWebhookEvent) {
  return event.resource?.payout_batch_id ?? event.resource?.payout_item?.payout_batch_id ?? null;
}

export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > 1_000_000) return NextResponse.json({ error: "Webhook payload is too large." }, { status: 413 });

  let event: PayPalWebhookEvent;
  try {
    event = JSON.parse(body) as PayPalWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Webhook payload must be valid JSON." }, { status: 400 });
  }
  if (!event.id || !event.event_type) return NextResponse.json({ error: "Webhook event ID and type are required." }, { status: 400 });

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret || !process.env.PAYPAL_WEBHOOK_ID) {
    return NextResponse.json({ error: "PayPal webhook verification is not configured." }, { status: 503 });
  }

  const baseUrl = (process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com").replace(/\/$/, "");
  const accessToken = await getAccessToken(baseUrl, clientId, clientSecret);
  if (!accessToken || !(await verifyWebhook(baseUrl, accessToken, body, request))) {
    return NextResponse.json({ error: "Invalid PayPal webhook signature." }, { status: 400 });
  }

  const rawOrderId = orderIdFor(event);
  const rawPayoutBatchId = payoutBatchIdFor(event);
  const orderId = rawOrderId && /^[A-Za-z0-9_-]{3,100}$/.test(rawOrderId) ? rawOrderId : null;
  const payoutBatchId = rawPayoutBatchId && /^[A-Za-z0-9_-]{3,160}$/.test(rawPayoutBatchId) ? rawPayoutBatchId : null;
  const eventType = event.event_type;
  const supabase = createAdminClient();
  const ledgerQuery = orderId
    ? supabase.from("pact_payment_events").select("id, pact_id, pacts!inner(workspace_id)").eq("paypal_order_id", orderId).maybeSingle()
    : payoutBatchId
      ? supabase.from("pact_payment_events").select("id, pact_id, pacts!inner(workspace_id)").eq("payout_batch_id", payoutBatchId).maybeSingle()
      : null;
  if (!ledgerQuery) return NextResponse.json({ received: true, eventId: event.id, matched: false });
  const { data: ledgerEvent } = await ledgerQuery;
  if (!ledgerEvent) return NextResponse.json({ received: true, eventId: event.id, matched: false });

  const correlationId = headerValue(request, "paypal-transmission-id") || event.transmission_id || event.id;
  const { data: pactEventId, error: eventError } = await supabase.rpc("record_pact_event", {
    target_pact: ledgerEvent.pact_id,
    target_event_type: `paypal.${eventType.toLowerCase()}`,
    target_aggregate_type: "payment",
    target_aggregate_id: ledgerEvent.id,
    target_payload: { paypalEventId: event.id, eventType, resourceId: event.resource?.id ?? null },
    target_actor_type: "system",
    target_correlation_id: correlationId,
    target_idempotency_key: `paypal:${event.id}`,
  });
  if (eventError && !eventError.message.toLowerCase().includes("duplicate") && eventError.code !== "23505") {
    return NextResponse.json({ error: "Webhook could not be recorded." }, { status: 503 });
  }

  let ledgerError: { message?: string } | null = null;
  if (orderId && eventType === "PAYMENT.CAPTURE.COMPLETED") {
    // Webhooks can be delayed or replayed after a payout has advanced the
    // ledger. Only move an order from its initial state; never regress a
    // captured or paid-to-provider milestone.
    const result = await supabase.from("pact_payment_events").update({ status: "captured", updated_at: new Date().toISOString() }).eq("paypal_order_id", orderId).eq("status", "created");
    ledgerError = result.error;
  } else if (orderId && ["PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.DECLINED"].includes(eventType)) {
    const result = await supabase.from("pact_payment_events").update({ status: "failed", payout_error: "PayPal reported a failed capture.", updated_at: new Date().toISOString() }).eq("paypal_order_id", orderId).eq("status", "created");
    ledgerError = result.error;
  } else if (payoutBatchId && ["PAYMENT.PAYOUTSBATCH.PROCESSING", "PAYMENT.PAYOUTSBATCH.SUCCESS", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED"].includes(eventType)) {
    const successful = eventType.endsWith("SUCCESS") || eventType.endsWith("SUCCEEDED");
    const result = await supabase.from("pact_payment_events").update({ status: successful ? "paid_to_provider" : "payout_pending", payout_status: successful ? "paid_to_provider" : "payout_pending", payout_batch_id: payoutBatchId, payout_updated_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("payout_batch_id", payoutBatchId).in("status", ["captured", "payout_pending"]);
    ledgerError = result.error;
  } else if (payoutBatchId && ["PAYMENT.PAYOUTSBATCH.DENIED", "PAYMENT.PAYOUTS-ITEM.FAILED", "PAYMENT.PAYOUTS-ITEM.BLOCKED"].includes(eventType)) {
    const result = await supabase.from("pact_payment_events").update({ status: "failed", payout_status: "failed", payout_error: "PayPal reported a failed payout.", payout_batch_id: payoutBatchId, payout_updated_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("payout_batch_id", payoutBatchId).in("status", ["captured", "payout_pending"]);
    ledgerError = result.error;
  }
  if (ledgerError) return NextResponse.json({ error: "PayPal status was verified but the Pact ledger could not be updated." }, { status: 503 });
  if (typeof pactEventId === "string") {
    const agents = eventType.includes("PAYOUT") ? ["progress", "dispute_shield"] : ["progress", "dispute_shield"];
    for (const agent of agents) await supabase.rpc("enqueue_agent_run", { target_event_id: pactEventId, target_agent: agent, target_input_snapshot: { eventType, orderId, payoutBatchId }, target_max_attempts: 3 });
  }

  return NextResponse.json({ received: true, eventId: event.id });
}
