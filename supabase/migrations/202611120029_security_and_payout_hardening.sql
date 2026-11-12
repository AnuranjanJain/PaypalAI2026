-- Keep participant-visible connector and agent tables read-only from the browser.
-- All writes flow through the security-definer RPCs or the service-role worker.
revoke insert, update, delete on table public.connector_connections from authenticated;
revoke insert, update, delete on table public.connector_oauth_states from authenticated;
revoke insert, update, delete on table public.connector_events from authenticated;
revoke insert, update, delete on table public.pact_milestone_source_mappings from authenticated;
revoke insert, update, delete on table public.connector_evidence from authenticated;
revoke insert, update, delete on table public.pact_events from authenticated;
revoke insert, update, delete on table public.agent_runs from authenticated;
revoke insert, update, delete on table public.agent_actions from authenticated;
revoke insert, update, delete on table public.progress_snapshots from authenticated;
revoke insert, update, delete on table public.scope_change_orders from authenticated;
revoke insert, update, delete on table public.disputes from authenticated;
revoke insert, update, delete on table public.dispute_evidence from authenticated;
revoke insert, update, delete on table public.negotiation_sessions from authenticated;
revoke insert, update, delete on table public.negotiation_offers from authenticated;

-- Keep immutable audit attribution bound to the authenticated participant.
-- Worker calls use the service role and may provide their own actor metadata.
create or replace function public.record_pact_event(
  target_pact uuid,
  target_event_type text,
  target_aggregate_type text,
  target_aggregate_id uuid,
  target_payload jsonb default '{}'::jsonb,
  target_actor_type text default 'system',
  target_actor_id uuid default null,
  target_correlation_id text default null,
  target_idempotency_key text default null
)
returns uuid language plpgsql security definer set search_path = public
as $agent_event_hardened$
declare
  event_id uuid;
  target_workspace uuid;
  member_role text;
  is_service_role boolean := current_setting('request.jwt.claim.role', true) = 'service_role';
begin
  if auth.uid() is null and not is_service_role then
    raise exception 'Authentication required';
  end if;
  if target_pact is null or target_event_type is null or length(trim(target_event_type)) not between 3 and 120
     or target_aggregate_type not in ('pact', 'milestone', 'submission', 'payment', 'scope_change', 'dispute', 'negotiation')
     or target_aggregate_id is null
     or target_actor_type not in ('owner', 'provider', 'system', 'worker')
     or jsonb_typeof(coalesce(target_payload, '{}'::jsonb)) is distinct from 'object' then
    raise exception 'Invalid Pact event';
  end if;
  if auth.uid() is not null and not public.can_access_pact(target_pact) then
    raise exception 'Pact access required';
  end if;
  select p.workspace_id into target_workspace from public.pacts p where p.id = target_pact;
  if target_workspace is null then raise exception 'Pact not found'; end if;

  if not is_service_role then
    if target_actor_id is not null and target_actor_id <> auth.uid() then
      raise exception 'Audit actor must match the signed-in user';
    end if;
    select wm.role into member_role
      from public.workspace_members wm
     where wm.workspace_id = target_workspace and wm.user_id = auth.uid();
    if target_actor_type = 'owner' and member_role <> 'owner' then
      raise exception 'Owner audit attribution required';
    end if;
    if target_actor_type = 'provider' and member_role <> 'provider' then
      raise exception 'Provider audit attribution required';
    end if;
    if target_actor_type = 'worker' then
      raise exception 'Worker audit attribution requires the service role';
    end if;
  end if;

  if target_idempotency_key is not null then
    select e.id into event_id from public.pact_events e
     where e.pact_id = target_pact and e.idempotency_key = trim(target_idempotency_key);
    if event_id is not null then return event_id; end if;
  end if;

  insert into public.pact_events(
    workspace_id, pact_id, aggregate_type, aggregate_id, event_type,
    actor_id, actor_type, payload, correlation_id, idempotency_key
  ) values (
    target_workspace, target_pact, target_aggregate_type, target_aggregate_id,
    trim(target_event_type), coalesce(target_actor_id, auth.uid()), target_actor_type,
    coalesce(target_payload, '{}'::jsonb), nullif(trim(target_correlation_id), ''),
    nullif(trim(target_idempotency_key), '')
  ) returning id into event_id;
  return event_id;
exception when unique_violation then
  select e.id into event_id from public.pact_events e
   where e.pact_id = target_pact and e.idempotency_key = trim(target_idempotency_key);
  if event_id is null then raise; end if;
  return event_id;
end;
$agent_event_hardened$;

revoke all on function public.record_pact_event(uuid, text, text, uuid, jsonb, text, uuid, text, text) from public;
grant execute on function public.record_pact_event(uuid, text, text, uuid, jsonb, text, uuid, text, text) to authenticated, service_role;

-- A failed capture is not a captured payment. The only retryable failed state
-- is a provider payout failure after PayPal already confirmed capture.
create or replace function public.record_pact_payout_status(
  target_order_id text,
  target_status text,
  target_recipient text,
  target_batch_id text default null,
  target_error text default null
)
returns void language plpgsql security definer set search_path = public
as $pact_status_hardened$
declare
  current_status text;
  current_payout_status text;
begin
  if auth.uid() is null or target_status not in ('payout_pending', 'paid_to_provider', 'failed') then
    raise exception 'Invalid payout update';
  end if;
  select e.status, e.payout_status
    into current_status, current_payout_status
    from public.pact_payment_events e
   where e.paypal_order_id = target_order_id and e.owner_id = auth.uid()
   for update;
  if current_status is null then raise exception 'Payment order not found'; end if;
  if current_status <> 'captured' and not (current_status = 'failed' and current_payout_status = 'failed') then
    raise exception 'Capture the milestone before requesting a provider payout';
  end if;
  if target_recipient is null or target_recipient !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Invalid payout recipient';
  end if;
  if target_status = 'paid_to_provider' and (target_batch_id is null or length(target_batch_id) > 100) then
    raise exception 'A PayPal payout reference is required';
  end if;
  update public.pact_payment_events
     set status = target_status,
         payout_status = target_status,
         payout_recipient = lower(trim(target_recipient)),
         payout_batch_id = nullif(trim(coalesce(target_batch_id, '')), ''),
         payout_error = nullif(trim(coalesce(target_error, '')), ''),
         payout_updated_at = now(), updated_at = now()
   where paypal_order_id = target_order_id and owner_id = auth.uid();
end;
$pact_status_hardened$;

revoke all on function public.record_pact_payout_status(text, text, text, text, text) from public;
grant execute on function public.record_pact_payout_status(text, text, text, text, text) to authenticated;
