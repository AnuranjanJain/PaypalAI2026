import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCodeVerifier, encryptSecret, hashOpaqueValue, randomOpaqueValue } from "@/lib/connectors/security";
import { figmaAuthorizationUrl } from "@/lib/connectors/figma";
import { githubAuthorizationUrl } from "@/lib/connectors/github";
import { isConnectorProvider, isUuid } from "@/lib/connectors/types";

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  if (!isConnectorProvider(provider)) return NextResponse.json({ error: "Unknown connector provider." }, { status: 404 });
  const pactId = new URL(request.url).searchParams.get("pactId");
  if (!isUuid(pactId)) return NextResponse.json({ error: "A valid Pact is required." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to connect a provider." }, { status: 401 });
  const { data: pact } = await supabase.from("pacts").select("workspace_id").eq("id", pactId).maybeSingle();
  if (!pact) return NextResponse.json({ error: "Pact not found." }, { status: 404 });
  const { data: membership } = await supabase.from("workspace_members").select("role").eq("workspace_id", pact.workspace_id).eq("user_id", user.id).maybeSingle();
  if (membership?.role !== "owner" && membership?.role !== "provider") return NextResponse.json({ error: "Pact participant access is required." }, { status: 403 });

  const requestedReturnPath = new URL(request.url).searchParams.get("returnPath");
  const returnPath = requestedReturnPath && new RegExp(`^/workspace/[0-9a-f-]{36}/pact/${pactId}$`, "i").test(requestedReturnPath)
    ? requestedReturnPath
    : `/workspace/${pact.workspace_id}/pact/${pactId}`;
  try {
    const state = randomOpaqueValue(32);
    const verifier = createCodeVerifier();
    const { error } = await supabase.rpc("create_connector_oauth_state", {
      target_provider: provider,
      target_pact: pactId,
      target_state_hash: hashOpaqueValue(state),
      target_code_verifier_ciphertext: encryptSecret(verifier),
      target_return_path: returnPath,
      target_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (error) return NextResponse.json({ error: "Connector authorization is not enabled. Apply the latest Supabase migration." }, { status: 503 });
    const authorizationUrl = provider === "github" ? githubAuthorizationUrl(state, verifier) : figmaAuthorizationUrl(state, verifier);
    return NextResponse.redirect(authorizationUrl);
  } catch {
    return NextResponse.json({ error: "Connector authorization is not configured." }, { status: 503 });
  }
}
