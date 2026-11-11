import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePendingPayment } from '../src/lib/pending-payment.ts';

test('restores a valid pending sandbox order', () => {
  const input = { milestoneId: 2, orderId: 'ABC123', approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ABC123' };
  assert.deepEqual(parsePendingPayment(JSON.stringify(input)), input);
});

test('rejects malformed, mismatched, and unsafe pending orders', () => {
  const base = { milestoneId: 2, orderId: 'ABC123', approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ABC123' };
  assert.equal(parsePendingPayment('{'), null);
  assert.equal(parsePendingPayment(JSON.stringify({ ...base, milestoneId: 1 })), null);
  assert.equal(parsePendingPayment(JSON.stringify({ ...base, approvalUrl: 'https://sandbox.paypal.com.attacker.example/' })), null);
  assert.equal(parsePendingPayment(JSON.stringify({ ...base, approvalUrl: 'http://sandbox.paypal.com/' })), null);
  assert.equal(parsePendingPayment(JSON.stringify({ ...base, orderId: '../abc' })), null);
});
