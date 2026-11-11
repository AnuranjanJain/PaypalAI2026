"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getSafeNextPath } from "@/lib/navigation";
import "./signin.css";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [register, setRegister] = useState(() => searchParams.get("mode") === "signup");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function nextPath() {
    return getSafeNextPath(new URLSearchParams(window.location.search).get("next"));
  }

  function rememberNextPath() {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `pact_auth_next=${encodeURIComponent(nextPath())}; Path=/; Max-Age=3600; SameSite=Lax${secure}`;
  }

  function clearNextPath() {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `pact_auth_next=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  }

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const client = createClient();
      if (register) rememberNextPath();
      const result = register
        ? await client.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } })
        : await client.auth.signInWithPassword({ email, password });
      if (result.error) { clearNextPath(); setMessage(result.error.message); setBusy(false); }
      else if (result.data.session) { const destination = nextPath(); clearNextPath(); router.push(destination); router.refresh(); }
      else { setMessage("Check your email to confirm your account."); setBusy(false); }
    } catch { setMessage("Sign-in is unavailable. Check the Supabase configuration."); setBusy(false); }
  }

  async function googleSignIn() {
    setBusy(true); setMessage("");
    try {
      rememberNextPath();
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { error } = await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
      if (error) { clearNextPath(); setMessage(error.message); setBusy(false); }
    } catch { clearNextPath(); setMessage("Google sign-in is unavailable. Check the Supabase configuration."); setBusy(false); }
  }

  return <main className="signin"><section className="signin-content"><Link className="signin-brand" href="/workspace">Pact <span>by PayPal</span></Link><h1>{register ? "Create your account" : "Welcome back"}</h1><p>Manage your projects and milestone payments in one place.</p><button type="button" className="signin-google" onClick={googleSignIn} disabled={busy}>Continue with Google</button><div className="signin-divider">or continue with email</div><form onSubmit={signIn}><label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label><label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={register ? "new-password" : "current-password"} minLength={8} required /></label>{message && <p role="status" className="signin-message">{message}</p>}<button className="signin-submit" disabled={busy}>{busy ? <><span className="signin-spinner signin-spinner-small" aria-hidden="true" /> Signing in...</> : register ? "Create account" : "Sign in"}</button></form>{busy && <p role="status" className="signin-progress"><span className="signin-spinner signin-spinner-small" aria-hidden="true" /> Connecting securely...</p>}<button type="button" className="signin-switch" onClick={() => { setRegister(!register); setMessage(""); }} disabled={busy}>{register ? "Already have an account? Sign in" : "New to Pact? Create an account"}</button></section></main>;
}

export default function LoginPage() {
  return <Suspense fallback={<main className="signin"><section className="signin-content signin-loading" role="status" aria-live="polite"><span className="signin-spinner" aria-hidden="true" /><h1>Loading sign-in</h1><p>Please wait a moment.</p></section></main>}><LoginForm /></Suspense>;
}
