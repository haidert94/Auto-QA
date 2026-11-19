const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { runTestRun } = require('../dist/explorer/src/execution-runner');

const claim = {
  id: 'execution', projectId: 'project', scenarioId: 'scenario', environmentId: 'qa',
  runKey: 'run-test', targetBrowser: null, targetDevice: null, targetProvider: 'LOCAL',
};

function fixture() {
  const run = { status: 'RUNNING', errorCode: null };
  const events = [];
  const prisma = {
    testRun: {
      async findUnique() { return { ...run }; },
      async update({ where, data }) {
        assert.deepEqual(where, { id: claim.id });
        Object.assign(run, data);
        events.push('status');
      },
    },
    testScenario: { async findUnique() {
      return { id: claim.scenarioId, title: 'Ejemplo', steps: [{ ordinal: 1, action: 'expect-text: Ejemplo' }], tags: [] };
    } },
    environment: { async findUnique() {
      return { baseUrl: 'https://qa.example.test/', type: 'QA', readOnly: true, authorizationConfirmed: true };
    } },
    project: { async findUnique() { return { organizationId: 'organization' }; } },
    testResult: { async create() { assert.fail('Una ejecución cancelada no produce resultado de la prueba.'); } },
    meteredRun: { async updateMany({ where, data }) {
      assert.deepEqual(where, { projectId: 'project', organizationId: 'organization', runKey: claim.runKey, completedAt: null });
      assert.ok(data.completedAt instanceof Date);
      events.push('quota');
    } },
    async $queryRaw() { return run.status === 'RUNNING' ? [{ errorCode: run.errorCode }] : []; },
    async $transaction(callback) { return callback(prisma); },
  };
  return { prisma, run, events };
}

test('Explorer interrumpe el proceso de Playwright antes de registrar la cancelación y liberar el cupo', { timeout: 5000 }, async t => {
  const { prisma, run, events } = fixture();
  const child = new EventEmitter();
  child.pid = 12345;
  child.stdout = { resume() {} };
  child.stderr = new EventEmitter();
  const stop = () => {
    events.push('terminated');
    queueMicrotask(() => child.emit('close', null));
  };
  t.mock.method(childProcess, 'spawn', () => {
    events.push('spawned');
    run.errorCode = 'cancel-requested';
    return child;
  });
  if (process.platform === 'win32') {
    t.mock.method(childProcess, 'execFile', (file, args, options, callback) => {
      assert.equal(file, 'taskkill.exe');
      assert.deepEqual(args, ['/PID', '12345', '/T', '/F']);
      stop();
      callback(null);
    });
  } else {
    t.mock.method(process, 'kill', (pid, signal) => {
      assert.equal(pid, -12345);
      assert.equal(signal, 'SIGTERM');
      stop();
    });
  }
  await runTestRun(prisma, claim, {});
  assert.equal(run.status, 'CANCELED');
  assert.equal(run.errorCode, 'canceled-by-user');
  assert.deepEqual(events, ['spawned', 'terminated', 'status', 'quota']);
});

test('Explorer confirma una solicitud anterior al arranque sin lanzar Playwright', async t => {
  const { prisma, run, events } = fixture();
  run.errorCode = 'cancel-requested';
  const spawn = t.mock.method(childProcess, 'spawn', () => assert.fail('La prueba ya fue cancelada.'));
  await runTestRun(prisma, claim, {});
  assert.equal(spawn.mock.callCount(), 0);
  assert.equal(run.status, 'CANCELED');
  assert.deepEqual(events, ['status', 'quota']);
});
