import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

type WorkspaceShellProps = {
  workspaceId?: string;
  workspaceName?: string;
  role?: string;
  email?: string | null;
  active?: "overview" | "pacts" | "payments" | "settings" | "workspaces";
  children: React.ReactNode;
};

export default function WorkspaceShell({ workspaceId, workspaceName, role, email, active = "overview", children }: WorkspaceShellProps) {
  const base = workspaceId ? `/workspace/${workspaceId}` : "/workspace";
  const link = (view: string) => workspaceId ? `${base}?view=${view}` : "/workspace?manage=1";
  const initials = (email ?? workspaceName ?? "P").slice(0, 2).toUpperCase();
  return <main className="workspace-app-shell">
    <header className="workspace-topbar">
      <Link className="workspace-brand" href={workspaceId ? base : "/workspace"}><span className="workspace-brand-mark"><Image src="/pact-supplied-icon.png" alt="" width={28} height={28} /></span><span>PayPal <strong>Pact</strong></span></Link>
      <div className="workspace-top-actions"><span className="workspace-environment"><i /> Sandbox environment</span><Link className="workspace-profile" href={workspaceId ? `${base}?view=profile` : "/workspace?manage=1"} aria-label="Open profile">{initials}</Link></div>
    </header>
    <div className="workspace-layout">
      <aside className="workspace-sidebar" aria-label="Workspace navigation">
        <div className="workspace-context"><span className="workspace-context-label">WORKSPACE</span><strong>{workspaceName ?? "Choose a workspace"}</strong><small>{role ? `${role} access` : "Account management"}</small></div>
        <nav className="workspace-nav">
          <span className="workspace-nav-label">Workspace</span>
          <Link className={active === "overview" ? "is-active" : ""} href={base}><span aria-hidden="true">⌂</span> Overview</Link>
          <Link className={active === "pacts" ? "is-active" : ""} href={link("pacts")}><span aria-hidden="true">◫</span> My Pacts</Link>
          <Link className={active === "payments" ? "is-active" : ""} href={link("payments")}><span aria-hidden="true">◌</span> Payments</Link>
          <Link className={active === "settings" ? "is-active" : ""} href={link("settings")}><span aria-hidden="true">⚙</span> Settings</Link>
          <span className="workspace-nav-label workspace-nav-label-spaced">Account</span>
          <Link className={active === "workspaces" ? "is-active" : ""} href="/workspace?manage=1"><span aria-hidden="true">▦</span> Switch workspace</Link>
          <Link href={workspaceId ? `${base}?view=profile` : "/workspace?manage=1"}><span aria-hidden="true">◉</span> Profile</Link>
        </nav>
        <div className="workspace-sidebar-footer"><div className="workspace-mini-logo"><Image src="/pact-supplied-icon.png" alt="" width={24} height={24} /><span><strong>PayPal Pact</strong><small>Progressive settlement</small></span></div><form action={signOut}><button className="workspace-signout" type="submit">Sign out</button></form></div>
      </aside>
      <section className="workspace-main"><div className="workspace-mobile-nav"><Link href="/workspace?manage=1">All workspaces</Link>{workspaceId && <Link href={`${base}?view=settings`}>Settings</Link>}</div>{children}</section>
    </div>
    <span className="workspace-account-email" aria-hidden="true">{email ?? ""}</span>
  </main>;
}
