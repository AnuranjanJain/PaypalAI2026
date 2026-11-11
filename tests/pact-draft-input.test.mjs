import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePactDraftInput } from '../src/lib/pact-draft-input.ts';
import { getSafeNextPath } from '../src/lib/navigation.ts';

const validDraft = {
  title: 'Website redesign',
  brief: 'Redesign the public website and deliver the responsive source files.',
  budget: '1000.00',
  milestoneTitles: ['Discovery', 'First delivery', 'Review and revision', 'Final handoff'],
  milestoneAmounts: ['300.00', '200.00', '250.00', '250.00'],
};

test('parses an editable draft and preserves exact cent values', () => {
  assert.deepEqual(parsePactDraftInput(validDraft), {
    title: 'Website redesign',
    brief: 'Redesign the public website and deliver the responsive source files.',
    budgetCents: 100000,
    milestones: [
      { title: 'Discovery', amountCents: 30000 },
      { title: 'First delivery', amountCents: 20000 },
      { title: 'Review and revision', amountCents: 25000 },
      { title: 'Final handoff', amountCents: 25000 },
    ],
  });
});

test('rejects a draft when milestone amounts do not equal the budget', () => {
  assert.equal(parsePactDraftInput({ ...validDraft, milestoneAmounts: ['300', '200', '250', '249.99'] }), null);
});

test('rejects malformed currency and invalid milestone titles', () => {
  assert.equal(parsePactDraftInput({ ...validDraft, budget: '1e3' }), null);
  assert.equal(parsePactDraftInput({ ...validDraft, milestoneAmounts: ['0.001', '200', '250', '250'] }), null);
  assert.equal(parsePactDraftInput({ ...validDraft, milestoneTitles: ['', ...validDraft.milestoneTitles.slice(1)] }), null);
});

test('keeps post-login redirects inside the application', () => {
  assert.equal(getSafeNextPath('/invite/abc_123'), '/invite/abc_123');
  assert.equal(getSafeNextPath('https://attacker.example'), '/workspace');
  assert.equal(getSafeNextPath('//attacker.example/path'), '/workspace');
  assert.equal(getSafeNextPath('/\\attacker.example'), '/workspace');
});
