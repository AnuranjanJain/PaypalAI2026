alter table public.connector_connections
  add column if not exists resource_filters jsonb not null default '{}';

drop view if exists public.connector_connections_public;
create view public.connector_connections_public as
  select id, pact_id, provider, connected_by, external_account_id, external_account_name,
         resource_id, resource_name, resource_url, resource_filters, scopes, access_token_expires_at,
         webhook_id, status, last_error, created_at, updated_at
    from public.connector_connections
   where public.can_access_pact(pact_id);
grant select on public.connector_connections_public to authenticated;

create function public.attach_connector_resource(
  target_connection uuid,
  target_resource_id text,
  target_resource_name text,
  target_resource_url text,
  target_webhook_id text,
  target_webhook_secret_ciphertext text,
  target_resource_filters jsonb default '{}'
)
returns void language plpgsql security definer set search_path = public
as $$
declare
  target_pact uuid;
  target_workspace uuid;
  connection_owner uuid;
begin
  if auth.uid() is null or target_resource_id is null or length(trim(target_resource_id)) not between 1 and 300
     or target_resource_filters is null or jsonb_typeof(target_resource_filters) is distinct from 'object' then
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
         resource_url = nullif(trim(target_resource_url), ''), resource_filters = target_resource_filters,
         webhook_id = nullif(trim(target_webhook_id), ''), webhook_secret_ciphertext = target_webhook_secret_ciphertext,
         status = 'active', last_error = null, updated_at = now()
   where id = target_connection;
  if not found then raise exception 'Connector connection not found'; end if;
exception when unique_violation then
  raise exception 'This resource is already attached to the Pact';
end;
$$;

revoke all on function public.attach_connector_resource(uuid, text, text, text, text, text, jsonb) from public;
grant execute on function public.attach_connector_resource(uuid, text, text, text, text, text, jsonb) to authenticated;
