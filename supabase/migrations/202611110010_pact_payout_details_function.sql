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
  if v_status <> 'captured' then
    raise exception 'Capture the milestone before requesting a provider payout';
  end if;
  if v_recipient is null then
    select lower(u.email) into v_recipient
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
