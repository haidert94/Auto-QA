const assert = require('node:assert/strict');
const { test } = require('node:test');
const { classifyAddress, validateExplorationUrl } = require('../dist/exploration/url-guard');

function resolverFor(map) {
  return async (host) => {
    const addrs = map[host];
    if (!addrs) throw new Error('unresolved: ' + host);
    return addrs;
  };
}

const publicScope = { allowedHosts: ['example.com'] };

test('classifyAddress reconoce loopback IPv4', () => {
  assert.equal(classifyAddress('127.0.0.1'), 'loopback-address');
  assert.equal(classifyAddress('127.255.255.254'), 'loopback-address');
});

test('classifyAddress reconoce rangos privados IPv4', () => {
  assert.equal(classifyAddress('10.0.0.1'), 'private-address');
  assert.equal(classifyAddress('172.16.0.1'), 'private-address');
  assert.equal(classifyAddress('172.31.255.254'), 'private-address');
  assert.equal(classifyAddress('192.168.1.1'), 'private-address');
});

test('classifyAddress reconoce link-local IPv4 incluyendo metadata de nube', () => {
  assert.equal(classifyAddress('169.254.0.1'), 'link-local-address');
  assert.equal(classifyAddress('169.254.169.254'), 'link-local-address');
});

test('classifyAddress reconoce CGNAT, multicast y reservado IPv4', () => {
  assert.equal(classifyAddress('100.64.0.1'), 'reserved-address');
  assert.equal(classifyAddress('224.0.0.1'), 'multicast-address');
  assert.equal(classifyAddress('240.0.0.1'), 'reserved-address');
  assert.equal(classifyAddress('0.0.0.0'), 'unspecified-address');
});

test('classifyAddress reconoce rangos IPv6 sensibles', () => {
  assert.equal(classifyAddress('::1'), 'loopback-address');
  assert.equal(classifyAddress('::'), 'unspecified-address');
  assert.equal(classifyAddress('fe80::1'), 'link-local-address');
  assert.equal(classifyAddress('fc00::1'), 'unique-local-address');
  assert.equal(classifyAddress('fd12:3456:789a::1'), 'unique-local-address');
  assert.equal(classifyAddress('ff02::1'), 'multicast-address');
});

test('classifyAddress reconoce IPv4-mapped sobre IPv6', () => {
  assert.equal(classifyAddress('::ffff:127.0.0.1'), 'loopback-address');
  assert.equal(classifyAddress('::ffff:169.254.169.254'), 'link-local-address');
  assert.equal(classifyAddress('::ffff:10.0.0.1'), 'private-address');
});

test('classifyAddress acepta direcciones públicas', () => {
  assert.equal(classifyAddress('93.184.216.34'), 'public');
  assert.equal(classifyAddress('2606:2800:220:1:248:1893:25c8:1946'), 'public');
});

test('classifyAddress rechaza basura', () => {
  assert.equal(classifyAddress('not-an-ip'), 'invalid-url');
  assert.equal(classifyAddress('999.999.999.999'), 'invalid-url');
});

test('validateExplorationUrl acepta un host público permitido', async () => {
  const result = await validateExplorationUrl('https://example.com/', publicScope, resolverFor({ 'example.com': ['93.184.216.34'] }));
  assert.equal(result.ok, true);
  assert.ok(result.url instanceof URL);
  assert.deepEqual(result.addresses, ['93.184.216.34']);
});

test('validateExplorationUrl rechaza protocolos no HTTP(S)', async () => {
  for (const url of ['ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi']) {
    const result = await validateExplorationUrl(url, publicScope, resolverFor({}));
    assert.equal(result.ok, false);
    assert.equal(result.issue, 'disallowed-protocol');
  }
});

test('validateExplorationUrl rechaza URL con credenciales', async () => {
  const result = await validateExplorationUrl('https://admin:secret@example.com/', publicScope, resolverFor({ 'example.com': ['93.184.216.34'] }));
  assert.equal(result.ok, false);
  assert.equal(result.issue, 'credentials-in-url');
});

