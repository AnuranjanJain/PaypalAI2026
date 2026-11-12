import { appUrl, createCodeChallenge, parseScopes, safeCompare } from "./security.ts";
import { asNumberString, asRecord, asString, type NormalizedConnectorEvent } from "./types.ts";

const API_URL = "https://api.figma.com";
const DEFAULT_SCOPES = ["current_user:read", "file_content:read", "file_comments:read", "file_dev_resources:read", "projects:read", "webhooks:read", "webhooks:write"];

type FigmaToken = { access_token?: string; refresh_token?: string; expires_in?: number; user_id_string?: string; scope?: string };

export type FigmaResource = {
  id: string;
  name: string;
  url: string;
  detail?: string;
  kind: "file";
  metadata: {
    versionId?: string;
    lastModified?: string;
    branchKey?: string;
    branchName?: string;
    pages: Array<{ id: string; name: string }>;
    frames: Array<{ id: string; name: string; type: string; pageId: string }>;
    nodes: Array<{ id: string; name: string; type: string; parentId: string }>;
  };
  scopeOptions?: Partial<Record<"versionId" | "pageId" | "frameId" | "nodeId", Array<{ value: string; label: string }>>>;
};

function clientId(): string {
  const value = process.env.FIGMA_CLIENT_ID;
  if (!value) throw new Error("Figma OAuth is not configured.");
  return value;
}

function clientSecret(): string {
  const value = process.env.FIGMA_CLIENT_SECRET;
  if (!value) throw new Error("Figma OAuth is not configured.");
  return value;
}

function scopes(): string[] {
  return parseScopes(process.env.FIGMA_OAUTH_SCOPES, DEFAULT_SCOPES);
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Figma request failed (${response.status}).`);
  return payload as T;
}

function fileKey(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,120}$/.test(value) ? value : null;
}

function nodeSummary(value: unknown, parentId: string): { id: string; name: string; type: string; parentId: string } | null {
  const node = asRecord(value);
  const id = asString(node?.id);
  const name = asString(node?.name);
  const type = asString(node?.type);
  return id && name && type ? { id, name, type, parentId } : null;
}

function fileResource(fileKeyValue: string, file: Record<string, unknown>, fallback?: Record<string, unknown>): FigmaResource {
  const document = asRecord(file.document);
  const pages = Array.isArray(document?.children) ? document.children.flatMap((value) => {
    const page = asRecord(value);
    const id = asString(page?.id);
    const name = asString(page?.name);
    return id && name ? [{ id, name }] : [];
  }).slice(0, 40) : [];
  const frames = Array.isArray(document?.children) ? document.children.flatMap((value) => {
    const page = asRecord(value);
    const pageId = asString(page?.id);
    const children = Array.isArray(page?.children) ? page.children : [];
    return pageId ? children.flatMap((child) => {
      const node = nodeSummary(child, pageId);
      return node ? [{ id: node.id, name: node.name, type: node.type, pageId }] : [];
    }) : [];
  }).slice(0, 80) : [];
  const nodes = Array.isArray(document?.children) ? document.children.flatMap((value) => {
    const page = asRecord(value);
    const children = Array.isArray(page?.children) ? page.children : [];
    return children.flatMap((child) => {
      const frame = asRecord(child);
      const frameId = asString(frame?.id);
      const nested = Array.isArray(frame?.children) ? frame.children : [];
      return frameId ? nested.flatMap((nodeValue) => {
        const node = nodeSummary(nodeValue, frameId);
        return node ? [node] : [];
      }) : [];
    });
  }).slice(0, 120) : [];
  const metadata = {
    versionId: asString(file.version) ?? asString(fallback?.version) ?? undefined,
    lastModified: asString(file.lastModified) ?? asString(file.last_modified) ?? asString(fallback?.last_modified) ?? undefined,
    branchKey: asString(fallback?.key) ?? undefined,
    branchName: asString(fallback?.name) ?? undefined,
    pages,
    frames,
    nodes,
  };
  const name = asString(file.name) ?? asString(fallback?.name) ?? fileKeyValue;
  const details = [metadata.versionId ? `version ${metadata.versionId}` : "", metadata.lastModified ? `updated ${metadata.lastModified}` : "", pages.length ? `${pages.length} pages` : ""].filter(Boolean).join(" · ");
  return {
    id: fileKeyValue,
    name,
    url: `https://www.figma.com/file/${fileKeyValue}`,
    detail: details || undefined,
    kind: "file",
    metadata,
    scopeOptions: {
      versionId: metadata.versionId ? [{ value: metadata.versionId, label: metadata.versionId }] : [],
      pageId: pages.map((page) => ({ value: page.id, label: page.name })),
      frameId: frames.map((frame) => ({ value: frame.id, label: `${frame.name} · ${frame.type}` })),
      nodeId: nodes.map((node) => ({ value: node.id, label: `${node.name} · ${node.type}` })),
    },
  };
}

