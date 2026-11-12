import { createSign } from "node:crypto";
import { appUrl, createCodeChallenge, parseScopes, verifyHmacSha256 } from "./security.ts";
import { asNumberString, asRecord, asString, type NormalizedConnectorEvent } from "./types.ts";

const API_URL = "https://api.github.com";
const DEFAULT_SCOPES = ["read:user", "user:email", "repo", "admin:repo_hook"];

type GitHubToken = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  scope?: string;
};

export type GitHubResource = {
  id: string;
  name: string;
  url: string;
  scopeOptions?: {
    branch: Array<{ value: string; label: string }>;
    pullRequest: Array<{ value: string; label: string }>;
    workflow: Array<{ value: string; label: string }>;
  };
};

type GitHubAccount = { id: string; login: string; name: string | null; email: string | null };

function clientId(): string {
  const value = process.env.GITHUB_CLIENT_ID;
  if (!value) throw new Error("GitHub OAuth is not configured.");
  return value;
}

function clientSecret(): string {
  const value = process.env.GITHUB_CLIENT_SECRET;
  if (!value) throw new Error("GitHub OAuth is not configured.");
  return value;
}

function appSlug(): string | null {
  return process.env.GITHUB_APP_SLUG?.trim() || null;
}

function appId(): string | null {
  return process.env.GITHUB_APP_ID?.trim() || null;
}

function appPrivateKey(): string | null {
  const value = process.env.GITHUB_APP_PRIVATE_KEY;
  return value ? value.replaceAll("\\n", "\n") : null;
}

function scopes(): string[] {
  return parseScopes(process.env.GITHUB_OAUTH_SCOPES, DEFAULT_SCOPES);
}

function headers(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}).`);
  return payload as T;
}

export function githubCallbackUrl(): string {
  return `${appUrl()}/api/connectors/github/callback`;
}

export function githubAuthorizationUrl(state: string, verifier: string): string {
  const slug = appSlug();
  if (slug && appId() && appPrivateKey()) {
    const url = new URL(`https://github.com/apps/${encodeURIComponent(slug)}/installations/new`);
    url.searchParams.set("state", state);
    return url.toString();
  }
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId());
  url.searchParams.set("redirect_uri", githubCallbackUrl());
  url.searchParams.set("scope", scopes().join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", createCodeChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

function appJwt(): string {
  const id = appId();
  const key = appPrivateKey();
  if (!id || !key) throw new Error("GitHub App credentials are not configured.");
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", typ: "JWT" });
  const payload = encode({ iat: Math.floor(Date.now() / 1000) - 60, exp: Math.floor(Date.now() / 1000) + 540, iss: id });
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(key, "base64url")}`;
}

export async function exchangeGitHubInstallation(installationId: string): Promise<{ accessToken: string; expiresAt: string | null }> {
  if (!/^\d{1,30}$/.test(installationId)) throw new Error("GitHub installation ID is invalid.");
  const response = await fetch(`${API_URL}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: { ...headers(appJwt()), "Content-Type": "application/json" },
    cache: "no-store",
  });
  const payload = await jsonResponse<{ token?: string; expires_at?: string }>(response);
  if (!payload.token) throw new Error("GitHub App did not return an installation token.");
  return { accessToken: payload.token, expiresAt: payload.expires_at ?? null };
}

export async function getGitHubInstallationAccount(installationId: string): Promise<{ id: string; login: string }> {
  const response = await fetch(`${API_URL}/app/installations/${installationId}`, { headers: headers(appJwt()), cache: "no-store" });
  const payload = await jsonResponse<Record<string, unknown>>(response);
  const account = asRecord(payload.account);
  const id = asNumberString(account?.id);
  const login = asString(account?.login) ?? asString(account?.slug);
  if (!id || !login) throw new Error("GitHub installation account response was invalid.");
  return { id, login };
}

