-- PayPal is the authority for order creation, capture, and payout status.
-- Authenticated clients may read their ledger through the existing RPCs, but
-- they must not be able to forge a captured or paid state by calling a
-- security-definer write function directly.

revoke all on function public.record_pact_payment_event(uuid, uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.record_pact_payment_event(uuid, uuid, text, text, bigint) to service_role;

revoke all on function public.mark_pact_payment_captured(text) from public, anon, authenticated;
grant execute on function public.mark_pact_payment_captured(text) to service_role;

-- Older projects may not have the cancellation repair function yet. The
-- service-context migration creates it before applying the final grant.
do $$
begin
  if to_regprocedure('public.mark_pact_payment_failed(text)') is not null then
    execute 'revoke all on function public.mark_pact_payment_failed(text) from public, anon, authenticated';
    execute 'grant execute on function public.mark_pact_payment_failed(text) to service_role';
  end if;
end;
$$;

revoke all on function public.record_pact_payout_status(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_pact_payout_status(text, text, text, text, text) to service_role;
