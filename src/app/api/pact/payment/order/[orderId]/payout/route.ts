import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequestId, paypalError } from "@/lib/paypal";
import { normalizePayoutStatus, type PayoutStatus } from "@/lib/payout";

type PayoutDetails = {
  pact_id: string;
  milestone_id: string;
  status: string;
  payout_status: string;
  amount_cents: number;
  currency: string;
  recipient_email: string;
  payout_batch_id: string | null;
};

async function getAccessToken(baseUrl: string, credentials: string) {
  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: { Accept: "application/json", "Accept-Language": "en_US", Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!response.ok) return null;
  const payload = await response.json() as { access_token?: string };
  return payload.access_token ?? null;
}

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await context.params;
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(orderId)) return paypalError(400, "A valid orderId is required.");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return paypalError(401, "Sign in to request a provider payout.");

  const { data, error } = await supabase.rpc("get_pact_payout_details", { target_order_id: orderId });
  const details = (Array.isArray(data) ? data[0] : data) as PayoutDetails | null;
  if (error || !details) {
    const message = error?.message?.toLowerCase() ?? "";
    if (message.includes("does not exist") || message.includes("schema cache") || error?.code === "PGRST202") {
      return NextResponse.json({ error: "Payouts are not enabled in this Supabase project yet.", payoutStatus: "blocked" }, { status: 503 });
    }
    return paypalError(404, error?.message?.includes("Capture") ? error.message : "Payment order is not ready for provider payout.");
  }
  if (details.payout_status === "paid_to_provider") {
    return NextResponse.json({ orderId, payoutStatus: "paid_to_provider", payoutBatchId: details.payout_batch_id });
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Provider payout is blocked because PayPal Payouts credentials are not configured.", payoutStatus: "blocked" }, { status: 503 });
  }

  const baseUrl = (process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com").replace(/\/$/, "");
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  try {
    const accessToken = await getAccessToken(baseUrl, credentials);
    if (!accessToken) return NextResponse.json({ error: "PayPal Payouts authorization is unavailable for this account.", payoutStatus: "blocked" }, { status: 503 });

    let payoutBatchId = details.payout_batch_id;
    let payoutStatus: PayoutStatus | null = null;
    if (details.payout_status === "payout_pending" && payoutBatchId) {
      const reconciliation = await fetch(`${baseUrl}/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        cache: "no-store",
      });
      if (reconciliation.ok) {
        const payload = await reconciliation.json() as { batch_header?: { batch_status?: string } };
        payoutStatus = normalizePayoutStatus(payload.batch_header?.batch_status);
      } else {
        return NextResponse.json({ orderId, payoutStatus: "payout_pending", payoutBatchId, message: "PayPal has not returned a final payout status yet." }, { status: 202 });
      }
      if (!payoutStatus) {
        return NextResponse.json({ orderId, payoutStatus: "payout_pending", payoutBatchId, message: "PayPal returned an intermediate payout status." }, { status: 202 });
      }
    }

    if (details.status !== "captured") {
      return paypalError(409, "Capture the milestone before requesting a provider payout.");
    }

    if (!payoutStatus) {
      payoutBatchId = `pact-${orderId}-${crypto.randomUUID().slice(0, 8)}`;
      const amount = (Number(details.amount_cents) / 100).toFixed(2);
      const payoutResponse = await fetch(`${baseUrl}/v1/payments/payouts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": getRequestId(request, `pact-payout-${orderId}`),
        },
        body: JSON.stringify({
          sender_batch_header: { sender_batch_id: payoutBatchId, email_subject: "PayPal Pact milestone payout" },
          items: [{ recipient_type: "EMAIL", amount: { value: amount, currency: details.currency }, receiver: details.recipient_email, note: "Milestone approved through PayPal Pact." }],
        }),
        cache: "no-store",
      });
      if (!payoutResponse.ok) {
        return NextResponse.json({ error: "PayPal Payouts is unavailable or not enabled for this account. Capture remains recorded; provider payout is blocked.", payoutStatus: "blocked" }, { status: 503 });
      }
      const payload = await payoutResponse.json() as { batch_header?: { payout_batch_id?: string; batch_status?: string } };
      payoutBatchId = payload.batch_header?.payout_batch_id ?? payoutBatchId;
      payoutStatus = normalizePayoutStatus(payload.batch_header?.batch_status) ?? "payout_pending";
    }

    const { error: updateError } = await supabase.rpc("record_pact_payout_status", {
      target_order_id: orderId,
      target_status: payoutStatus,
      target_recipient: details.recipient_email,
      target_batch_id: payoutBatchId,
      target_error: null,
    });
    if (updateError) return paypalError(502, "PayPal returned a payout result, but the Pact ledger could not be updated.");
    return NextResponse.json({ orderId, payoutStatus, payoutBatchId });
  } catch {
    return NextResponse.json({ error: "PayPal Payouts is temporarily unavailable. Capture remains recorded.", payoutStatus: "blocked" }, { status: 503 });
  }
}