export async function exchangeGitHubCode(code: string, verifier: string): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: string | null; scopes: string[] }> {
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    code,
    redirect_uri: githubCallbackUrl(),
    code_verifier: verifier,
  });
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const payload = await jsonResponse<GitHubToken & { error?: string }>(response);
  if (!payload.access_token) throw new Error("GitHub OAuth did not return an access token.");
  const expiresAt = typeof payload.expires_in === "number" ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : null;
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token ?? null, expiresAt, scopes: parseScopes(payload.scope, scopes()) };
}

export async function refreshGitHubAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: string | null }> {
  const body = new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), grant_type: "refresh_token", refresh_token: refreshToken });
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const payload = await jsonResponse<GitHubToken>(response);
  if (!payload.access_token) throw new Error("GitHub access could not be refreshed.");
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token ?? refreshToken, expiresAt: typeof payload.expires_in === "number" ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : null };
}

export async function getGitHubAccount(token: string): Promise<GitHubAccount> {
  const account = await jsonResponse<Record<string, unknown>>(await fetch(`${API_URL}/user`, { headers: headers(token), cache: "no-store" }));
  const id = asNumberString(account.id);
  const login = asString(account.login);
  if (!id || !login) throw new Error("GitHub account response was invalid.");
  let email = asString(account.email);
  if (!email) {
    const emails = await jsonResponse<Array<Record<string, unknown>>>(await fetch(`${API_URL}/user/emails`, { headers: headers(token), cache: "no-store" }));
    const primary = emails.find((item) => item.primary === true) ?? emails[0];
    email = primary ? asString(primary.email) : null;
  }
  return { id, login, name: asString(account.name), email };
}

export async function listGitHubResources(token: string): Promise<GitHubResource[]> {
  const response = await fetch(`${API_URL}/user/repos?per_page=50&sort=updated&affiliation=owner,collaborator,organization_member`, { headers: headers(token), cache: "no-store" });
  const repositories = await jsonResponse<Array<Record<string, unknown>>>(response);
  return repositories.flatMap((repository) => {
    const fullName = asString(repository.full_name);
    if (!fullName) return [];
    return [{ id: fullName, name: fullName, url: asString(repository.html_url) ?? `https://github.com/${fullName}` }];
  });
}

/** Load bounded branch, pull request, and workflow choices after a repository is selected. */
export async function describeGitHubResource(token: string, resourceId: string): Promise<GitHubResource> {
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(resourceId)) throw new Error("GitHub repository is invalid.");
  const repo = await jsonResponse<Record<string, unknown>>(await fetch(`${API_URL}/repos/${resourceId}`, { headers: headers(token), cache: "no-store" }));
  const fullName = asString(repo.full_name) ?? resourceId;
  const url = asString(repo.html_url) ?? `https://github.com/${fullName}`;
  const bounded = async <T>(path: string, fallback: T): Promise<T> => {
    try { return await jsonResponse<T>(await fetch(`${API_URL}${path}`, { headers: headers(token), cache: "no-store" })); } catch { return fallback; }
  };
  const [branches, pullRequests, workflows] = await Promise.all([
    bounded<Array<Record<string, unknown>>>(`/repos/${resourceId}/branches?per_page=50`, []),
    bounded<Array<Record<string, unknown>>>(`/repos/${resourceId}/pulls?state=all&per_page=50&sort=updated`, []),
    bounded<Record<string, unknown>>(`/repos/${resourceId}/actions/workflows?per_page=50`, {}),
  ]);
  const workflowRows = Array.isArray(workflows.workflows) ? workflows.workflows.flatMap((value) => asRecord(value) ? [value as Record<string, unknown>] : []) : [];
  return {
    id: fullName,
    name: asString(repo.name) ?? fullName,
    url,
    scopeOptions: {
      branch: branches.flatMap((branch) => { const name = asString(branch.name); return name ? [{ value: name, label: name }] : []; }),
      pullRequest: pullRequests.flatMap((pullRequest) => { const number = asNumberString(pullRequest.number); const title = asString(pullRequest.title); return number ? [{ value: number, label: `#${number}${title ? ` ${title.slice(0, 90)}` : ""}` }] : []; }),
      workflow: workflowRows.flatMap((workflow) => { const name = asString(workflow.name); return name ? [{ value: name, label: name }] : []; }),
    },
  };
}

