const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createCache, decideRequest } = require('../dist/explorer/src/request-filter');

const scope = { allowedHosts: ['example.com'] };

function resolverFor(map) {
  return async (host) => {
    const addrs = map[host];
    if (!addrs) throw new Error('unresolved ' + host);
    return addrs;
  };
}

function req(overrides = {}) {
  return {
    url: 'https://example.com/',
    method: 'GET',
    resourceType: 'document',
    ...overrides,
  };
}

test('decideRequest permite GET a host del allowlist', async () => {
  const decision = await decideRequest(req(), scope, createCache(), resolverFor({ 'example.com': ['93.184.216.34'] }));
  assert.equal(decision.allow, true);
});

test('decideRequest bloquea verbos destructivos', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const decision = await decideRequest(req({ method }), scope, createCache(), resolverFor({ 'example.com': ['93.184.216.34'] }));
    assert.equal(decision.allow, false);
    assert.equal(decision.code, 'method-not-read-only');
  }
});

test('decideRequest bloquea resource types sospechosos', async () => {
  const decision = await decideRequest(req({ resourceType: 'websocket' }), scope, createCache(), resolverFor({ 'example.com': ['93.184.216.34'] }));
  assert.equal(decision.allow, false);
  assert.equal(decision.code, 'resource-type-blocked');
});

test('decideRequest bloquea redirección a dirección privada', async () => {
  const decision = await decideRequest(req({ url: 'https://example.com/' }), scope, createCache(), resolverFor({ 'example.com': ['10.0.0.1'] }));
  assert.equal(decision.allow, false);
  assert.equal(decision.code, 'url-guard-private-address');
});

test('decideRequest bloquea redirección a metadata de nube', async () => {
  const decision = await decideRequest(req({ url: 'https://example.com/' }), scope, createCache(), resolverFor({ 'example.com': ['169.254.169.254'] }));
  assert.equal(decision.allow, false);
  assert.equal(decision.code, 'url-guard-link-local-address');
});

test('decideRequest bloquea requests cross-origin a hosts fuera del allowlist', async () => {
  const decision = await decideRequest(
    req({ url: 'https://evil.com/exfil.gif', resourceType: 'image' }),
    scope,
    createCache(),
    resolverFor({ 'evil.com': ['93.184.216.34'] }),
  );
  assert.equal(decision.allow, false);
  assert.equal(decision.code, 'url-guard-host-not-in-allowlist');
});

test('decideRequest bloquea hostname IP literal (incluido IPv6)', async () => {
  for (const url of ['http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/']) {
    const decision = await decideRequest(req({ url }), scope, createCache(), resolverFor({}));
    assert.equal(decision.allow, false);
    assert.equal(decision.code, 'url-guard-ip-literal');
  }
});

test('decideRequest cachea la resolución DNS por URL', async () => {
  let calls = 0;
  const resolver = async (host) => { calls += 1; return host === 'example.com' ? ['93.184.216.34'] : []; };
  const cache = createCache();
  await decideRequest(req({ url: 'https://example.com/a' }), scope, cache, resolver);
  await decideRequest(req({ url: 'https://example.com/a' }), scope, cache, resolver);
  await decideRequest(req({ url: 'https://example.com/a' }), scope, cache, resolver);
  assert.equal(calls, 1);
});

test('decideRequest permite HEAD', async () => {
  const decision = await decideRequest(req({ method: 'HEAD' }), scope, createCache(), resolverFor({ 'example.com': ['93.184.216.34'] }));
  assert.equal(decision.allow, true);
});
