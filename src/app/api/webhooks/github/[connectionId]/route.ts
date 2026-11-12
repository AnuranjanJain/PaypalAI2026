import { NextResponse } from "next/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { recordConnectorEvent } from "@/lib/connectors/events";
import { normalizeGitHubWebhook, verifyGitHubSignature } from "@/lib/connectors/github";
import { decryptSecret } from "@/lib/connectors/security";
import { isUuid, type ConnectorConnection } from "@/lib/connectors/types";

export async function POST(request: Request, context: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await context.params;
  if (!isUuid(connectionId)) return NextResponse.json({ error: "Invalid webhook target." }, { status: 400 });
  const rawBody = await request.text();
  if (rawBody.length > 1_000_000) return NextResponse.json({ error: "Webhook payload is too large." }, { status: 413 });
  const admin = tryCreateAdminClient();
  if (!admin) return NextResponse.json({ error: "Connector storage is not configured." }, { status: 503 });
  const { data: connection } = await admin.from("connector_connections").select("*").eq("id", connectionId).eq("provider", "github").maybeSingle() as { data: ConnectorConnection | null };
  if (!connection || connection.status === "disconnected") return NextResponse.json({ error: "Webhook target not found." }, { status: 404 });
  if (!connection.webhook_secret_ciphertext) return NextResponse.json({ error: "Webhook secret is unavailable." }, { status: 503 });
  let secret: string;
  try { secret = decryptSecret(connection.webhook_secret_ciphertext); } catch { return NextResponse.json({ error: "Webhook secret is unavailable." }, { status: 503 }); }
  if (!verifyGitHubSignature(rawBody, request.headers.get("x-hub-signature-256"), secret)) return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  const deliveryId = request.headers.get("x-github-delivery");
  const eventType = request.headers.get("x-github-event");
  if (!deliveryId || !eventType) return NextResponse.json({ error: "Webhook headers are incomplete." }, { status: 400 });
  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "Webhook payload is invalid JSON." }, { status: 400 }); }
  const events = normalizeGitHubWebhook(payload, eventType, deliveryId);
  if (!events.length) return NextResponse.json({ accepted: true, ignored: true });
  try {
    const results = await Promise.all(events.map((event) => recordConnectorEvent(admin, connection, event, payload)));
    return NextResponse.json({ accepted: true, events: results.length, duplicates: results.filter((result) => result.duplicate).length });
  } catch {
    return NextResponse.json({ error: "Webhook was authenticated but could not be recorded." }, { status: 503 });
  }
}
