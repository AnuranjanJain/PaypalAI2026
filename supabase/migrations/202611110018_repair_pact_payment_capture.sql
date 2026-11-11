-- Recovery replacement for the capture function when migration 016 was interrupted.
create or replace function public.mark_pact_payment_captured(target_order_id text)
returns void language plpgsql security definer set search_path = public
as $pact_capture$
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
$pact_capture$;

revoke all on function public.mark_pact_payment_captured(text) from public;
grant execute on function public.mark_pact_payment_captured(text) to authenticated;
