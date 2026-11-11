export function getSafeNextPath(value: string | null, fallback = "/workspace"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\r\n]/.test(value)) return fallback;
  return value;
}
