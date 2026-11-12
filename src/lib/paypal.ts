import { createHash } from "node:crypto";

const SUPPORTED_CURRENCIES = new Set(["USD", "EUR", "GBP", "INR", "CAD", "AUD"]);

export function parseAmount(value: unknown): string | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return null;
  return amount.toFixed(2);
}

export function parseCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const currency = value.trim().toUpperCase();
  return SUPPORTED_CURRENCIES.has(currency) ? currency : null;
}

/** PayPal return/cancel URLs must be absolute and safe to send to the provider. */
export function parseRedirectUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const localHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (url.protocol !== "https:" && !localHttp) return null;
    const configuredOrigin = process.env.APP_URL;
    if (configuredOrigin) {
      const allowed = new URL(configuredOrigin);
      if (url.origin !== allowed.origin && !localHttp) return null;
    }
    return url.toString();
  } catch { return null; }
}

/** Use a caller idempotency key when supplied so retries cannot create duplicate orders. */
export function getRequestId(request: Request, prefix: string, fallbackValue?: string): string {
  const supplied = request.headers.get("Idempotency-Key")?.trim();
  if (supplied && /^[A-Za-z0-9._:-]{1,72}$/.test(supplied)) return `${prefix}-${supplied}`;
  if (fallbackValue) return getStableRequestId(prefix, fallbackValue);
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Generate a stable PayPal idempotency identifier for retries without a client key. */
export function getStableRequestId(prefix: string, value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 28);
  return `${prefix}-${digest}`;
}

export function paypalError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}
