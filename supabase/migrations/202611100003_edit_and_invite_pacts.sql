alter table public.pacts
  add constraint pacts_workspace_id_id_key unique (workspace_id, id);

create table public.pact_participants (
  pact_id uuid not null references public.pacts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (pact_id, user_id)
);

create table public.pact_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  pact_id uuid not null,
  invited_email text not null check (invited_email = lower(trim(invited_email))),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  foreign key (workspace_id, pact_id) references public.pacts(workspace_id, id) on delete cascade
);

create unique index pact_invitations_one_pending_per_pact
  on public.pact_invitations(pact_id) where status = 'pending';

alter table public.pact_participants enable row level security;
alter table public.pact_invitations enable row level security;

create or replace function public.can_access_pact(target_pact uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.pacts p
    where p.id = target_pact
      and (
        public.is_workspace_member(p.workspace_id, 'owner')
        or exists (
          select 1 from public.pact_participants pp
          where pp.pact_id = p.id and pp.user_id = auth.uid()
        )
      )
  );
$$;
revoke all on function public.can_access_pact(uuid) from public;
grant execute on function public.can_access_pact(uuid) to authenticated;

drop policy if exists "Members can view pacts" on public.pacts;
create policy "Owners and Pact participants can view pacts"
  on public.pacts for select to authenticated using (public.can_access_pact(id));

drop policy if exists "Members can view milestones" on public.milestones;
create policy "Pact participants can view milestones"
  on public.milestones for select to authenticated using (public.can_access_pact(pact_id));

create function public.update_pact_draft(
  target_workspace uuid,
  target_pact uuid,
  pact_title text,
  pact_brief text,
  total_cents bigint,
  milestone_data jsonb
)
returns void language plpgsql security definer set search_path = public
as $$
declare
  pact_status text;
  milestone_total bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_workspace_member(target_workspace, 'owner') then
    raise exception 'Owner membership required';
  end if;

  select p.status into pact_status from public.pacts p
    where p.id = target_pact and p.workspace_id = target_workspace for update;
  if not found then raise exception 'Pact not found'; end if;
  if pact_status <> 'draft' then raise exception 'Only draft Pacts can be edited'; end if;

  if pact_title is null or length(trim(pact_title)) not between 3 and 120
     or pact_brief is null or length(trim(pact_brief)) not between 10 and 2000
     or total_cents is null or total_cents < 1 or total_cents > 100000000 then
    raise exception 'Invalid Pact details';
  end if;
  if milestone_data is null or jsonb_typeof(milestone_data) is distinct from 'array' then
    raise exception 'Invalid milestone details';
  end if;
  if jsonb_array_length(milestone_data) <> 4 then raise exception 'Exactly four milestones are required'; end if;

  if exists (
    select 1 from jsonb_array_elements(milestone_data) item
    where jsonb_typeof(item) is distinct from 'object'
       or jsonb_typeof(item->'title') is distinct from 'string'
       or length(trim(item->>'title')) not between 3 and 120
       or jsonb_typeof(item->'amount_cents') is distinct from 'number'
       or item->>'amount_cents' is null
       or (item->>'amount_cents') !~ '^[1-9][0-9]{0,8}$'
  ) then
    raise exception 'Invalid milestone details';
  end if;

  select sum((item->>'amount_cents')::bigint) into milestone_total
    from jsonb_array_elements(milestone_data) item;
  if milestone_total <> total_cents then raise exception 'Milestones must equal the Pact budget'; end if;

  update public.pacts set title = trim(pact_title), brief = trim(pact_brief), budget_cents = total_cents
    where id = target_pact;
  delete from public.milestones where pact_id = target_pact;
  insert into public.milestones(pact_id, title, position, amount_cents)
    select target_pact, trim(item->>'title'), item.ordinality::integer, (item.value->>'amount_cents')::bigint
      from jsonb_array_elements(milestone_data) with ordinality as item(value, ordinality);
