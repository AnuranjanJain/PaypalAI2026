import fs from "node:fs";
import path from "node:path";

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(fs.readFileSync(filePath, "utf8").split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) return [];
    return [[match[1], match[2].replace(/^['"]|['"]$/g, "")]];
  }));
}

const root = process.cwd();
const env = { ...readEnvFile(path.join(root, ".env")), ...readEnvFile(path.join(root, ".env.local")), ...process.env };
const baseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const key = String(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "");
const secretGroups = [
  ["SUPABASE_SERVICE_ROLE_KEY"],
  ["CONNECTOR_TOKEN_ENCRYPTION_KEY"],
  ["AI_API_KEY", "MODEL_API_KEY"],
  ["AGENT_WORKER_SECRET", "CRON_SECRET"],
  ["PAYPAL_CLIENT_ID"],
  ["PAYPAL_CLIENT_SECRET"],
];
const has = (name) => Boolean(String(env[name] ?? "").trim());
const connectorChecks = [
  { label: "GitHub OAuth or App", ready: (has("GITHUB_CLIENT_ID") && has("GITHUB_CLIENT_SECRET")) || (has("GITHUB_APP_ID") && has("GITHUB_APP_SLUG") && has("GITHUB_APP_PRIVATE_KEY")) },
  { label: "Figma OAuth", ready: has("FIGMA_CLIENT_ID") && has("FIGMA_CLIENT_SECRET") },
  { label: "PAYPAL_WEBHOOK_ID", ready: has("PAYPAL_WEBHOOK_ID") },
];
const missingConfig = secretGroups.filter((group) => !group.some(has)).map((group) => group.join(" or "));
console.log("PayPal Pact server configuration:");
for (const group of secretGroups) {
  console.log(`${group.join(" or ")}: ${group.some(has) ? "set" : "missing"}`);
}
for (const check of connectorChecks) console.log(`${check.label}: ${check.ready ? "set" : "missing"}`);
const missingConnectorConfig = connectorChecks.filter((check) => !check.ready).map((check) => check.label);
if (!baseUrl || !key) {
  console.error("Supabase configuration is missing NEXT_PUBLIC_SUPABASE_URL or a publishable key.");
  process.exitCode = 1;
} else {
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const tables = [
    "connector_connections_public",
    "connector_events",
    "connector_evidence",
    "pact_milestone_source_mappings",
    "pact_events",
    "agent_runs",
    "agent_actions",
    "progress_snapshots",
    "scope_change_orders",
    "disputes",
    "negotiation_sessions",
    "negotiation_offers",
  ];
  const checks = await Promise.all(tables.map(async (table) => {
    try {
      const response = await fetch(`${baseUrl}/rest/v1/${table}?select=*&limit=1`, { headers, signal: AbortSignal.timeout(10000) });
      return { table, status: response.ok ? "ready" : response.status === 404 ? "missing" : `error ${response.status}`, available: response.ok };
    } catch (error) {
      return { table, status: `error (${error instanceof Error ? error.message : "request failed"})`, available: false };
    }
  }));
  for (const check of checks) console.log(`${check.status.padEnd(8)} ${check.table}`);
  const missing = checks.filter((check) => !check.available).length;
  if (missing > 0 || missingConfig.length > 0 || missingConnectorConfig.length > 0) {
    if (missing > 0) console.error(`\n${missing} Supabase objects are unavailable. Apply migrations 202611120025 through 202611120030 after the earlier Pact migrations, then run this check again.`);
    if (missingConfig.length > 0) console.error(`Missing server configuration: ${missingConfig.join(", ")}`);
    if (missingConnectorConfig.length > 0) console.error(`Missing connector configuration: ${missingConnectorConfig.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("\nSupabase connector and agent storage is available.");
  }
}

if (env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET) {
  const paypalBaseUrl = String(env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com").replace(/\/$/, "");
  try {
    const credentials = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64");
    const response = await fetch(`${paypalBaseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(10000),
    });
    console.log(`PayPal Sandbox OAuth: ${response.ok ? "available" : `failed (HTTP ${response.status})`}`);
  } catch {
    console.log("PayPal Sandbox OAuth: request failed");
  }
} else {
  console.log("PayPal Sandbox OAuth: skipped (credentials missing)");
}
