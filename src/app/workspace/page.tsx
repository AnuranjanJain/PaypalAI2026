import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WorkspaceShell from "./WorkspaceShell";
import "../login/signin.css";

export const instant = false;

async function createWorkspace(formData: FormData) {
  "use server";
  const name = formData.get("name");
  if (typeof name !== "string" || !name.trim() || name.length > 120) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: workspaceId, error } = await supabase.rpc("create_workspace", { workspace_name: name.trim() });
  if (error || typeof workspaceId !== "string" || !/^[0-9a-f-]{36}$/i.test(workspaceId)) redirect("/workspace?error=create");
  redirect(`/workspace/${workspaceId}`);
}

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ error?: string; manage?: string }> }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
    return <main className="signin"><section className="signin-content"><h1>Workspace setup needed</h1><p>Configure Supabase to enable accounts and persistent workspaces.</p></section></main>;
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error: actionError, manage } = await searchParams;
  const { data: memberships, error } = await supabase.from("workspace_members").select("workspace_id, role, workspaces(name)");
  const managing = manage === "1";
  if (!error && !actionError && !managing && memberships?.length === 1) redirect(`/workspace/${memberships[0].workspace_id}`);
  return <WorkspaceShell active="workspaces" email={user.email}><div className="workspace-overview-header"><div><p className="workspace-eyebrow">ACCOUNT / WORKSPACES</p><h1>{managing ? "Choose a workspace" : "Your workspaces"}</h1><p>Signed in as {user.email}</p></div><Link className="workspace-action secondary" href="/">Back to landing</Link></div>{error ? <div className="workspace-alert" role="alert">Workspaces could not be loaded. Check that the database migration has been applied.</div> : <div className="workspace-panel"><div className="workspace-panel-heading"><div><h2>Workspace access</h2><p>Choose where you want to work, or create a new workspace.</p></div></div>{memberships?.length ? <div>{memberships.map((membership) => <Link className="workspace-list-card" key={membership.workspace_id} href={`/workspace/${membership.workspace_id}`}><span className="workspace-avatar" aria-hidden="true">{membership.workspaces && "name" in membership.workspaces ? String(membership.workspaces.name).charAt(0).toUpperCase() : "W"}</span><span><strong>{membership.workspaces && "name" in membership.workspaces ? String(membership.workspaces.name) : "Workspace"}</strong><small>{membership.role}</small></span><span className="workspace-pill">Open</span></Link>)}</div> : <div className="workspace-empty"><strong>You don’t have a workspace yet.</strong>Create one to get started.</div>}</div>}{actionError === "create" && <div className="workspace-alert" role="alert">Could not create the workspace. Please try again.</div>}<div className="workspace-panel"><div className="workspace-panel-heading"><div><h2>Create a workspace</h2><p>Keep your projects, providers, and payment decisions together.</p></div></div><form className="workspace-form" action={createWorkspace}><label>Workspace name<input name="name" maxLength={120} required placeholder="e.g. North Studio" /></label><button className="workspace-action" type="submit">Create workspace <span aria-hidden="true">→</span></button></form></div></WorkspaceShell>;
}
