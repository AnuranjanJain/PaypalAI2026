-- Connector credentials and webhook evidence stay separate from Pact decisions.
create table public.connector_connections (
  id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(id) on delete cascade,
  provider text not null check (provider in ('github', 'figma')),
  connected_by uuid not null references auth.users(id) on delete cascade,
  external_account_id text not null check (length(trim(external_account_id)) between 1 and 200),
  external_account_name text,
  resource_id text,
  resource_name text,
  resource_url text,
  scopes text[] not null default '{}',
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  access_token_expires_at timestamptz,
  webhook_id text,
  webhook_secret_ciphertext text,
  status text not null default 'awaiting_resource' check (status in ('awaiting_resource', 'active', 'degraded', 'disconnected')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pact_id, provider, external_account_id),
  unique (pact_id, provider, resource_id),
  unique (id, pact_id)
);

alter table public.milestones
  add constraint milestones_id_pact_key unique (id, pact_id);

create unique index connector_connections_one_pending_per_provider
  on public.connector_connections(pact_id, provider)
  where resource_id is null;

create index connector_connections_webhook_idx
  on public.connector_connections(provider, webhook_id)
  where webhook_id is not null;

create table public.connector_oauth_states (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('github', 'figma')),
  pact_id uuid not null references public.pacts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state_hash text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  code_verifier_ciphertext text not null,
  return_path text not null check (return_path ~ '^/workspace/[0-9a-f-]{36}/pact/[0-9a-f-]{36}'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index connector_oauth_states_expiry_idx
  on public.connector_oauth_states(expires_at)
  where consumed_at is null;

create table public.connector_events (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connector_connections(id) on delete cascade,
  pact_id uuid not null references public.pacts(id) on delete cascade,
  provider text not null check (provider in ('github', 'figma')),
  event_key text not null check (length(trim(event_key)) between 1 and 300),
  external_id text,
  event_type text not null check (length(trim(event_type)) between 1 and 120),
  occurred_at timestamptz,
  actor text,
  resource_id text,
  source_url text,
  normalized jsonb not null,
  raw_payload jsonb,
  processing_status text not null default 'received' check (processing_status in ('received', 'processed', 'failed')),
  processing_error text,
  created_at timestamptz not null default now(),
  unique (connection_id, event_key),
  unique (id, connection_id),
  foreign key (connection_id, pact_id) references public.connector_connections(id, pact_id) on delete cascade
);

create index connector_events_pact_created_idx
  on public.connector_events(pact_id, created_at desc);

create table public.pact_milestone_source_mappings (
  id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(id) on delete cascade,
  milestone_id uuid not null references public.milestones(id) on delete cascade,
  connection_id uuid not null references public.connector_connections(id) on delete cascade,
  filters jsonb not null default '{}',
  enabled boolean not null default true,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (milestone_id, connection_id),
  foreign key (connection_id, pact_id) references public.connector_connections(id, pact_id) on delete cascade,
  foreign key (milestone_id, pact_id) references public.milestones(id, pact_id) on delete cascade
);

create table public.connector_evidence (
  id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(id) on delete cascade,
  milestone_id uuid not null references public.milestones(id) on delete cascade,
  connection_id uuid not null references public.connector_connections(id) on delete cascade,
  event_id uuid not null references public.connector_events(id) on delete cascade,
  evidence_type text not null check (length(trim(evidence_type)) between 1 and 100),
  evidence_text text not null check (length(trim(evidence_text)) between 1 and 10000),
  source_url text,
  snapshot jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (event_id, milestone_id),
  foreign key (connection_id, pact_id) references public.connector_connections(id, pact_id) on delete cascade,
  foreign key (event_id, connection_id) references public.connector_events(id, connection_id) on delete cascade,
  foreign key (milestone_id, pact_id) references public.milestones(id, pact_id) on delete cascade
);

alter table public.connector_connections enable row level security;
alter table public.connector_oauth_states enable row level security;
alter table public.connector_events enable row level security;
alter table public.pact_milestone_source_mappings enable row level security;
alter table public.connector_evidence enable row level security;

create policy "Pact participants can view connector connections"
  on public.connector_connections for select to authenticated
  using (public.can_access_pact(pact_id));

-- Expose connection metadata without exposing encrypted credentials through the REST API.
create view public.connector_connections_public as
  select id, pact_id, provider, connected_by, external_account_id, external_account_name,
         resource_id, resource_name, resource_url, scopes, access_token_expires_at,
         webhook_id, status, last_error, created_at, updated_at
    from public.connector_connections
   where public.can_access_pact(pact_id);
revoke all on table public.connector_connections from anon, authenticated;
grant select on public.connector_connections_public to authenticated;
grant insert, update, delete on public.connector_connections to authenticated;

create policy "Pact owners can create connector connections"
  on public.connector_connections for insert to authenticated
  with check (connected_by = auth.uid() and exists (
    select 1 from public.pacts p where p.id = pact_id and public.is_workspace_member(p.workspace_id, 'owner')
  ));

create policy "Pact owners can update connector connections"
  on public.connector_connections for update to authenticated
  using (exists (
    select 1 from public.pacts p where p.id = pact_id and public.is_workspace_member(p.workspace_id, 'owner')
  ))
  with check (exists (
    select 1 from public.pacts p where p.id = pact_id and public.is_workspace_member(p.workspace_id, 'owner')
  ));

create policy "Pact owners can delete connector connections"
  on public.connector_connections for delete to authenticated
  using (exists (
    select 1 from public.pacts p where p.id = pact_id and public.is_workspace_member(p.workspace_id, 'owner')
  ));

create policy "Pact participants can view connector events"
  on public.connector_events for select to authenticated
  using (public.can_access_pact(pact_id));

create policy "Pact participants can view source mappings"
  on public.pact_milestone_source_mappings for select to authenticated
  using (public.can_access_pact(pact_id));

create policy "Pact owners can manage source mappings"
  on public.pact_milestone_source_mappings for all to authenticated
  using (exists (
    select 1 from public.pacts p where p.id = pact_id and public.is_workspace_member(p.workspace_id, 'owner')
  ))
  with check (created_by = auth.uid() and exists (
    select 1 from public.pacts p where p.id = pact_id and public.is_workspace_member(p.workspace_id, 'owner')
  ));

create policy "Pact participants can view connector evidence"
  on public.connector_evidence for select to authenticated
  using (public.can_access_pact(pact_id));

-- OAuth state is readable only through the one-time security-definer functions below.
revoke all on table public.connector_oauth_states from anon, authenticated;

create function public.create_connector_oauth_state(
  target_provider text,
  target_pact uuid,
  target_state_hash text,
  target_code_verifier_ciphertext text,
  target_return_path text,
  target_expires_at timestamptz
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  created_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if target_provider not in ('github', 'figma')
     or target_state_hash is null or target_state_hash !~ '^[0-9a-f]{64}$'
     or target_code_verifier_ciphertext is null or length(target_code_verifier_ciphertext) > 4096
     or target_return_path is null or target_return_path !~ '^/workspace/[0-9a-f-]{36}/pact/[0-9a-f-]{36}'
     or target_expires_at <= now() or target_expires_at > now() + interval '15 minutes' then
    raise exception 'Invalid connector OAuth state';
  end if;
  if not exists (
    select 1 from public.pacts p where p.id = target_pact and public.is_workspace_member(p.workspace_id, 'owner')
  ) then raise exception 'Owner Pact access required'; end if;
  insert into public.connector_oauth_states(provider, pact_id, user_id, state_hash, code_verifier_ciphertext, return_path, expires_at)
    values (target_provider, target_pact, auth.uid(), target_state_hash, target_code_verifier_ciphertext, target_return_path, target_expires_at)
    returning id into created_id;
  return created_id;
exception when unique_violation then
  raise exception 'OAuth state already exists';
end;
$$;

revoke all on function public.create_connector_oauth_state(text, uuid, text, text, text, timestamptz) from public;
grant execute on function public.create_connector_oauth_state(text, uuid, text, text, text, timestamptz) to authenticated;

create function public.consume_connector_oauth_state(target_state_hash text)
returns table(provider text, pact_id uuid, user_id uuid, code_verifier_ciphertext text, return_path text)
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  return query
    update public.connector_oauth_states s
       set consumed_at = now()
     where s.id = (
       select candidate.id from public.connector_oauth_states candidate
        where candidate.state_hash = target_state_hash
          and candidate.user_id = auth.uid()
          and candidate.consumed_at is null
          and candidate.expires_at > now()
        for update
     )
    returning s.provider, s.pact_id, s.user_id, s.code_verifier_ciphertext, s.return_path;
  if not found then raise exception 'Connector OAuth state is invalid or expired'; end if;
end;
$$;

revoke all on function public.consume_connector_oauth_state(text) from public;
grant execute on function public.consume_connector_oauth_state(text) to authenticated;

create function public.create_connector_connection(
  target_provider text,
  target_pact uuid,
  target_external_account_id text,
  target_external_account_name text,
  target_scopes text[],
  target_access_token_ciphertext text,
  target_refresh_token_ciphertext text,
  target_access_token_expires_at timestamptz
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  created_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if target_provider not in ('github', 'figma')
     or target_external_account_id is null or length(trim(target_external_account_id)) not between 1 and 200
     or target_access_token_ciphertext is null or length(target_access_token_ciphertext) > 8192 then
    raise exception 'Invalid connector connection';
  end if;
  if not exists (
    select 1 from public.pacts p where p.id = target_pact and public.is_workspace_member(p.workspace_id, 'owner')
  ) then raise exception 'Owner Pact access required'; end if;
  insert into public.connector_connections(
    pact_id, provider, connected_by, external_account_id, external_account_name, scopes,
    access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at
  ) values (
    target_pact, target_provider, auth.uid(), trim(target_external_account_id), nullif(trim(target_external_account_name), ''),
    coalesce(target_scopes, '{}'), target_access_token_ciphertext, target_refresh_token_ciphertext, target_access_token_expires_at
  )
  on conflict (pact_id, provider, external_account_id) do update set
    connected_by = auth.uid(),
    external_account_name = excluded.external_account_name,
    scopes = excluded.scopes,
    access_token_ciphertext = excluded.access_token_ciphertext,
    refresh_token_ciphertext = excluded.refresh_token_ciphertext,
    access_token_expires_at = excluded.access_token_expires_at,
    status = case when public.connector_connections.resource_id is null then 'awaiting_resource' else 'active' end,
    last_error = null,
    updated_at = now()
  returning id into created_id;
  return created_id;
end;
$$;

revoke all on function public.create_connector_connection(text, uuid, text, text, text[], text, text, timestamptz) from public;
grant execute on function public.create_connector_connection(text, uuid, text, text, text[], text, text, timestamptz) to authenticated;

create function public.attach_connector_resource(
  target_connection uuid,
  target_resource_id text,
  target_resource_name text,
  target_resource_url text,
  target_webhook_id text,
  target_webhook_secret_ciphertext text
)
returns void language plpgsql security definer set search_path = public
as $$
declare
  target_pact uuid;
  target_workspace uuid;
begin
  if auth.uid() is null or target_resource_id is null or length(trim(target_resource_id)) not between 1 and 300 then
    raise exception 'Invalid connector resource';
  end if;
  select c.pact_id, p.workspace_id into target_pact, target_workspace
    from public.connector_connections c join public.pacts p on p.id = c.pact_id
   where c.id = target_connection;
  if target_pact is null or not public.is_workspace_member(target_workspace, 'owner') then
    raise exception 'Owner Pact access required';
  end if;
  update public.connector_connections
     set resource_id = trim(target_resource_id), resource_name = nullif(trim(target_resource_name), ''),
         resource_url = nullif(trim(target_resource_url), ''), webhook_id = nullif(trim(target_webhook_id), ''),
         webhook_secret_ciphertext = target_webhook_secret_ciphertext, status = 'active', last_error = null, updated_at = now()
   where id = target_connection;
  if not found then raise exception 'Connector connection not found'; end if;
exception when unique_violation then
  raise exception 'This resource is already attached to the Pact';
end;
$$;

revoke all on function public.attach_connector_resource(uuid, text, text, text, text, text) from public;
grant execute on function public.attach_connector_resource(uuid, text, text, text, text, text) to authenticated;

create function public.disconnect_connector(target_connection uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  target_workspace uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select p.workspace_id into target_workspace
    from public.connector_connections c join public.pacts p on p.id = c.pact_id
   where c.id = target_connection;
  if target_workspace is null or not public.is_workspace_member(target_workspace, 'owner') then
    raise exception 'Owner Pact access required';
  end if;
  update public.connector_connections
     set access_token_ciphertext = null, refresh_token_ciphertext = null, webhook_secret_ciphertext = null,
         status = 'disconnected', last_error = null, updated_at = now()
   where id = target_connection;
end;
$$;

revoke all on function public.disconnect_connector(uuid) from public;
grant execute on function public.disconnect_connector(uuid) to authenticated;

create function public.attach_pact_milestone_source(
  target_pact uuid,
  target_milestone uuid,
  target_connection uuid,
  target_filters jsonb default '{}'
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  created_id uuid;
  target_workspace uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select p.workspace_id into target_workspace from public.pacts p where p.id = target_pact;
  if target_workspace is null or not public.is_workspace_member(target_workspace, 'owner') then
    raise exception 'Owner Pact access required';
  end if;
  if not exists (select 1 from public.milestones m where m.id = target_milestone and m.pact_id = target_pact)
     or not exists (select 1 from public.connector_connections c where c.id = target_connection and c.pact_id = target_pact and c.status = 'active') then
    raise exception 'Milestone or active connector not found';
  end if;
  insert into public.pact_milestone_source_mappings(pact_id, milestone_id, connection_id, filters, created_by)
    values (target_pact, target_milestone, target_connection, coalesce(target_filters, '{}'), auth.uid())
  on conflict (milestone_id, connection_id) do update set filters = excluded.filters, enabled = true, updated_at = now()
  returning id into created_id;
  return created_id;
end;
$$;

revoke all on function public.attach_pact_milestone_source(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.attach_pact_milestone_source(uuid, uuid, uuid, jsonb) to authenticated;
