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

/** Use a caller idempotency key when supplied so retries cannot create duplicate orders. */
export function getRequestId(request: Request, prefix: string): string {
  const supplied = request.headers.get("Idempotency-Key")?.trim();
  if (supplied && /^[A-Za-z0-9._:-]{1,72}$/.test(supplied)) return `${prefix}-${supplied}`;
  return `${prefix}-${crypto.randomUUID()}`;
}

export function paypalError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}