export async function getFigmaFile(token: string, resourceId: string, depth = 2): Promise<Record<string, unknown>> {
  if (!fileKey(resourceId)) throw new Error("Figma resource must be a valid file key.");
  return jsonResponse<Record<string, unknown>>(await fetch(`${API_URL}/v1/files/${encodeURIComponent(resourceId)}?depth=${depth}`, { headers: authHeaders(token), cache: "no-store" }));
}

export async function describeFigmaResource(token: string, resourceId: string): Promise<FigmaResource> {
  return fileResource(resourceId, await getFigmaFile(token, resourceId, 2));
}

async function listProjectFiles(token: string, projectId: string): Promise<Array<Record<string, unknown>>> {
  const response = await jsonResponse<Record<string, unknown>>(await fetch(`${API_URL}/v1/projects/${encodeURIComponent(projectId)}/files?branch_data=true`, { headers: authHeaders(token), cache: "no-store" }));
  return Array.isArray(response.files) ? response.files.flatMap((file) => asRecord(file) ? [file as Record<string, unknown>] : []) : [];
}

export async function listFigmaResources(token: string, options: { teamId?: string; projectId?: string } = {}): Promise<{ resources: FigmaResource[]; warning?: string }> {
  const projectId = options.projectId && /^\d{1,40}$/.test(options.projectId) ? options.projectId : null;
  const teamId = options.teamId && /^\d{1,40}$/.test(options.teamId) ? options.teamId : null;
  if (!projectId && !teamId) return { resources: [] };
  let files: Array<Record<string, unknown>> = [];
  try {
    if (projectId) {
      files = await listProjectFiles(token, projectId);
    } else {
      const projectsResponse = await jsonResponse<Record<string, unknown>>(await fetch(`${API_URL}/v1/teams/${encodeURIComponent(teamId!)}/projects`, { headers: authHeaders(token), cache: "no-store" }));
      const projects = Array.isArray(projectsResponse.projects) ? projectsResponse.projects.flatMap((value) => asRecord(value) ? [value as Record<string, unknown>] : []).slice(0, 25) : [];
      const projectFiles = await Promise.all(projects.flatMap((project) => {
        const id = asString(project.id);
        return id ? [listProjectFiles(token, id).catch(() => [])] : [];
      }));
      files = projectFiles.flat();
    }
  } catch {
    return { resources: [], warning: "Figma file discovery requires a private OAuth app with projects:read access and a readable team or project." };
  }
  const candidates = files.slice(0, 40).map((file) => ({ key: fileKey(file.key), file }));
  const resources = (await Promise.all(candidates.flatMap(({ key, file }) => key ? [getFigmaFile(token, key, 2).then((fullFile) => fileResource(key, fullFile, file)).catch(() => fileResource(key, {}, file))] : []))).filter(Boolean);
  return { resources };
}

export function figmaCallbackUrl(): string {
  return `${appUrl()}/api/connectors/figma/callback`;
}

export function figmaAuthorizationUrl(state: string, verifier: string): string {
  const url = new URL("https://www.figma.com/oauth");
  url.searchParams.set("client_id", clientId());
  url.searchParams.set("redirect_uri", figmaCallbackUrl());
  url.searchParams.set("scope", scopes().join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("code_challenge", createCodeChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeFigmaCode(code: string, verifier: string): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: string | null; externalAccountId: string; scopes: string[] }> {
  const credentials = Buffer.from(`${clientId()}:${clientSecret()}`).toString("base64");
  const body = new URLSearchParams({ grant_type: "authorization_code", redirect_uri: figmaCallbackUrl(), code, code_verifier: verifier });
  const response = await fetch(`${API_URL}/v1/oauth/token`, { method: "POST", headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" }, body, cache: "no-store" });
  const payload = await jsonResponse<FigmaToken>(response);
  if (!payload.access_token || !payload.user_id_string) throw new Error("Figma OAuth did not return a usable token.");
  const expiresAt = typeof payload.expires_in === "number" ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : null;
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token ?? null, expiresAt, externalAccountId: payload.user_id_string, scopes: parseScopes(payload.scope, scopes()) };
}

export async function refreshFigmaAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: string | null }> {
  const credentials = Buffer.from(`${clientId()}:${clientSecret()}`).toString("base64");
  const body = new URLSearchParams({ refresh_token: refreshToken });
  const response = await fetch(`${API_URL}/v1/oauth/refresh`, { method: "POST", headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" }, body, cache: "no-store" });
  const payload = await jsonResponse<FigmaToken>(response);
  if (!payload.access_token) throw new Error("Figma access could not be refreshed.");
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token ?? refreshToken, expiresAt: typeof payload.expires_in === "number" ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : null };
}

export async function getFigmaAccount(token: string, fallbackId: string): Promise<{ id: string; name: string | null }> {
  const response = await fetch(`${API_URL}/v1/me`, { headers: authHeaders(token), cache: "no-store" });
  if (!response.ok) return { id: fallbackId, name: null };
  const account = await response.json() as Record<string, unknown>;
  return { id: asString(account.id) ?? fallbackId, name: asString(account.handle) ?? asString(account.email) ?? null };
}

export async function attachFigmaResource(token: string, resourceId: string, connectionId: string): Promise<{ resourceId: string; resourceName: string; resourceUrl: string; webhookId: string; webhookSecret: string }> {
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(resourceId)) throw new Error("Figma resource must be a valid file key.");
  const file = await getFigmaFile(token, resourceId, 1);
  const webhookSecret = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const hook = await jsonResponse<Record<string, unknown>>(await fetch(`${API_URL}/v2/webhooks`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ event_type: "FILE_UPDATE", context: "file", context_id: resourceId, endpoint: `${appUrl()}/api/webhooks/figma/${connectionId}`, passcode: webhookSecret, description: "PayPal Pact evidence updates" }),
    cache: "no-store",
  }));
  const webhookId = asNumberString(hook.id ?? hook.webhook_id);
  if (!webhookId) throw new Error("Figma webhook response was invalid.");
  const resourceName = asString(file.name) ?? resourceId;
  return { resourceId, resourceName, resourceUrl: `https://www.figma.com/file/${resourceId}`, webhookId, webhookSecret };
}

