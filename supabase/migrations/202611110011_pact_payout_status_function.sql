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
         payout_updated_at = now(), updated_at = now()
   where paypal_order_id = target_order_id and owner_id = auth.uid();
end;
$$;

revoke all on function public.record_pact_payout_status(text, text, text, text, text) from public;
grant execute on function public.record_pact_payout_status(text, text, text, text, text) to authenticated;
