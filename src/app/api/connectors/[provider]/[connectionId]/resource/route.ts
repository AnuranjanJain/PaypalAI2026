import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { getConnectorAccessToken } from "@/lib/connectors/access-token";
import { attachFigmaResource, describeFigmaResource, listFigmaResources } from "@/lib/connectors/figma";
import { attachGitHubResource, describeGitHubResource, listGitHubResources } from "@/lib/connectors/github";
import { encryptSecret } from "@/lib/connectors/security";
import { isConnectorProvider, isUuid, parseGitHubResourceFilters, type ConnectorConnection } from "@/lib/connectors/types";

function isMissingFiltersRpc(error: unknown): boolean {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";
  return code === "PGRST202" || code === "42883" || (message.includes("attach_connector_resource") && message.includes("does not exist"));
}

export async function GET(request: Request, context: { params: Promise<{ provider: string; connectionId: string }> }) {
  const { provider, connectionId } = await context.params;
  if (!isConnectorProvider(provider) || !isUuid(connectionId)) return NextResponse.json({ error: "Invalid connector connection." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to list provider resources." }, { status: 401 });
  const admin = tryCreateAdminClient();
  if (!admin) return NextResponse.json({ error: "Connector storage is not configured." }, { status: 503 });
  const { data: connection } = await admin.from("connector_connections").select("*").eq("id", connectionId).eq("provider", provider).maybeSingle() as { data: ConnectorConnection | null };
  if (!connection || connection.status === "disconnected") return NextResponse.json({ error: "Connector connection not found." }, { status: 404 });
  const { data: pact } = await admin.from("pacts").select("workspace_id").eq("id", connection.pact_id).maybeSingle();
  if (!pact) return NextResponse.json({ error: "Pact not found." }, { status: 404 });
  const { data: membership } = await supabase.from("workspace_members").select("role").eq("workspace_id", pact.workspace_id).eq("user_id", user.id).maybeSingle();
  if (!membership || (membership.role !== "owner" && connection.connected_by !== user.id)) return NextResponse.json({ error: "Pact participant access is required." }, { status: 403 });
  if (!connection.access_token_ciphertext) return NextResponse.json({ error: "Reconnect the provider before listing resources." }, { status: 409 });
  try {
    const token = await getConnectorAccessToken(admin, connection);
    if (provider === "github") {
      if (connection.resource_id) {
        try {
          return NextResponse.json({ resources: [await describeGitHubResource(token, connection.resource_id)], selectedFilters: connection.resource_filters ?? {} });
        } catch {
          return NextResponse.json({ resources: [{ id: connection.resource_id, name: connection.resource_name ?? connection.resource_id, url: connection.resource_url }], warning: "The attached GitHub repository could not be enriched with current scope choices.", selectedFilters: connection.resource_filters ?? {} });
        }
      }
      return NextResponse.json({ resources: await listGitHubResources(token), selectedFilters: connection.resource_filters ?? {} });
    }
    const url = new URL(request.url);
    const teamId = url.searchParams.get("teamId") || undefined;
    const projectId = url.searchParams.get("projectId") || undefined;
    if (teamId || projectId) {
      const discovery = await listFigmaResources(token, { teamId, projectId });
      return NextResponse.json({ resources: discovery.resources, warning: discovery.warning, metadata: { teamId, projectId }, selectedFilters: connection.resource_filters ?? {} });
    }
    if (connection.resource_id) {
      try {
        return NextResponse.json({ resources: [await describeFigmaResource(token, connection.resource_id)], selectedFilters: connection.resource_filters ?? {} });
      } catch {
        return NextResponse.json({
          resources: [{ id: connection.resource_id, name: connection.resource_name ?? connection.resource_id, url: connection.resource_url }],
          warning: "The attached Figma file could not be enriched with current metadata.",
          selectedFilters: connection.resource_filters ?? {},
        });
      }
    }
    return NextResponse.json({ resources: [], selectedFilters: connection.resource_filters ?? {} });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Provider resources could not be loaded." }, { status: 502 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ provider: string; connectionId: string }> }) {
  const { provider, connectionId } = await context.params;
  if (!isConnectorProvider(provider) || !isUuid(connectionId)) return NextResponse.json({ error: "Invalid connector connection." }, { status: 400 });
  let body: { pactId?: unknown; resourceId?: unknown; filters?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  if (!isUuid(body.pactId) || typeof body.resourceId !== "string" || body.resourceId.trim().length < 1 || body.resourceId.length > 300) return NextResponse.json({ error: "Pact and provider resource are required." }, { status: 400 });
  if (provider === "figma" && body.filters !== undefined) return NextResponse.json({ error: "Resource filters are only supported for GitHub repositories." }, { status: 400 });
  const resourceFilters = provider === "github" ? parseGitHubResourceFilters(body.filters) : {};
  if (!resourceFilters) return NextResponse.json({ error: "GitHub resource filters are invalid." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to attach a resource." }, { status: 401 });
  const admin = tryCreateAdminClient();
  if (!admin) return NextResponse.json({ error: "Connector storage is not configured." }, { status: 503 });
  const { data: connection } = await admin.from("connector_connections").select("*").eq("id", connectionId).eq("provider", provider).maybeSingle() as { data: ConnectorConnection | null };
  if (!connection || connection.status === "disconnected" || connection.pact_id !== body.pactId) return NextResponse.json({ error: "Connector connection not found." }, { status: 404 });
  const { data: pact } = await admin.from("pacts").select("workspace_id").eq("id", connection.pact_id).maybeSingle();
  if (!pact) return NextResponse.json({ error: "Pact not found." }, { status: 404 });
  const { data: membership } = await supabase.from("workspace_members").select("role").eq("workspace_id", pact.workspace_id).eq("user_id", user.id).maybeSingle();
  if (membership?.role !== "owner" && connection.connected_by !== user.id) return NextResponse.json({ error: "Only the connection owner or Pact owner can attach resources." }, { status: 403 });
  if (!connection.access_token_ciphertext) return NextResponse.json({ error: "Reconnect the provider before attaching a resource." }, { status: 409 });

  try {
    const token = await getConnectorAccessToken(admin, connection);
    const resource = provider === "github"
      ? await attachGitHubResource(token, body.resourceId.trim(), connection.id)
      : await attachFigmaResource(token, body.resourceId.trim(), connection.id);
    const attachArgs = {
      target_connection: connection.id,
      target_resource_id: resource.resourceId,
      target_resource_name: resource.resourceName,
      target_resource_url: resource.resourceUrl,
      target_webhook_id: resource.webhookId,
      target_webhook_secret_ciphertext: encryptSecret(resource.webhookSecret),
    };
    const filteredAttach = await supabase.rpc("attach_connector_resource", { ...attachArgs, target_resource_filters: resourceFilters });
    let error = filteredAttach.error;
    let filtersPersisted = !error && provider === "github";
    if (error && isMissingFiltersRpc(error)) {
      const fallbackAttach = await supabase.rpc("attach_connector_resource", attachArgs);
      error = fallbackAttach.error;
      filtersPersisted = false;
    }
    if (error) {
      if (provider === "github") {
        const { deleteGitHubWebhook } = await import("@/lib/connectors/github");
        await deleteGitHubWebhook(token, resource.resourceId, resource.webhookId).catch(() => undefined);
      } else {
        const { deleteFigmaWebhook } = await import("@/lib/connectors/figma");
        await deleteFigmaWebhook(token, resource.webhookId).catch(() => undefined);
      }
      return NextResponse.json({ error: "The resource webhook was created but could not be recorded." }, { status: 502 });
    }
    return NextResponse.json({ provider, connectionId: connection.id, resourceId: resource.resourceId, resourceName: resource.resourceName, resourceUrl: resource.resourceUrl, status: "active", selectedFilters: resourceFilters, filtersPersisted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider resource attachment failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