/** Reconcile the file's current version after a missed Figma webhook. */
export async function reconcileFigmaResource(token: string, resourceId: string): Promise<NormalizedConnectorEvent[]> {
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(resourceId)) throw new Error("Figma resource must be a valid file key.");
  const file = await jsonResponse<Record<string, unknown>>(await fetch(`${API_URL}/v1/files/${encodeURIComponent(resourceId)}?depth=1`, { headers: authHeaders(token), cache: "no-store" }));
  const versionId = asString(file.version) ?? asString(file.lastModified);
  if (!versionId) return [];
  const fileName = asString(file.name) ?? resourceId;
  const sourceUrl = `https://www.figma.com/file/${resourceId}`;
  return [{
    eventKey: `reconcile:file:${resourceId}:${versionId}`,
    externalId: versionId,
    eventType: "reconciliation_file_update",
    occurredAt: asString(file.lastModified),
    actor: null,
    resourceId,
    sourceUrl,
    summary: `Figma reconciliation found the latest version of ${fileName}.`,
    snapshot: { eventType: "reconciliation_file_update", fileKey: resourceId, fileName, versionId, pageId: null, frameId: null, nodeId: null, sourceUrl },
  } satisfies NormalizedConnectorEvent];
}

export async function deleteFigmaWebhook(token: string, webhookId: string): Promise<void> {
  if (!webhookId) return;
  const response = await fetch(`${API_URL}/v2/webhooks/${encodeURIComponent(webhookId)}`, { method: "DELETE", headers: authHeaders(token), cache: "no-store" });
  if (!response.ok && response.status !== 404) throw new Error(`Figma webhook deletion failed (${response.status}).`);
}

export function verifyFigmaPasscode(payload: unknown, expectedPasscode: string): boolean {
  const body = asRecord(payload);
  const actual = asString(body?.passcode);
  return Boolean(actual && expectedPasscode && safeCompare(actual, expectedPasscode));
}

export function normalizeFigmaWebhook(payload: unknown): NormalizedConnectorEvent[] {
  const body = asRecord(payload);
  if (!body) return [];
  const eventType = asString(body.event_type);
  const webhookId = asNumberString(body.webhook_id);
  const fileKey = asString(body.file_key);
  const timestamp = asString(body.timestamp) ?? asString(body.created_at);
  if (!eventType || !webhookId) return [];
  const versionId = asString(body.version_id);
  const comment = asRecord(body.comment);
  const commentId = asString(comment?.id);
  const externalId = `${webhookId}:${fileKey ?? "context"}:${versionId ?? commentId ?? timestamp ?? eventType}`;
  const sourceUrl = fileKey ? `https://www.figma.com/file/${fileKey}` : null;
  let summary = `Figma ${eventType.toLowerCase().replaceAll("_", " ")} event received.`;
  if (eventType === "FILE_VERSION_UPDATE") summary = `Figma file ${fileKey ?? ""} received version ${versionId ?? "update"}.`.trim();
  if (eventType === "FILE_COMMENT") summary = `A Figma comment was added to ${asString(body.file_name) ?? fileKey ?? "the file"}.`;
  if (eventType === "DEV_MODE_STATUS_UPDATE") summary = `Figma Dev Mode status changed to ${asString(body.status) ?? "updated"}.`;
  return [{ eventKey: externalId, externalId, eventType, occurredAt: timestamp, actor: asString(asRecord(body.triggered_by)?.handle) ?? asString(asRecord(body.triggered_by)?.id), resourceId: fileKey, sourceUrl, summary, snapshot: { eventType, fileKey, fileName: asString(body.file_name), versionId, commentId, status: asString(body.status), nodeId: asString(body.node_id), label: asString(body.label), description: asString(body.description), sourceUrl } }];
}
