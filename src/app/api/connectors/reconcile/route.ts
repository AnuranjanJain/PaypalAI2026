import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { getConnectorAccessToken } from "@/lib/connectors/access-token";
import { reconcileFigmaResource } from "@/lib/connectors/figma";
import { reconcileGitHubResource } from "@/lib/connectors/github";
import { recordConnectorEvent } from "@/lib/connectors/events";
import type { ConnectorConnection } from "@/lib/connectors/types";

function authorized(request: Request): boolean {
  const expected = process.env.AGENT_WORKER_SECRET ?? process.env.CRON_SECRET;
  const supplied = request.headers.get("x-agent-worker-secret") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

async function reconcile(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Connector reconciliation authorization failed." }, { status: 401 });
  const admin = tryCreateAdminClient();
  if (!admin) return NextResponse.json({ error: "Connector storage is not configured." }, { status: 503 });
  const { data, error } = await admin.from("connector_connections").select("*").in("status", ["active", "degraded"]).not("resource_id", "is", null).order("updated_at", { ascending: true }).limit(25);
  if (error) return NextResponse.json({ error: "Connector queue is unavailable." }, { status: 503 });

  let checked = 0;
  let events = 0;
  let degraded = 0;
  let disconnected = 0;
  for (const connection of (data ?? []) as ConnectorConnection[]) {
    checked += 1;
    try {
      const token = await getConnectorAccessToken(admin, connection);
      const snapshots = connection.provider === "github"
        ? await reconcileGitHubResource(token, connection.resource_id as string)
        : await reconcileFigmaResource(token, connection.resource_id as string);
      for (const snapshot of snapshots) {
        const result = await recordConnectorEvent(admin, connection, snapshot, { source: "scheduled_reconciliation", snapshot });
        if (!result.duplicate) events += 1;
      }
      await admin.from("connector_connections").update({ status: "active", last_error: null, updated_at: new Date().toISOString() }).eq("id", connection.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connector reconciliation failed.";
      const missingResource = message.includes("(404)") || /not found|invalid file key|repository is invalid/i.test(message);
      await admin.from("connector_connections").update({ status: missingResource ? "disconnected" : "degraded", last_error: missingResource ? "The selected resource is no longer available." : "Provider reconciliation failed; reconnect or retry.", updated_at: new Date().toISOString() }).eq("id", connection.id);
      if (missingResource) disconnected += 1;
      else degraded += 1;
    }
  }
  return NextResponse.json({ checked, events, degraded, disconnected });
}

export async function GET(request: Request) {
  return reconcile(request);
}

export async function POST(request: Request) {
  return reconcile(request);
}