/** Reconcile a small recent window so a missed webhook does not hide new work. */
export async function reconcileGitHubResource(token: string, resourceId: string): Promise<NormalizedConnectorEvent[]> {
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(resourceId)) throw new Error("GitHub repository is invalid.");
  const response = await fetch(`${API_URL}/repos/${resourceId}/commits?per_page=10`, { headers: headers(token), cache: "no-store" });
  const commits = await jsonResponse<Array<Record<string, unknown>>>(response);
  return commits.flatMap((commitValue) => {
    const commit = asRecord(commitValue) ?? {};
    const sha = asString(commit.sha);
    const commitDetails = asRecord(commit.commit);
    const author = asRecord(commit.author);
    const message = asString(commitDetails?.message) ?? "A recent commit was found during reconciliation.";
    if (!sha) return [];
    const sourceUrl = asString(commit.html_url) ?? `https://github.com/${resourceId}/commit/${sha}`;
    const occurredAt = asString(commitDetails?.author && asRecord(commitDetails.author)?.date);
    return [{
      eventKey: `reconcile:commit:${sha}`,
      externalId: sha,
      eventType: "reconciliation_commit",
      occurredAt,
      actor: asString(author?.login) ?? asString(asRecord(commitDetails?.author)?.name),
      resourceId,
      sourceUrl,
      summary: `GitHub reconciliation found commit ${sha.slice(0, 8)}: ${message.split("\n")[0].slice(0, 240)}`,
      snapshot: { eventType: "reconciliation_commit", repository: resourceId, sha, message, branch: null, sourceUrl },
    } satisfies NormalizedConnectorEvent];
  });
}

export async function attachGitHubResource(token: string, resourceId: string, connectionId: string): Promise<{ resourceId: string; resourceName: string; resourceUrl: string; webhookId: string; webhookSecret: string }> {
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(resourceId)) throw new Error("GitHub resource must be an owner/repository name.");
  const repo = await jsonResponse<Record<string, unknown>>(await fetch(`${API_URL}/repos/${resourceId}`, { headers: headers(token), cache: "no-store" }));
  const permissions = asRecord(repo.permissions);
  if (permissions?.admin !== true) throw new Error("GitHub repository administrator access is required to create the webhook.");
  const fullName = asString(repo.full_name) ?? resourceId;
  const htmlUrl = asString(repo.html_url) ?? `https://github.com/${fullName}`;
  const webhookSecret = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const hookResponse = await jsonResponse<Record<string, unknown>>(await fetch(`${API_URL}/repos/${fullName}/hooks`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "web",
      active: true,
      events: ["push", "pull_request", "workflow_run"],
      config: { url: `${appUrl()}/api/webhooks/github/${connectionId}`, content_type: "json", secret: webhookSecret, insecure_ssl: "0" },
    }),
    cache: "no-store",
  }));
  const webhookId = asNumberString(hookResponse.id);
  if (!webhookId) throw new Error("GitHub webhook response was invalid.");
  return { resourceId: fullName, resourceName: asString(repo.name) ?? fullName, resourceUrl: htmlUrl, webhookId, webhookSecret };
}

export async function deleteGitHubWebhook(token: string, resourceId: string, webhookId: string): Promise<void> {
  if (!resourceId || !webhookId) return;
  const match = resourceId.match(/^([^/]+)\/([^/]+)$/);
  if (!match || !/^\d{1,30}$/.test(webhookId)) throw new Error("GitHub webhook target is invalid.");
  const response = await fetch(`${API_URL}/repos/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}/hooks/${encodeURIComponent(webhookId)}`, { method: "DELETE", headers: headers(token), cache: "no-store" });
  if (!response.ok && response.status !== 404) throw new Error(`GitHub webhook deletion failed (${response.status}).`);
}

