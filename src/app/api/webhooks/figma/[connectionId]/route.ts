import { NextResponse } from "next/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { recordConnectorEvent } from "@/lib/connectors/events";
import { normalizeFigmaWebhook, verifyFigmaPasscode } from "@/lib/connectors/figma";
import { decryptSecret } from "@/lib/connectors/security";
import { isUuid, type ConnectorConnection } from "@/lib/connectors/types";

export async function POST(request: Request, context: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await context.params;
  if (!isUuid(connectionId)) return NextResponse.json({ error: "Invalid webhook target." }, { status: 400 });
  const rawBody = await request.text();
  if (rawBody.length > 1_000_000) return NextResponse.json({ error: "Webhook payload is too large." }, { status: 413 });
  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "Webhook payload is invalid JSON." }, { status: 400 }); }
  const admin = tryCreateAdminClient();
  if (!admin) return NextResponse.json({ error: "Connector storage is not configured." }, { status: 503 });
  const { data: connection } = await admin.from("connector_connections").select("*").eq("id", connectionId).eq("provider", "figma").maybeSingle() as { data: ConnectorConnection | null };
  if (!connection || connection.status === "disconnected") return NextResponse.json({ error: "Webhook target not found." }, { status: 404 });
  if (!connection.webhook_secret_ciphertext) return NextResponse.json({ error: "Webhook passcode is unavailable." }, { status: 503 });
  let passcode: string;
  try { passcode = decryptSecret(connection.webhook_secret_ciphertext); } catch { return NextResponse.json({ error: "Webhook passcode is unavailable." }, { status: 503 }); }
  if (!verifyFigmaPasscode(payload, passcode)) return NextResponse.json({ error: "Invalid webhook passcode." }, { status: 400 });
  const events = normalizeFigmaWebhook(payload);
  if (!events.length) return NextResponse.json({ accepted: true, ignored: true });
  try {
    const results = await Promise.all(events.map((event) => recordConnectorEvent(admin, connection, event, payload)));
    return NextResponse.json({ accepted: true, events: results.length, duplicates: results.filter((result) => result.duplicate).length });
  } catch {
    return NextResponse.json({ error: "Webhook was authenticated but could not be recorded." }, { status: 503 });
  }
}
