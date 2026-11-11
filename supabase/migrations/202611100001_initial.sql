create extension if not exists pgcrypto;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'provider')),
  primary key (workspace_id, user_id)
);
create table public.pacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  brief text not null,
  budget_cents bigint not null check (budget_cents > 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'completed', 'cancelled')),
  created_at timestamptz not null default now()
);
create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(id) on delete cascade,
  title text not null,
  position integer not null check (position > 0),
  amount_cents bigint not null check (amount_cents > 0),
  status text not null default 'pending',
  unique (pact_id, position)
);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.pacts enable row level security;
alter table public.milestones enable row level security;

create function public.is_workspace_member(target uuid, required_role text default null)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.workspace_members where workspace_id = target and user_id = auth.uid() and (required_role is null or role = required_role)); $$;
revoke all on function public.is_workspace_member(uuid, text) from public;
grant execute on function public.is_workspace_member(uuid, text) to authenticated;

create policy "Members can view workspace" on public.workspaces for select to authenticated using (public.is_workspace_member(id));
create policy "Members can view membership" on public.workspace_members for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "Members can view pacts" on public.pacts for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "Owners can create pacts" on public.pacts for insert to authenticated with check (public.is_workspace_member(workspace_id, 'owner'));
create policy "Members can view milestones" on public.milestones for select to authenticated using (exists (select 1 from public.pacts p where p.id = pact_id and public.is_workspace_member(p.workspace_id)));

create function public.create_workspace(workspace_name text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare created_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if workspace_name is null or length(trim(workspace_name)) not between 1 and 120 then raise exception 'Invalid workspace name'; end if;
  insert into public.workspaces(name, created_by) values (trim(workspace_name), auth.uid()) returning id into created_id;
  insert into public.workspace_members(workspace_id, user_id, role) values (created_id, auth.uid(), 'owner');
  return created_id;
end; $$;
revoke all on function public.create_workspace(text) from public;
grant execute on function public.create_workspace(text) to authenticated;
