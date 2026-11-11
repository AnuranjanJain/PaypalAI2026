export const PENDING_PAYMENT_KEY = "pact.pending-payment.v1";

export type PendingPayment = { milestoneId: number; orderId: string; approvalUrl: string };

export function parsePendingPayment(raw: string | null): PendingPayment | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<PendingPayment>;
    if (candidate.milestoneId !== 2 || typeof candidate.orderId !== "string" || !/^[A-Za-z0-9]{3,100}$/.test(candidate.orderId) || typeof candidate.approvalUrl !== "string") return null;
    const url = new URL(candidate.approvalUrl);
    if (url.protocol !== "https:" || !["www.sandbox.paypal.com", "sandbox.paypal.com"].includes(url.hostname) || url.username || url.password || url.port) return null;
    return { milestoneId: candidate.milestoneId, orderId: candidate.orderId, approvalUrl: url.toString() };
  } catch { return null; }
}
