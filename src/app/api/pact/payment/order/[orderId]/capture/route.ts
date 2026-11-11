import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequestId, paypalError } from "@/lib/paypal";

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await context.params;
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(orderId)) return paypalError(400, "A valid orderId is required.");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return paypalError(401, "Sign in to capture a payment.");
  const { data: event } = await supabase.from("pact_payment_events").select("id, pact_id, milestone_id, status, owner_id, payout_status").eq("paypal_order_id", orderId).maybeSingle();
  if (!event || event.owner_id !== user.id) return paypalError(404, "Payment order not found.");
  if (event.status === "captured" || event.status === "payout_pending" || event.status === "paid_to_provider") return NextResponse.json({ mode: "paypal-sandbox", orderId, status: "COMPLETED", payoutStatus: event.payout_status ?? "not_requested" });
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) return paypalError(503, "PayPal Sandbox credentials are not configured.");
  const baseUrl = (process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com").replace(/\/$/, "");
  const credentials = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  try {
    const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, { method: "POST", headers: { Accept: "application/json", "Accept-Language": "en_US", Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials", cache: "no-store" });
    if (!tokenResponse.ok) return paypalError(502, "PayPal authorization failed.");
    const token = await tokenResponse.json() as { access_token?: string };
    if (!token.access_token) return paypalError(502, "PayPal authorization returned an invalid response.");
    const captureResponse = await fetch(`${baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json", "PayPal-Request-Id": getRequestId(request, "pact-auth-capture") }, cache: "no-store" });
    let capture = captureResponse.ok ? await captureResponse.json() as { status?: string } : { status: undefined };
    if (!captureResponse.ok) {
      const reconciliation = await fetch(`${baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}`, { headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" }, cache: "no-store" });
      if (reconciliation.ok) capture = await reconciliation.json() as { status?: string };
    }
    if (["VOIDED", "CANCELED", "DENIED", "FAILED"].includes(capture.status ?? "")) {
      const { error: failureError } = await supabase.rpc("mark_pact_payment_failed", { target_order_id: orderId });
      if (failureError) return paypalError(502, "PayPal canceled the order, but the Pact ledger could not release it for retry.");
      return NextResponse.json({ mode: "paypal-sandbox", orderId, status: "FAILED", error: "PayPal canceled this order. Start a new checkout for the milestone." }, { status: 409 });
    }
    if (capture.status !== "COMPLETED") return NextResponse.json({ mode: "paypal-sandbox", orderId, status: capture.status ?? "PENDING" }, { status: captureResponse.ok ? 409 : 502 });
    const { error: ledgerError } = await supabase.rpc("mark_pact_payment_captured", { target_order_id: orderId });
    if (ledgerError) return paypalError(502, "PayPal reports a completed capture, but the Pact ledger could not be updated. Retry reconciliation before treating it as recorded.");
    return NextResponse.json({ mode: "paypal-sandbox", orderId, status: "COMPLETED", payoutStatus: "not_requested", payoutMessage: "Capture is recorded. Request provider payout separately when PayPal Payouts is available." });
  } catch { return paypalError(502, "PayPal is temporarily unavailable."); }
}
