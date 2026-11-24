import { appendFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';

const { AUTOQA_VALIDATION_ID: id, AUTOQA_VALIDATION_URL: base, AUTOQA_VALIDATION_SECRET: secret,
  GITHUB_RUN_ID: run, GITHUB_STEP_SUMMARY: summary } = process.env;
const states = new Set(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED']);
const categories = { passed: 'Aprobadas', failed: 'Fallidas', blocked: 'Bloqueadas', skipped: 'Omitidas', pending: 'Pendientes' };

async function main() {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id) || !/^\d{1,20}$/.test(run ?? '') || !secret || secret.length < 32 || !base) {
    throw new Error('Configura la URL, el secreto y el identificador de validación.');
  }
  const origin = new URL(base);
  if (origin.protocol !== 'https:' || origin.username || origin.password) throw new Error('La URL de AutoQA debe usar HTTPS.');
  const endpoint = new URL(`/api/automation-validations/${id}/advance`, origin);
  const deadline = Date.now() + 23 * 60 * 1000;
  let previous = null;

  while (Date.now() < deadline) {
    const response = await fetch(endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: 'Bearer ' + secret, 'X-AutoQA-GitHub-Run': run },
    }).catch(() => null);
    if (!response || response.status >= 500 || response.status === 429) {
      await wait(6000);
      continue;
    }
    if (!response.ok) throw new Error(`AutoQA rechazó la validación (HTTP ${response.status}).`);

    const result = await response.json();
    const counts = Object.keys(categories).map(key => result.counts?.[key]);
    const total = counts.reduce((sum, count) => sum + count, 0);
    if (result.id !== id || !states.has(result.status) || !/^[0-9a-f]{64}$/.test(result.version)
      || !counts.every(count => Number.isInteger(count) && count >= 0) || total < 1 || total > 20) {
      throw new Error('AutoQA devolvió un resultado de validación inválido.');
    }

    const line = Object.entries(categories).map(([key, label]) => `${label} ${result.counts[key]}`).join(' · ');
    if (line !== previous) console.log(line);
    previous = line;
    if (result.status === 'QUEUED' || result.status === 'RUNNING') {
      await wait(4000);
      continue;
    }
    if (summary) await appendFile(summary, `## Validación de automatización\n\nVersión: \`${result.version}\`\n\n${line}\n`);
    if (result.status !== 'COMPLETED' || result.counts.passed !== total) {
      throw new Error('La validación terminó con escenarios sin aprobar. Consulta Calidad y Reportes en AutoQA.');
    }
    return;
  }
  throw new Error('El workflow agotó el tiempo de espera de la validación.');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
