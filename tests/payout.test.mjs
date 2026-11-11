import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePayoutStatus } from '../src/lib/payout.ts';

test('normalizes PayPal payout batch statuses', () => {
  assert.equal(normalizePayoutStatus('SUCCESS'), 'paid_to_provider');
  assert.equal(normalizePayoutStatus('PENDING'), 'payout_pending');
  assert.equal(normalizePayoutStatus('DENIED'), 'failed');
  assert.equal(normalizePayoutStatus('unexpected'), null);
});
