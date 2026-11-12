import crypto from "node:crypto";

const baseUrl = String(process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com").replace(/\/$/, "");
const clientId = process.env.PAYPAL_CLIENT_ID;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
const amount = process.env.PAYPAL_SMOKE_AMOUNT ?? "1.00";
const appUrl = String(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

if (!clientId || !clientSecret) {
  console.error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required.");
  process.exit(1);
}
if (!/^\d+\.\d{2}$/.test(amount) || Number(amount) <= 0) {
  console.error("PAYPAL_SMOKE_AMOUNT must be a positive amount with two decimals.");
  process.exit(1);
}

const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, {
  method: "POST",
  headers: { Authorization: `Basic ${basicAuth}`, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials",
});
const tokenPayload = await tokenResponse.json().catch(() => ({}));
if (!tokenResponse.ok || typeof tokenPayload.access_token !== "string") {
  console.error(`PayPal Sandbox OAuth failed (HTTP ${tokenResponse.status}).`);
  process.exit(1);
}

const requestId = `pact-smoke-${crypto.randomUUID()}`;
const orderResponse = await fetch(`${baseUrl}/v2/checkout/orders`, {
  method: "POST",
  headers: { Authorization: `Bearer ${tokenPayload.access_token}`, "Content-Type": "application/json", "PayPal-Request-Id": requestId },
  body: JSON.stringify({
    intent: "CAPTURE",
    purchase_units: [{ amount: { currency_code: "USD", value: amount }, description: "PayPal Pact sandbox smoke order" }],
    application_context: { brand_name: "PayPal Pact", user_action: "PAY_NOW", return_url: `${appUrl}/walkthrough`, cancel_url: `${appUrl}/walkthrough` },
  }),
});
const orderPayload = await orderResponse.json().catch(() => ({}));
if (!orderResponse.ok || typeof orderPayload.id !== "string" || orderPayload.status !== "CREATED") {
  console.error(`PayPal order creation failed (HTTP ${orderResponse.status}).`);
  process.exit(1);
}
console.log(`OAuth available; created sandbox order ${orderPayload.id} in CREATED state.`);

const captureResponse = await fetch(`${baseUrl}/v2/checkout/orders/${encodeURIComponent(orderPayload.id)}/capture`, {
  method: "POST",
  headers: { Authorization: `Bearer ${tokenPayload.access_token}`, "Content-Type": "application/json", "PayPal-Request-Id": `pact-capture-smoke-${crypto.randomUUID()}` },
});
if (captureResponse.ok) {
  console.error("Unexpected capture success before buyer approval; inspect the PayPal sandbox state.");
  process.exit(1);
}
console.log(`Buyer-approval gate enforced; pre-approval capture returned HTTP ${captureResponse.status}.`);
