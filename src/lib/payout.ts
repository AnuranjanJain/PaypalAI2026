export type PayoutStatus = "payout_pending" | "paid_to_provider" | "failed";

export function normalizePayoutStatus(value: unknown): PayoutStatus | null {
  if (value === "SUCCESS" || value === "COMPLETED") return "paid_to_provider";
  if (value === "PENDING" || value === "PROCESSING" || value === "NEW") return "payout_pending";
  if (value === "DENIED" || value === "BLOCKED" || value === "FAILED" || value === "CANCELED") return "failed";
  return null;
}
