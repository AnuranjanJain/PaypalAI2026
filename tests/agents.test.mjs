import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deterministicFallback, fallbackScopeShield } from '../src/lib/agents/fallbacks.ts';
import { runMuseStructured } from '../src/lib/agents/muse.ts';
import { sanitizeAgentContext, validateAgentOutput } from '../src/lib/agents/contracts.ts';

test('validates typed Progress output and rejects unsafe values', () => {
  const valid = {
    state: 'on_track',
    percent: 50,
    confidence: 0.8,
    blockers: [],
    nextActions: ['Run review'],
    forecastDueAt: null,
    evidenceRefs: [],
    summary: 'Evidence is ready.',
  };
  assert.deepEqual(validateAgentOutput('progress', valid), valid);
  assert.equal(validateAgentOutput('progress', { ...valid, confidence: 2 }), null);
  assert.equal(validateAgentOutput('progress', { ...valid, percent: -1 }), null);
});

test('validates ScopeShield output without allowing arbitrary action names', () => {
  const valid = {
    inScope: false,
    severity: 'high',
    changedItems: ['Mobile app deliverable'],
    rationale: 'The request adds a new deliverable.',
    amountDeltaCents: 40000,
    scheduleDeltaDays: 7,
    recommendedAction: 'draft_change_order',
  };
  assert.deepEqual(validateAgentOutput('scope_shield', valid), valid);
  assert.deepEqual(validateAgentOutput('scope_shield', { ...valid, amountDeltaCents: null, scheduleDeltaDays: null }), { ...valid, amountDeltaCents: 0, scheduleDeltaDays: 0 });
  assert.equal(validateAgentOutput('scope_shield', { ...valid, recommendedAction: 'apply_now' }), null);
});

test('deterministic scope fallback flags an out-of-scope mobile app request', () => {
  const result = fallbackScopeShield({ text: 'Please also create a mobile app for the launch.' });
  assert.equal(result.inScope, false);
  assert.equal(result.recommendedAction, 'draft_change_order');
  assert.equal(result.severity, 'high');
});

test('deterministic fallback never returns an applied action', () => {
  const result = deterministicFallback('negotiation', { requestedTerms: { deliverables: ['Add accessibility lockup'] } });
  assert.equal(result.terms.amountDeltaCents, 0);
  assert.match(result.nextMessage, /confirm/i);
});

test('sanitizes credentials and bounds untrusted context', () => {
  const result = sanitizeAgentContext({ apiKey: 'secret', notes: 'a'.repeat(5000), nested: { password: 'hidden', ok: true } });
  assert.equal(result.apiKey, undefined);
  assert.equal(result.nested.password, undefined);
  assert.equal(result.nested.ok, true);
  assert.equal(result.notes.length, 4014);
});

test('Meta Muse adapter returns a safe unavailable result when unconfigured', async () => {
  const previousKey = process.env.AI_API_KEY;
  const previousAlias = process.env.MODEL_API_KEY;
  delete process.env.AI_API_KEY;
  delete process.env.MODEL_API_KEY;
  const result = await runMuseStructured('progress', { notes: 'untrusted evidence' });
  assert.equal(result.value, null);
  assert.equal(result.mode, 'provider-unavailable');
  assert.equal(result.errorCode, 'provider_not_configured');
  if (previousKey === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = previousKey;
  if (previousAlias === undefined) delete process.env.MODEL_API_KEY; else process.env.MODEL_API_KEY = previousAlias;
});

test('Meta Muse adapter classifies malformed structured output as provider-invalid', async () => {
  const previousKey = process.env.AI_API_KEY;
  const previousUrl = process.env.AI_API_URL;
  const previousFetch = globalThis.fetch;
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_API_URL = 'https://muse.test/responses';
  globalThis.fetch = async () => new Response(JSON.stringify({ output_text: '{not-json' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    const result = await runMuseStructured('progress', { notes: 'evidence' });
    assert.equal(result.value, null);
    assert.equal(result.mode, 'provider-invalid');
    assert.equal(result.errorCode, 'provider_invalid_json');
    assert.deepEqual(result.validationErrors, ['output_json_invalid']);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = previousKey;
    if (previousUrl === undefined) delete process.env.AI_API_URL; else process.env.AI_API_URL = previousUrl;
  }
});
