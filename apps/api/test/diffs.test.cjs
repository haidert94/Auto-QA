const assert = require('node:assert/strict');
const { test } = require('node:test');

const { diffResults, diffExplorations, diffText } = require('../dist/common/diffs');

test('diffResults omite scenarios sin cambios', () => {
  const diffs = diffResults(
    [{ scenarioId: 's1', status: 'PASSED', durationMs: 100 }],
    [{ scenarioId: 's1', status: 'PASSED', durationMs: 100 }],
  );
  assert.equal(diffs.length, 0);
});

test('diffResults marca cambios de estado y duración', () => {
  const diffs = diffResults(
    [{ scenarioId: 's1', status: 'PASSED', durationMs: 100 }],
    [{ scenarioId: 's1', status: 'FAILED', durationMs: 180 }],
  );
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].from, 'PASSED');
  assert.equal(diffs[0].to, 'FAILED');
  assert.equal(diffs[0].durationFromMs, 100);
  assert.equal(diffs[0].durationToMs, 180);
});

test('diffResults muestra nulos para scenarios añadidos o removidos', () => {
  const diffs = diffResults(
    [{ scenarioId: 's1', status: 'PASSED', durationMs: 50 }],
    [{ scenarioId: 's2', status: 'FAILED', durationMs: 60 }],
  );
  const s1 = diffs.find(d => d.scenarioId === 's1');
  const s2 = diffs.find(d => d.scenarioId === 's2');
  assert.equal(s1.from, 'PASSED');
  assert.equal(s1.to, null);
  assert.equal(s2.from, null);
  assert.equal(s2.to, 'FAILED');
});

test('diffExplorations clasifica añadidas, removidas y cambios de status', () => {
  const diff = diffExplorations(
    [
      { url: 'https://a.com/', httpStatus: 200 },
      { url: 'https://a.com/old', httpStatus: 200 },
      { url: 'https://a.com/flaky', httpStatus: 500 },
    ],
    [
      { url: 'https://a.com/', httpStatus: 200 },
      { url: 'https://a.com/new', httpStatus: 200 },
      { url: 'https://a.com/flaky', httpStatus: 200 },
    ],
  );
  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0].url, 'https://a.com/new');
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.removed[0].url, 'https://a.com/old');
  assert.equal(diff.statusChanged.length, 1);
  assert.equal(diff.statusChanged[0].url, 'https://a.com/flaky');
  assert.equal(diff.statusChanged[0].from, 500);
  assert.equal(diff.statusChanged[0].to, 200);
});

test('diffText: igual texto no marca cambios', () => {
  const diff = diffText('abc\ndef', 'abc\ndef');
  assert.equal(diff.changed, false);
  assert.equal(diff.addedLines, 0);
  assert.equal(diff.removedLines, 0);
});

test('diffText: detecta líneas añadidas y removidas', () => {
  const diff = diffText('a\nb\nc', 'a\nX\nc');
  assert.equal(diff.changed, true);
  assert.equal(diff.addedLines, 1);
  assert.equal(diff.removedLines, 1);
});

test('diffText: null y string vacío son equivalentes', () => {
  assert.equal(diffText(null, '').changed, false);
  assert.equal(diffText('', null).changed, false);
});
