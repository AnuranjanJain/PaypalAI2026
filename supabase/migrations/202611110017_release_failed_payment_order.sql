-- Release a canceled or denied checkout so the owner can create a fresh order.
create or replace function public.mark_pact_payment_failed(target_order_id text)
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
  if event_status = 'failed' then return; end if;
  if event_status <> 'created' then raise exception 'Only an uncaptured order can be released'; end if;
  update public.pact_payment_events
     set status = 'failed', updated_at = now()
   where paypal_order_id = target_order_id and owner_id = auth.uid();
end;
$$;

revoke all on function public.mark_pact_payment_failed(text) from public;
grant execute on function public.mark_pact_payment_failed(text) to authenticated;
