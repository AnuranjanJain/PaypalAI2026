import { NextRequest, NextResponse } from "next/server";
import { getSafeNextPath } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextCookie = request.cookies.get("pact_auth_next")?.value;
  let requestedNext: string | null = null;
  try { requestedNext = nextCookie ? decodeURIComponent(nextCookie) : null; } catch { requestedNext = null; }
  const nextPath = getSafeNextPath(requestedNext);
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = NextResponse.redirect(new URL(nextPath, url.origin));
      response.cookies.set("pact_auth_next", "", { path: "/", maxAge: 0, sameSite: "lax", httpOnly: true, secure: url.protocol === "https:" });
      return response;
    }
  }
  const response = NextResponse.redirect(new URL("/login?error=callback", url.origin));
  response.cookies.set("pact_auth_next", "", { path: "/", maxAge: 0, sameSite: "lax", httpOnly: true, secure: url.protocol === "https:" });
  return response;
}
