alter table public.pact_payment_events
  add column if not exists payout_recipient text,
  add column if not exists payout_batch_id text,
  add column if not exists payout_error text,
  add column if not exists payout_updated_at timestamptz,
  add column if not exists payout_status text not null default 'not_requested';

alter table public.pact_payment_events
  drop constraint if exists pact_payment_events_payout_status_check;

alter table public.pact_payment_events
  add constraint pact_payment_events_payout_status_check
  check (payout_status in ('not_requested', 'payout_pending', 'paid_to_provider', 'failed'));

alter table public.pact_payment_events
  drop constraint if exists pact_payment_events_payout_recipient_check;

alter table public.pact_payment_events
  add constraint pact_payment_events_payout_recipient_check
  check (payout_recipient is null or payout_recipient ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');

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
  event_row public.pact_payment_events%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select e.* into event_row
    from public.pact_payment_events e
   where e.paypal_order_id = target_order_id
     and e.owner_id = auth.uid()
   for update;
  if not found then raise exception 'Payment order not found'; end if;
  if event_row.status <> 'captured' then
    raise exception 'Capture the milestone before requesting a provider payout';
  end if;

  if event_row.payout_recipient is null then
    select lower(u.email)
      into event_row.payout_recipient
      from public.pact_participants pp
      join auth.users u on u.id = pp.user_id
     where pp.pact_id = event_row.pact_id
       and pp.user_id <> event_row.owner_id
     order by pp.joined_at asc
     limit 1;
    if event_row.payout_recipient is null then
      raise exception 'No provider is attached to this Pact';
    end if;
  end if;

  return query select event_row.pact_id, event_row.milestone_id, event_row.status,
    event_row.payout_status, event_row.amount_cents, event_row.currency, event_row.payout_recipient,
    event_row.payout_batch_id;
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
   where e.paypal_order_id = target_order_id
     and e.owner_id = auth.uid()
   for update;
  if current_status is null then raise exception 'Payment order not found'; end if;
  if current_status <> 'captured' then
    raise exception 'Capture the milestone before requesting a provider payout';
  end if;
  if target_recipient is null or target_recipient !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Invalid payout recipient';
  end if;
  if target_status = 'paid_to_provider' and (target_batch_id is null or length(target_batch_id) > 100) then
    raise exception 'A PayPal payout reference is required';
  end if;

  update public.pact_payment_events
     set payout_status = target_status,
         payout_recipient = lower(trim(target_recipient)),
         payout_batch_id = nullif(trim(coalesce(target_batch_id, '')), ''),
         payout_error = nullif(trim(coalesce(target_error, '')), ''),
         payout_updated_at = now(),
         updated_at = now()
   where paypal_order_id = target_order_id
     and owner_id = auth.uid();
end;
$$;

revoke all on function public.record_pact_payout_status(text, text, text, text, text) from public;
grant execute on function public.record_pact_payout_status(text, text, text, text, text) to authenticated;