test('validateExplorationUrl rechaza host IP literal (debe pasar por DNS)', async () => {
  for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://[::ffff:10.0.0.1]/']) {
    const result = await validateExplorationUrl(url, { allowedHosts: [] }, resolverFor({}));
    assert.equal(result.ok, false);
    assert.equal(result.issue, 'ip-literal');
  }
});

test('validateExplorationUrl rechaza host fuera del allowlist', async () => {
  const result = await validateExplorationUrl('https://evil.com/', publicScope, resolverFor({ 'evil.com': ['93.184.216.34'] }));
  assert.equal(result.ok, false);
  assert.equal(result.issue, 'host-not-in-allowlist');
});

test('validateExplorationUrl acepta subdominios del allowlist', async () => {
  const result = await validateExplorationUrl('https://app.example.com/', publicScope, resolverFor({ 'app.example.com': ['93.184.216.34'] }));
  assert.equal(result.ok, true);
});

test('validateExplorationUrl bloquea DNS rebinding a dirección privada', async () => {
  const result = await validateExplorationUrl('https://example.com/', publicScope, resolverFor({ 'example.com': ['10.0.0.5'] }));
  assert.equal(result.ok, false);
  assert.equal(result.issue, 'private-address');
});

test('validateExplorationUrl bloquea cuando CUALQUIERA de las IPs devueltas es privada', async () => {
  const result = await validateExplorationUrl('https://example.com/', publicScope, resolverFor({ 'example.com': ['93.184.216.34', '127.0.0.1'] }));
  assert.equal(result.ok, false);
  assert.equal(result.issue, 'loopback-address');
});

test('validateExplorationUrl bloquea DNS rebinding a metadata de nube', async () => {
  const result = await validateExplorationUrl('https://example.com/', publicScope, resolverFor({ 'example.com': ['169.254.169.254'] }));
  assert.equal(result.ok, false);
  assert.equal(result.issue, 'link-local-address');
});

test('validateExplorationUrl bloquea cuando la IPv6 resuelta es loopback', async () => {
  const result = await validateExplorationUrl('https://example.com/', publicScope, resolverFor({ 'example.com': ['::1'] }));
  assert.equal(result.ok, false);
  assert.equal(result.issue, 'loopback-address');
});

test('validateExplorationUrl reporta fallo de DNS', async () => {
  const result = await validateExplorationUrl('https://example.com/', publicScope, resolverFor({}));
  assert.equal(result.ok, false);
  assert.equal(result.issue, 'dns-failure');
});

test('validateExplorationUrl respeta allowedPaths', async () => {
  const scope = { allowedHosts: ['example.com'], allowedPaths: ['/app'] };
  const ok = await validateExplorationUrl('https://example.com/app/login', scope, resolverFor({ 'example.com': ['93.184.216.34'] }));
  assert.equal(ok.ok, true);
  const blocked = await validateExplorationUrl('https://example.com/admin', scope, resolverFor({ 'example.com': ['93.184.216.34'] }));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.issue, 'path-not-allowed');
});

test('validateExplorationUrl respeta excludedPaths con precedencia', async () => {
  const scope = { allowedHosts: ['example.com'], allowedPaths: ['/'], excludedPaths: ['/admin'] };
  const result = await validateExplorationUrl('https://example.com/admin/dashboard', scope, resolverFor({ 'example.com': ['93.184.216.34'] }));
  assert.equal(result.ok, false);
  assert.equal(result.issue, 'path-excluded');
});

test('validateExplorationUrl rechaza URL inválida', async () => {
  const result = await validateExplorationUrl('http//:not-a-url', publicScope, resolverFor({}));
  assert.equal(result.ok, false);
  assert.equal(result.issue, 'invalid-url');
});
