import { NextResponse } from "next/server";
import { getRequestId, paypalError } from "@/lib/paypal";

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await context.params;
  if (!orderId || !/^[A-Za-z0-9_-]{3,100}$/.test(orderId)) return paypalError(400, "A valid orderId is required.");
  if (orderId.startsWith("demo_")) return paypalError(409, "This illustrative order cannot be marked paid without PayPal confirmation.");
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) return paypalError(503, "PayPal credentials are not configured.");
  const baseUrl = (process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com").replace(/\/$/, "");
  const credentials = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  try {
    const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, { method: "POST", headers: { Accept: "application/json", "Accept-Language": "en_US", Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials", cache: "no-store" });
    if (!tokenResponse.ok) return paypalError(502, "PayPal authorization failed.");
    const token = await tokenResponse.json() as { access_token?: string };
    if (!token.access_token) return paypalError(502, "PayPal authorization returned an invalid response.");
    const captureResponse = await fetch(`${baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json", "PayPal-Request-Id": getRequestId(request, "pact-capture") }, cache: "no-store" });
    if (!captureResponse.ok) return paypalError(502, "PayPal capture failed.");
    const capture = await captureResponse.json() as { status?: string };
    return NextResponse.json({ mode: "paypal-sandbox", orderId, status: capture.status });
  } catch { return paypalError(502, "PayPal is temporarily unavailable."); }
}
