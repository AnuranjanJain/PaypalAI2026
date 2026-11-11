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
