import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePayoutStatus } from '../src/lib/payout.ts';
import { getStableRequestId } from '../src/lib/paypal.ts';

test('normalizes PayPal payout batch statuses', () => {
  assert.equal(normalizePayoutStatus('SUCCESS'), 'paid_to_provider');
  assert.equal(normalizePayoutStatus('PENDING'), 'payout_pending');
  assert.equal(normalizePayoutStatus('DENIED'), 'failed');
  assert.equal(normalizePayoutStatus('unexpected'), null);
});

test('creates stable PayPal retry identifiers for the same order', () => {
  const first = getStableRequestId('pact-payout', 'order-123');
  assert.equal(first, getStableRequestId('pact-payout', 'order-123'));
  assert.notEqual(first, getStableRequestId('pact-payout', 'order-456'));
  assert.match(first, /^pact-payout-[0-9a-f]{28}$/);
});
