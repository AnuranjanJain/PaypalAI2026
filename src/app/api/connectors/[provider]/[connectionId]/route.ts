import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { getConnectorAccessToken } from "@/lib/connectors/access-token";
import { deleteFigmaWebhook } from "@/lib/connectors/figma";
import { deleteGitHubWebhook } from "@/lib/connectors/github";
import { isConnectorProvider, isUuid, type ConnectorConnection } from "@/lib/connectors/types";

export async function DELETE(_request: Request, context: { params: Promise<{ provider: string; connectionId: string }> }) {
  const { provider, connectionId } = await context.params;
  if (!isConnectorProvider(provider) || !isUuid(connectionId)) return NextResponse.json({ error: "Invalid connector connection." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to disconnect a provider." }, { status: 401 });
  const admin = tryCreateAdminClient();
  if (!admin) return NextResponse.json({ error: "Connector storage is not configured." }, { status: 503 });
  const { data: connection } = await admin.from("connector_connections").select("*").eq("id", connectionId).eq("provider", provider).maybeSingle() as { data: ConnectorConnection | null };
  if (!connection) return NextResponse.json({ error: "Connector connection not found." }, { status: 404 });
  const { data: pact } = await admin.from("pacts").select("workspace_id").eq("id", connection.pact_id).maybeSingle();
  if (!pact) return NextResponse.json({ error: "Pact not found." }, { status: 404 });
  const { data: membership } = await supabase.from("workspace_members").select("role").eq("workspace_id", pact.workspace_id).eq("user_id", user.id).maybeSingle();
  if (membership?.role !== "owner" && connection.connected_by !== user.id) return NextResponse.json({ error: "Only the connection owner or Pact owner can disconnect providers." }, { status: 403 });

  let remoteDeleteError = false;
  if (connection.access_token_ciphertext && connection.webhook_id) {
    try {
      const token = await getConnectorAccessToken(admin, connection);
      if (provider === "github" && connection.resource_id) await deleteGitHubWebhook(token, connection.resource_id, connection.webhook_id);
      if (provider === "figma") await deleteFigmaWebhook(token, connection.webhook_id);
    } catch { remoteDeleteError = true; }
  }
  const { error } = await supabase.rpc("disconnect_connector", { target_connection: connection.id });
  if (error) return NextResponse.json({ error: "The connector could not be disconnected from the Pact." }, { status: 502 });
  return NextResponse.json({ connectionId: connection.id, status: "disconnected", remoteWebhookDeleted: !remoteDeleteError, warning: remoteDeleteError ? "The local connection is disabled, but the provider webhook may need manual removal." : undefined });
}
