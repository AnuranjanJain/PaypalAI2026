-- Let accepted Pact participants follow payment progress without granting money actions.
drop policy if exists "Owners can view Pact payment events" on public.pact_payment_events;
create policy "Pact participants can view payment events"
  on public.pact_payment_events for select to authenticated
  using (public.can_access_pact(pact_id));
