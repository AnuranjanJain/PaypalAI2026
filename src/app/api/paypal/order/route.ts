import { NextResponse } from "next/server";
import { getRequestId, parseAmount, parseCurrency, paypalError } from "@/lib/paypal";

export async function POST(request: Request) {
  let body: { amount?: unknown; currency?: unknown } | null = null;
  try { body = await request.json(); } catch { return paypalError(400, "Request body must be valid JSON."); }
  const amount = parseAmount(body?.amount);
  const currency = parseCurrency(body?.currency ?? "USD");
  if (!amount) return paypalError(400, "amount must be a positive value with at most two decimals.");
  if (!currency) return paypalError(400, "currency must be a supported three-letter code.");

  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    return NextResponse.json({ mode: "demo-fallback", orderId: `demo_order_${crypto.randomUUID()}`, status: "CREATED", amount, currency });
  }
  const baseUrl = process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com";
  const credentials = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  try {
    const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials", cache: "no-store" });
    if (!tokenResponse.ok) return paypalError(502, "PayPal authorization failed.");
    const token = await tokenResponse.json() as { access_token?: string };
    if (!token.access_token) return paypalError(502, "PayPal authorization returned an invalid response.");
    const orderResponse = await fetch(`${baseUrl}/v2/checkout/orders`, { method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json", "PayPal-Request-Id": getRequestId(request, "pact") }, body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ amount: { currency_code: currency, value: amount }, description: "PayPal Pact milestone payment" }] }), cache: "no-store" });
    if (!orderResponse.ok) return paypalError(502, "PayPal order creation failed.");
    const order = await orderResponse.json() as { id?: string; status?: string; links?: unknown };
    if (!order.id) return paypalError(502, "PayPal returned an invalid order.");
    return NextResponse.json({ mode: "paypal-sandbox", orderId: order.id, status: order.status, links: order.links });
  } catch { return paypalError(502, "PayPal is temporarily unavailable."); }
}