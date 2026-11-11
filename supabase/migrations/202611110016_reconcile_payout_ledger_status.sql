-- Keep the main payment ledger in sync with provider payout outcomes.
create or replace function public.mark_pact_payment_captured(target_order_id text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  event_status text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select status into event_status
    from public.pact_payment_events
   where paypal_order_id = target_order_id and owner_id = auth.uid()
   for update;
  if event_status is null then raise exception 'Payment order not found'; end if;
  if event_status in ('captured', 'payout_pending', 'paid_to_provider', 'failed') then return; end if;
  if event_status <> 'created' then raise exception 'Payment order is not capturable'; end if;
  update public.pact_payment_events
     set status = 'captured', updated_at = now()
   where paypal_order_id = target_order_id and owner_id = auth.uid();
end;
$$;

revoke all on function public.mark_pact_payment_captured(text) from public;
grant execute on function public.mark_pact_payment_captured(text) to authenticated;

create or replace function public.get_pact_payout_details(target_order_id text)
returns table(
  pact_id uuid,
  milestone_id uuid,
  status text,
  payout_status text,
  amount_cents bigint,
  currency text,
  recipient_email text,
  payout_batch_id text
)
language plpgsql security definer set search_path = public
as $$
declare
  v_pact_id uuid;
  v_milestone_id uuid;
  v_status text;
  v_payout_status text;
  v_amount_cents bigint;
  v_currency text;
  v_recipient text;
  v_batch_id text;
  v_owner_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select e.pact_id, e.milestone_id, e.status, e.payout_status,
         e.amount_cents, e.currency, e.payout_recipient,
         e.payout_batch_id, e.owner_id
    into v_pact_id, v_milestone_id, v_status, v_payout_status,
         v_amount_cents, v_currency, v_recipient, v_batch_id, v_owner_id
    from public.pact_payment_events e
   where e.paypal_order_id = target_order_id and e.owner_id = auth.uid()
   for update;
  if not found then raise exception 'Payment order not found'; end if;
  if v_status not in ('captured', 'payout_pending', 'paid_to_provider', 'failed') then
    raise exception 'Capture the milestone before requesting a provider payout';
  end if;
  if v_recipient is null then
    select lower(trim(u.email)) into v_recipient
      from public.pact_participants pp
      join auth.users u on u.id = pp.user_id
     where pp.pact_id = v_pact_id and pp.user_id <> v_owner_id
     order by pp.joined_at asc limit 1;
    if v_recipient is null then raise exception 'No provider is attached to this Pact'; end if;
  end if;
  return query select v_pact_id, v_milestone_id, v_status, v_payout_status,
    v_amount_cents, v_currency, v_recipient, v_batch_id;
end;
$$;

revoke all on function public.get_pact_payout_details(text) from public;
grant execute on function public.get_pact_payout_details(text) to authenticated;

create or replace function public.record_pact_payout_status(
  target_order_id text,
  target_status text,
  target_recipient text,
  target_batch_id text default null,
  target_error text default null
)
returns void language plpgsql security definer set search_path = public
as $$
declare
  current_status text;
begin
  if auth.uid() is null or target_status not in ('payout_pending', 'paid_to_provider', 'failed') then
    raise exception 'Invalid payout update';
  end if;
  select e.status into current_status
    from public.pact_payment_events e
   where e.paypal_order_id = target_order_id and e.owner_id = auth.uid()
   for update;
  if current_status is null then raise exception 'Payment order not found'; end if;
  if current_status not in ('captured', 'payout_pending', 'failed') then
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
$$;

revoke all on function public.record_pact_payout_status(text, text, text, text, text) from public;
grant execute on function public.record_pact_payout_status(text, text, text, text, text) to authenticated;
