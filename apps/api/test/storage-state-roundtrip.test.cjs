// e2e lógico: el blob que subió el QA debe sobrevivir cifrado → persistencia
// → descifrado por el worker, íntegro. Si este test falla, un run usaría una
// sesión corrupta y los tests vencerían por login aunque el QA haya subido
// el auth.json "correcto".
//
// No toca Postgres: prisma es un mock que recuerda la última Env escrita. Lo
// que sí es real: el cifrado AES-GCM (SecretCipher) y el pipeline del
// servicio (parseStorageState + encrypt + persist + decrypt).

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes } = require('node:crypto');

process.env.AUTOQA_SECRET_KEY = randomBytes(32).toString('hex');

const { ProjectsService } = require('../dist/projects/projects.service');
const { SecretCipher } = require('../dist/commerce/secret-cipher');

const projectId = '00000000-0000-4000-8000-000000000001';
const environmentId = '00000000-0000-4000-8000-000000000002';
const workspace = { organizationId: null, userId: 'user-1', role: 'ADMIN' };

const sampleState = {
  cookies: [
    { name: 'session', value: 'abc123', domain: 'app.test', path: '/' },
    { name: 'csrf', value: 'xyz', domain: 'app.test', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ],
  origins: [
    { origin: 'https://app.test', localStorage: [
      { name: 'token', value: 'jwt.payload.signature' },
      { name: 'preferences', value: '{"theme":"dark"}' },
    ] },
  ],
};

function mockPrisma() {
  let persisted = {
    storageStateCipher: null,
    storageStateLabel: null,
    storageStateUploadedAt: null,
    storageStateExpiresAt: null,
  };
  return {
    state: persisted,
    environment: {
      async findFirst({ where }) {
        if (where.id !== environmentId) return null;
        if (where.project?.id !== projectId) return null;
        return { id: environmentId };
      },
      async update({ where, data }) {
        if (where.id !== environmentId) throw new Error('env-no-encontrado');
        persisted.storageStateCipher = data.storageStateCipher;
        persisted.storageStateLabel = data.storageStateLabel;
        persisted.storageStateUploadedAt = data.storageStateUploadedAt;
        persisted.storageStateExpiresAt = data.storageStateExpiresAt;
        return { id: environmentId };
      },
    },
  };
}

test('e2e: upload cifra, persiste y los metadatos son recuperables; blob descifrado es idéntico al original', async () => {
  const prisma = mockPrisma();
  const cipher = new SecretCipher();
  const service = new ProjectsService(prisma, cipher);

  const expiresIso = new Date(Date.now() + 86400000).toISOString();
  const summary = await service.setStorageState(
    projectId, environmentId,
    { storageState: sampleState, label: 'QA admin', expiresAt: expiresIso },
    workspace,
  );

  // Metadata retornada al cliente — nunca el blob.
  assert.equal(summary.label, 'QA admin');
  assert.equal(summary.cookiesCount, 2);
  assert.equal(summary.originsCount, 1);
  assert.equal(summary.expiresAt, expiresIso);
  assert.equal('storageState' in summary, false, 'el blob jamás vuelve al cliente');
  assert.equal('cookies' in summary, false);

  // Columna cifrada no filtra el blob en texto plano.
  const cipherBlob = prisma.state.storageStateCipher;
  assert.ok(cipherBlob && typeof cipherBlob === 'string', 'cipher persistido');
  assert.equal(cipherBlob.includes('session'), false, 'el ciphertext no deja ver los nombres de cookies');
  assert.equal(cipherBlob.includes('abc123'), false, 'el ciphertext no deja ver los valores');

  // Lo que el worker haría: descifrar con SecretCipher del mismo secret.
  const decrypted = JSON.parse(cipher.decrypt(cipherBlob));
  assert.deepEqual(decrypted, sampleState, 'round-trip idéntico');
});

test('e2e: clear limpia los cuatro campos sin tocar nada más', async () => {
  const prisma = mockPrisma();
  const service = new ProjectsService(prisma, new SecretCipher());
  // Prime: subir algo primero
  await service.setStorageState(projectId, environmentId,
    { storageState: sampleState, label: 'x', expiresAt: null }, workspace);
  assert.ok(prisma.state.storageStateCipher);

  const result = await service.clearStorageState(projectId, environmentId, workspace);
  assert.deepEqual(result, { removed: true });
  assert.equal(prisma.state.storageStateCipher, null);
  assert.equal(prisma.state.storageStateLabel, null);
  assert.equal(prisma.state.storageStateUploadedAt, null);
  assert.equal(prisma.state.storageStateExpiresAt, null);
});

test('e2e: expiresAt en el pasado o inválido se rechaza antes de persistir', async () => {
  const prisma = mockPrisma();
  const service = new ProjectsService(prisma, new SecretCipher());

  await assert.rejects(
    service.setStorageState(projectId, environmentId,
      { storageState: sampleState, expiresAt: '2020-01-01T00:00:00Z' }, workspace),
    /expiresAt-en-el-pasado/,
  );
  await assert.rejects(
    service.setStorageState(projectId, environmentId,
      { storageState: sampleState, expiresAt: 'no-es-fecha' }, workspace),
    /expiresAt-invalido/,
  );
  // Nada quedó persistido tras los dos rechazos.
  assert.equal(prisma.state.storageStateCipher, null);
});

test('e2e: un entorno de OTRO proyecto es 404, no leak', async () => {
  const prisma = mockPrisma();
  const service = new ProjectsService(prisma, new SecretCipher());
  // Project distinto del que el mock espera.
  await assert.rejects(
    service.setStorageState('99999999-9999-4999-8999-999999999999', environmentId,
      { storageState: sampleState }, workspace),
    /no encontrado/i,
  );
  assert.equal(prisma.state.storageStateCipher, null, 'nada se persistió para el entorno ajeno');
});

test('e2e: blob malformado (cookies no-array) se rechaza sin tocar la columna', async () => {
  const prisma = mockPrisma();
  const service = new ProjectsService(prisma, new SecretCipher());
  await assert.rejects(
    service.setStorageState(projectId, environmentId,
      { storageState: { cookies: 'no-array', origins: [] } }, workspace),
    /cookies-no-es-array/,
  );
  assert.equal(prisma.state.storageStateCipher, null);
});

test('e2e: dos cifrados consecutivos del mismo blob dan cipher DISTINTOS (IV random)', async () => {
  const prisma1 = mockPrisma();
  const prisma2 = mockPrisma();
  const cipher = new SecretCipher();
  const service1 = new ProjectsService(prisma1, cipher);
  const service2 = new ProjectsService(prisma2, cipher);
  await service1.setStorageState(projectId, environmentId, { storageState: sampleState }, workspace);
  await service2.setStorageState(projectId, environmentId, { storageState: sampleState }, workspace);
  assert.notEqual(prisma1.state.storageStateCipher, prisma2.state.storageStateCipher,
    'IV aleatorio por llamada impide que dos cifrados del mismo input coincidan');
});