export function verifyGitHubSignature(rawBody: string, signature: string | null, secret: string): boolean {
  return verifyHmacSha256(rawBody, signature, secret);
}

export function normalizeGitHubWebhook(payload: unknown, eventType: string, deliveryId: string): NormalizedConnectorEvent[] {
  const body = asRecord(payload);
  if (!body || !deliveryId) return [];
  const repository = asRecord(body.repository);
  const sender = asRecord(body.sender);
  const fullName = asString(repository?.full_name);
  const actor = asString(sender?.login);
  const repoUrl = asString(repository?.html_url) ?? (fullName ? `https://github.com/${fullName}` : null);
  const occurredAt = asString(body.pushed_at) ?? asString(body.updated_at) ?? asString(body.created_at);
  if (eventType === "push") {
    const commits = Array.isArray(body.commits) ? body.commits : [];
    const events = commits.map((commitValue) => {
      const commit = asRecord(commitValue) ?? {};
      const sha = asString(commit.id) ?? asString(body.after) ?? deliveryId;
      const sourceUrl = asString(commit.url) ?? (fullName && sha ? `${repoUrl}/commit/${sha}` : repoUrl);
      const message = asString(commit.message) ?? "A commit was pushed.";
      return { eventKey: `${deliveryId}:${sha}`, externalId: sha, eventType, occurredAt, actor, resourceId: fullName, sourceUrl, summary: `GitHub commit ${sha.slice(0, 8)}: ${message.split("\n")[0].slice(0, 240)}`, snapshot: { eventType, repository: fullName, sha, message, ref: asString(body.ref), actor, sourceUrl } };
    });
    return events.length ? events : [{ eventKey: `${deliveryId}:${asString(body.after) ?? "push"}`, externalId: asString(body.after), eventType, occurredAt, actor, resourceId: fullName, sourceUrl: repoUrl, summary: `GitHub push received for ${fullName ?? "the repository"}.`, snapshot: { eventType, repository: fullName, ref: asString(body.ref), after: asString(body.after), actor } }];
  }
  if (eventType === "pull_request") {
    const pullRequest = asRecord(body.pull_request);
    const number = asNumberString(pullRequest?.number) ?? asNumberString(body.number) ?? deliveryId;
    const action = asString(body.action) ?? "updated";
    const sourceUrl = asString(pullRequest?.html_url) ?? repoUrl;
    return [{ eventKey: `${deliveryId}:${number}:${action}`, externalId: asNumberString(pullRequest?.id) ?? number, eventType, occurredAt: asString(pullRequest?.updated_at) ?? occurredAt, actor, resourceId: fullName, sourceUrl, summary: `GitHub pull request #${number} ${action}.`, snapshot: { eventType, action, repository: fullName, number, title: asString(pullRequest?.title), state: asString(pullRequest?.state), merged: pullRequest?.merged === true, sourceUrl, actor } }];
  }
  if (eventType === "workflow_run") {
    const run = asRecord(body.workflow_run);
    const runId = asNumberString(run?.id) ?? deliveryId;
    const action = asString(body.action) ?? "updated";
    const sourceUrl = asString(run?.html_url) ?? repoUrl;
    return [{ eventKey: `${deliveryId}:${runId}:${action}`, externalId: runId, eventType, occurredAt: asString(run?.updated_at) ?? occurredAt, actor, resourceId: fullName, sourceUrl, summary: `GitHub Actions run ${runId} ${asString(run?.conclusion) ?? action}.`, snapshot: { eventType, action, repository: fullName, runId, name: asString(run?.name), status: asString(run?.status), conclusion: asString(run?.conclusion), sourceUrl, actor } }];
  }
  return [];
}
