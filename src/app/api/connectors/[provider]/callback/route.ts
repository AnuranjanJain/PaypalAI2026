import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret, encryptSecret, hashOpaqueValue } from "@/lib/connectors/security";
import { exchangeFigmaCode, getFigmaAccount } from "@/lib/connectors/figma";
import { exchangeGitHubCode, exchangeGitHubInstallation, getGitHubAccount, getGitHubInstallationAccount } from "@/lib/connectors/github";
import { isConnectorProvider } from "@/lib/connectors/types";

function callbackError(request: Request, returnPath: string | null, message: string) {
  const safePath = returnPath && /^\/workspace\/[0-9a-f-]{36}\/pact\/[0-9a-f-]{36}$/i.test(returnPath) ? returnPath : "/workspace";
  const url = new URL(safePath, new URL(request.url).origin);
  url.searchParams.set("connector_error", message);
  return NextResponse.redirect(url);
}

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  if (!isConnectorProvider(provider)) return NextResponse.json({ error: "Unknown connector provider." }, { status: 404 });
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const installationId = url.searchParams.get("installation_id");
  if (!state || (!code && !installationId)) return NextResponse.json({ error: "Connector authorization was canceled or incomplete." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in before completing connector authorization." }, { status: 401 });
  const { data: stateRows, error: stateError } = await supabase.rpc("consume_connector_oauth_state", { target_state_hash: hashOpaqueValue(state) });
  const oauthState = Array.isArray(stateRows) ? stateRows[0] : stateRows;
  if (stateError || !oauthState || oauthState.provider !== provider || oauthState.user_id !== user.id) return NextResponse.json({ error: "Connector authorization state is invalid or expired." }, { status: 400 });

  try {
    const verifier = decryptSecret(oauthState.code_verifier_ciphertext);
    let externalAccountId: string;
    let externalAccountName: string | null;
    let accessToken: string;
    let refreshToken: string | null;
    let expiresAt: string | null;
    let scopes: string[];
    if (provider === "github") {
      if (installationId && process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY && process.env.GITHUB_APP_SLUG) {
        const token = await exchangeGitHubInstallation(installationId);
        const account = await getGitHubInstallationAccount(installationId);
        externalAccountId = installationId; externalAccountName = account.login; accessToken = token.accessToken; refreshToken = null; expiresAt = token.expiresAt; scopes = ["metadata:read", "contents:read", "pull_requests:read", "actions:read", "administration:write"];
      } else {
        if (!code) return callbackError(request, oauthState.return_path, "authorization_failed");
        const token = await exchangeGitHubCode(code, verifier);
        const account = await getGitHubAccount(token.accessToken);
        externalAccountId = account.id; externalAccountName = account.login; accessToken = token.accessToken; refreshToken = token.refreshToken; expiresAt = token.expiresAt; scopes = token.scopes;
      }
    } else {
      if (!code) return callbackError(request, oauthState.return_path, "authorization_failed");
      const token = await exchangeFigmaCode(code, verifier);
      const account = await getFigmaAccount(token.accessToken, token.externalAccountId);
      externalAccountId = token.externalAccountId; externalAccountName = account.name; accessToken = token.accessToken; refreshToken = token.refreshToken; expiresAt = token.expiresAt; scopes = token.scopes;
    }
    const { data: connectionId, error: connectionError } = await supabase.rpc("create_connector_connection", {
      target_provider: provider,
      target_pact: oauthState.pact_id,
      target_external_account_id: externalAccountId,
      target_external_account_name: externalAccountName,
      target_scopes: scopes,
      target_access_token_ciphertext: encryptSecret(accessToken),
      target_refresh_token_ciphertext: refreshToken ? encryptSecret(refreshToken) : null,
      target_access_token_expires_at: expiresAt,
    });
    if (connectionError || !connectionId) return callbackError(request, oauthState.return_path, "connection_save_failed");
    const target = new URL(oauthState.return_path, new URL(request.url).origin);
    target.searchParams.set("connector", provider);
    target.searchParams.set("connection", String(connectionId));
    return NextResponse.redirect(target);
  } catch {
    return callbackError(request, oauthState.return_path, "authorization_failed");
  }
}
