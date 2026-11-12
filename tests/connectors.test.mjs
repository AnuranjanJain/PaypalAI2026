import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCodeChallenge, safeCompare, verifyHmacSha256 } from '../src/lib/connectors/security.ts';
import { normalizeFigmaWebhook, verifyFigmaPasscode } from '../src/lib/connectors/figma.ts';
import { githubAuthorizationUrl, normalizeGitHubWebhook } from '../src/lib/connectors/github.ts';
import { createHmac } from 'node:crypto';

test('PKCE challenge and constant-time comparison helpers are deterministic', () => {
  assert.equal(createCodeChallenge('verifier'), 'iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ');
  assert.equal(safeCompare('same', 'same'), true);
  assert.equal(safeCompare('same', 'different'), false);
});

test('GitHub authorization uses the verified OAuth path when App credentials are present', () => {
  const previous = {
    appId: process.env.GITHUB_APP_ID,
    appSlug: process.env.GITHUB_APP_SLUG,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
    clientId: process.env.GITHUB_CLIENT_ID,
    appUrl: process.env.APP_URL,
  };
  process.env.GITHUB_APP_ID = '123';
  process.env.GITHUB_APP_SLUG = 'pact-app';
  process.env.GITHUB_APP_PRIVATE_KEY = 'reserved';
  process.env.GITHUB_CLIENT_ID = 'oauth-client';
  process.env.APP_URL = 'http://localhost:3000';
  try {
    const url = new URL(githubAuthorizationUrl('state', 'verifier'));
    assert.equal(url.pathname, '/login/oauth/authorize');
    assert.equal(url.searchParams.get('client_id'), 'oauth-client');
    assert.equal(url.searchParams.get('state'), 'state');
  } finally {
    for (const [key, value] of Object.entries({
      GITHUB_APP_ID: previous.appId,
      GITHUB_APP_SLUG: previous.appSlug,
      GITHUB_APP_PRIVATE_KEY: previous.privateKey,
      GITHUB_CLIENT_ID: previous.clientId,
      APP_URL: previous.appUrl,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('GitHub signatures and normalized events are validated', () => {
  const body = JSON.stringify({ repository: { full_name: 'acme/pact', html_url: 'https://github.com/acme/pact' }, sender: { login: 'provider' }, after: 'abc123', ref: 'refs/heads/main', commits: [{ id: 'abc123', message: 'Ship milestone' }] });
  const signature = `sha256=${createHmac('sha256', 'secret').update(body).digest('hex')}`;
  assert.equal(verifyHmacSha256(body, signature, 'secret'), true);
  assert.equal(verifyHmacSha256(body, signature, 'wrong'), false);
  const events = normalizeGitHubWebhook(JSON.parse(body), 'push', 'delivery-1');
  assert.equal(events.length, 1);
  assert.equal(events[0].externalId, 'abc123');
  assert.match(events[0].summary, /Ship milestone/);
});

test('Figma passcodes and event normalization reject untrusted payloads', () => {
  const payload = { passcode: 'secret', webhook_id: '42', event_type: 'FILE_VERSION_UPDATE', file_key: 'file12345', version_id: 'v1', timestamp: '2026-11-12T00:00:00Z' };
  assert.equal(verifyFigmaPasscode(payload, 'secret'), true);
  assert.equal(verifyFigmaPasscode(payload, 'wrong'), false);
  const events = normalizeFigmaWebhook(payload);
  assert.equal(events[0].eventType, 'FILE_VERSION_UPDATE');
  assert.equal(events[0].resourceId, 'file12345');
});
