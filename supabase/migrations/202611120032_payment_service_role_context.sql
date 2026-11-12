-- Server-side PayPal routes use the Supabase service role after migration
-- 202611120031. These replacements keep the mutation functions unavailable
-- to browser sessions while allowing service-role calls to resolve the Pact
-- owner from the ledger instead of relying on auth.uid().

create or replace function public.record_pact_payment_event(
  target_pact uuid,
  target_milestone uuid,
  target_order_id text,
  target_approval_url text,
  target_amount_cents bigint
)
returns void language plpgsql security definer set search_path = public
as $pact_payment_event$
declare
  target_workspace uuid;
  expected_amount bigint;
  effective_owner uuid;
  is_service_role boolean := current_setting('request.jwt.claim.role', true) = 'service_role';
begin
  if auth.uid() is null and not is_service_role then
    raise exception 'Authentication required';
  end if;
  select p.workspace_id, m.amount_cents
    into target_workspace, expected_amount
    from public.pacts p
    join public.milestones m on m.pact_id = p.id and m.id = target_milestone
   where p.id = target_pact and p.status = 'active' and m.status = 'approved';
  if target_workspace is null then raise exception 'Owner checkout required'; end if;
  if is_service_role then
    select wm.user_id into effective_owner
      from public.workspace_members wm
     where wm.workspace_id = target_workspace and wm.role = 'owner'
     order by wm.user_id limit 1;
  else
    effective_owner := auth.uid();
    if not public.is_workspace_member(target_workspace, 'owner') then
      raise exception 'Owner checkout required';
    end if;
  end if;
  if effective_owner is null then raise exception 'Pact owner could not be resolved'; end if;
  if target_amount_cents is null or target_amount_cents <> expected_amount then
    raise exception 'Payment amount does not match the approved milestone';
  end if;
  if target_order_id is null or target_order_id !~ '^[A-Za-z0-9_-]{3,100}$' then
    raise exception 'Invalid PayPal order';
  end if;
  if target_approval_url is not null and target_approval_url !~* '^https://[^[:space:]]+$' then
    raise exception 'Invalid PayPal approval link';
  end if;
  insert into public.pact_payment_events(
    pact_id, milestone_id, owner_id, paypal_order_id, approval_url, amount_cents, currency, status
  ) values (
    target_pact, target_milestone, effective_owner, target_order_id, target_approval_url,
    target_amount_cents, 'USD', 'created'
  );
exception when unique_violation then
  raise exception 'A payment order already exists for this milestone';
end;
$pact_payment_event$;

create or replace function public.mark_pact_payment_captured(target_order_id text)
returns void language plpgsql security definer set search_path = public
as $pact_payment_capture$
declare
  event_status text;
  is_service_role boolean := current_setting('request.jwt.claim.role', true) = 'service_role';
begin
  if auth.uid() is null and not is_service_role then raise exception 'Authentication required'; end if;
  select e.status into event_status from public.pact_payment_events e
   where e.paypal_order_id = target_order_id and (is_service_role or e.owner_id = auth.uid()) for update;
  if event_status is null then raise exception 'Payment order not found'; end if;
  if event_status in ('captured', 'payout_pending', 'paid_to_provider') then return; end if;
  if event_status <> 'created' then raise exception 'Payment order is not capturable'; end if;
  update public.pact_payment_events set status = 'captured', updated_at = now()
   where paypal_order_id = target_order_id and (is_service_role or owner_id = auth.uid());
end;
$pact_payment_capture$;

create or replace function public.mark_pact_payment_failed(target_order_id text)
returns void language plpgsql security definer set search_path = public
as $pact_payment_failure$
declare
  event_status text;
  is_service_role boolean := current_setting('request.jwt.claim.role', true) = 'service_role';
begin
  if auth.uid() is null and not is_service_role then raise exception 'Authentication required'; end if;
  select e.status into event_status from public.pact_payment_events e
   where e.paypal_order_id = target_order_id and (is_service_role or e.owner_id = auth.uid()) for update;
  if event_status is null then raise exception 'Payment order not found'; end if;
  if event_status = 'failed' then return; end if;
  if event_status <> 'created' then raise exception 'Only an uncaptured order can be released'; end if;
  update public.pact_payment_events set status = 'failed', updated_at = now()
   where paypal_order_id = target_order_id and (is_service_role or owner_id = auth.uid());
end;
$pact_payment_failure$;

create or replace function public.record_pact_payout_status(
  target_order_id text,
  target_status text,
  target_recipient text,
  target_batch_id text default null,
  target_error text default null
)
returns void language plpgsql security definer set search_path = public
as $pact_payout_status$
declare
  current_status text;
  current_payout_status text;
  is_service_role boolean := current_setting('request.jwt.claim.role', true) = 'service_role';
begin
  if (auth.uid() is null and not is_service_role)
     or target_status not in ('payout_pending', 'paid_to_provider', 'failed') then
    raise exception 'Invalid payout update';
  end if;
  select e.status, e.payout_status into current_status, current_payout_status
    from public.pact_payment_events e
   where e.paypal_order_id = target_order_id and (is_service_role or e.owner_id = auth.uid()) for update;
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
     set status = target_status, payout_status = target_status,
         payout_recipient = lower(trim(target_recipient)),
         payout_batch_id = nullif(trim(coalesce(target_batch_id, '')), ''),
         payout_error = nullif(trim(coalesce(target_error, '')), ''),
         payout_updated_at = now(), updated_at = now()
   where paypal_order_id = target_order_id and (is_service_role or owner_id = auth.uid());
end;
$pact_payout_status$;

revoke all on function public.record_pact_payment_event(uuid, uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.record_pact_payment_event(uuid, uuid, text, text, bigint) to service_role;
revoke all on function public.mark_pact_payment_captured(text) from public, anon, authenticated;
grant execute on function public.mark_pact_payment_captured(text) to service_role;
revoke all on function public.mark_pact_payment_failed(text) from public, anon, authenticated;
grant execute on function public.mark_pact_payment_failed(text) to service_role;
revoke all on function public.record_pact_payout_status(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_pact_payout_status(text, text, text, text, text) to service_role;