end;
$$;
revoke all on function public.update_pact_draft(uuid, uuid, text, text, bigint, jsonb) from public;
grant execute on function public.update_pact_draft(uuid, uuid, text, text, bigint, jsonb) to authenticated;

create function public.create_pact_invitation(target_workspace uuid, target_pact uuid, target_email text, target_token_hash text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  target_status text;
  owner_email text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select p.status into target_status
    from public.pacts p where p.id = target_pact and p.workspace_id = target_workspace for update;
  if not found then raise exception 'Pact not found'; end if;
  if not public.is_workspace_member(target_workspace, 'owner') then
    raise exception 'Owner membership required';
  end if;
  if target_status <> 'draft' then raise exception 'Only draft Pacts can be invited'; end if;
  if target_email is null or length(target_email) > 254
     or target_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
     or target_token_hash is null or target_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid invitation';
  end if;
  select lower(u.email) into owner_email from auth.users u where u.id = auth.uid();
  if owner_email = lower(trim(target_email)) then raise exception 'Invite a different email address'; end if;

  update public.pact_invitations set status = 'revoked'
    where pact_id = target_pact and status = 'pending';
  insert into public.pact_invitations(workspace_id, pact_id, invited_email, token_hash, created_by)
    values (target_workspace, target_pact, lower(trim(target_email)), target_token_hash, auth.uid());
end;
$$;
revoke all on function public.create_pact_invitation(uuid, uuid, text, text) from public;
grant execute on function public.create_pact_invitation(uuid, uuid, text, text) to authenticated;

create function public.get_pact_invitation(target_token_hash text)
returns table(workspace_id uuid, pact_id uuid, pact_title text, workspace_name text, invited_email text)
language sql stable security definer set search_path = public
as $$
  select i.workspace_id, i.pact_id, p.title, w.name, i.invited_email
    from public.pact_invitations i
    join public.pacts p on p.id = i.pact_id
    join public.workspaces w on w.id = i.workspace_id
    join auth.users u on u.id = auth.uid()
    where i.token_hash = target_token_hash and i.status = 'pending'
      and i.expires_at > now() and lower(i.invited_email) = lower(u.email);
$$;
revoke all on function public.get_pact_invitation(text) from public;
grant execute on function public.get_pact_invitation(text) to authenticated;

create function public.accept_pact_invitation(target_token_hash text)
returns table(workspace_id uuid, pact_id uuid)
language plpgsql security definer set search_path = public
as $$
declare
  invitation record;
  current_role text;
  current_email text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select i.workspace_id, i.pact_id, i.invited_email into invitation
    from public.pact_invitations i
    where i.token_hash = target_token_hash and i.status = 'pending' and i.expires_at > now()
    for update;
  if not found then raise exception 'Invitation is invalid or expired'; end if;

  select lower(u.email) into current_email from auth.users u where u.id = auth.uid();
  if current_email is null or current_email <> invitation.invited_email then
    raise exception 'Sign in with the invited email address';
  end if;
  select wm.role into current_role from public.workspace_members wm
    where wm.workspace_id = invitation.workspace_id and wm.user_id = auth.uid();
  if current_role = 'owner' then raise exception 'Workspace owners cannot join as providers'; end if;

  insert into public.workspace_members(workspace_id, user_id, role)
    values (invitation.workspace_id, auth.uid(), 'provider')
    on conflict on constraint workspace_members_pkey do nothing;
  insert into public.pact_participants(pact_id, user_id)
    values (invitation.pact_id, auth.uid())
    on conflict on constraint pact_participants_pkey do nothing;
  update public.pact_invitations set status = 'accepted', accepted_at = now()
    where token_hash = target_token_hash;
  update public.pacts set status = 'active'
    where id = invitation.pact_id and status = 'draft';

  return query select invitation.workspace_id, invitation.pact_id;
end;
$$;
revoke all on function public.accept_pact_invitation(text) from public;
grant execute on function public.accept_pact_invitation(text) to authenticated;
