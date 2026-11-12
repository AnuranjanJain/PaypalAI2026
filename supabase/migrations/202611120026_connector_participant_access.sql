-- A Pact participant may authorize and manage their own connector connection.
drop policy if exists "Pact owners can create connector connections" on public.connector_connections;
create policy "Pact participants can create own connector connections"
  on public.connector_connections for insert to authenticated
  with check (connected_by = auth.uid() and public.can_access_pact(pact_id));

drop policy if exists "Pact owners can update connector connections" on public.connector_connections;
create policy "Pact participants can update own connector connections"
  on public.connector_connections for update to authenticated
  using (connected_by = auth.uid() and public.can_access_pact(pact_id))
  with check (connected_by = auth.uid() and public.can_access_pact(pact_id));

drop policy if exists "Pact owners can delete connector connections" on public.connector_connections;
create policy "Pact participants can delete own connector connections"
  on public.connector_connections for delete to authenticated
  using (connected_by = auth.uid() and public.can_access_pact(pact_id));

create or replace function public.create_connector_oauth_state(
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
  if not public.can_access_pact(target_pact) then raise exception 'Pact access required'; end if;
  insert into public.connector_oauth_states(provider, pact_id, user_id, state_hash, code_verifier_ciphertext, return_path, expires_at)
    values (target_provider, target_pact, auth.uid(), target_state_hash, target_code_verifier_ciphertext, target_return_path, target_expires_at)
    returning id into created_id;
  return created_id;
exception when unique_violation then
  raise exception 'OAuth state already exists';
end;
$$;

create or replace function public.create_connector_connection(
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
  if not public.can_access_pact(target_pact) then raise exception 'Pact access required'; end if;
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
  where public.connector_connections.connected_by = auth.uid()
  returning id into created_id;
  if created_id is null then raise exception 'A different Pact participant owns this connection'; end if;
  return created_id;
end;
$$;

create or replace function public.attach_connector_resource(
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
  connection_owner uuid;
begin
  if auth.uid() is null or target_resource_id is null or length(trim(target_resource_id)) not between 1 and 300 then
    raise exception 'Invalid connector resource';
  end if;
  select c.pact_id, p.workspace_id, c.connected_by into target_pact, target_workspace, connection_owner
    from public.connector_connections c join public.pacts p on p.id = c.pact_id
   where c.id = target_connection;
  if target_pact is null or (connection_owner <> auth.uid() and not public.is_workspace_member(target_workspace, 'owner')) then
    raise exception 'Connector access required';
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

create or replace function public.disconnect_connector(target_connection uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  target_workspace uuid;
  connection_owner uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select p.workspace_id, c.connected_by into target_workspace, connection_owner
    from public.connector_connections c join public.pacts p on p.id = c.pact_id
   where c.id = target_connection;
  if target_workspace is null or (connection_owner <> auth.uid() and not public.is_workspace_member(target_workspace, 'owner')) then
    raise exception 'Connector access required';
  end if;
  update public.connector_connections
     set access_token_ciphertext = null, refresh_token_ciphertext = null, webhook_secret_ciphertext = null,
         status = 'disconnected', last_error = null, updated_at = now()
   where id = target_connection;
end;
$$;
