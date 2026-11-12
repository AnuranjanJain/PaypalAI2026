import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshFigmaAccessToken } from "./figma.ts";
import { exchangeGitHubInstallation, refreshGitHubAccessToken } from "./github.ts";
import { decryptSecret, encryptSecret } from "./security.ts";
import type { ConnectorConnection } from "./types.ts";

const refreshLocks = new Map<string, Promise<string>>();

/** Keep refresh-token rotation from racing inside a warm server instance. */
export async function getConnectorAccessToken(admin: SupabaseClient, connection: ConnectorConnection): Promise<string> {
  const existing = refreshLocks.get(connection.id);
  if (existing) return existing;
  const task = getConnectorAccessTokenInternal(admin, connection).finally(() => refreshLocks.delete(connection.id));
  refreshLocks.set(connection.id, task);
  return task;
}

async function getConnectorAccessTokenInternal(admin: SupabaseClient, connection: ConnectorConnection): Promise<string> {
  if (!connection.access_token_ciphertext) throw new Error("Connector token is unavailable; reconnect the provider.");
  const expiresAt = connection.access_token_expires_at ? Date.parse(connection.access_token_expires_at) : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now() + 60_000) return decryptSecret(connection.access_token_ciphertext);
  if (connection.provider === "github" && process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY && process.env.GITHUB_APP_SLUG && /^\d{1,30}$/.test(connection.external_account_id)) {
    try {
      const refreshed = await exchangeGitHubInstallation(connection.external_account_id);
      const { error } = await admin.from("connector_connections").update({ access_token_ciphertext: encryptSecret(refreshed.accessToken), access_token_expires_at: refreshed.expiresAt, status: "active", last_error: null, updated_at: new Date().toISOString() }).eq("id", connection.id);
      if (error) throw new Error("Refreshed connector token could not be saved.");
      return refreshed.accessToken;
    } catch {
      await admin.from("connector_connections").update({ status: "degraded", last_error: "GitHub App installation token refresh failed.", updated_at: new Date().toISOString() }).eq("id", connection.id);
      throw new Error("GitHub App token refresh failed; reconnect the provider.");
    }
  }
  if (!connection.refresh_token_ciphertext) throw new Error("Connector token expired; reconnect the provider.");
  try {
    const refreshToken = decryptSecret(connection.refresh_token_ciphertext);
    const refreshed = connection.provider === "github" ? await refreshGitHubAccessToken(refreshToken) : await refreshFigmaAccessToken(refreshToken);
    const update: Record<string, string | null> = { access_token_ciphertext: encryptSecret(refreshed.accessToken), access_token_expires_at: refreshed.expiresAt, status: "active", last_error: null };
    if (connection.provider === "github" && "refreshToken" in refreshed) update.refresh_token_ciphertext = encryptSecret(refreshed.refreshToken ?? refreshToken);
    const { error } = await admin.from("connector_connections").update(update).eq("id", connection.id);
    if (error) throw new Error("Refreshed connector token could not be saved.");
    return refreshed.accessToken;
  } catch {
    await admin.from("connector_connections").update({ status: "degraded", last_error: "OAuth token refresh failed.", updated_at: new Date().toISOString() }).eq("id", connection.id);
    throw new Error("Connector token refresh failed; reconnect the provider.");
  }
}
