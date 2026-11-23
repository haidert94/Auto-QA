import { nodeTarget, QualityReviewRequired } from './agent-context';

export function prepareAvailability(url: URL, settings: { timeoutMs: number; intervalMinutes: number }) {
  if (!Number.isInteger(settings.timeoutMs) || settings.timeoutMs < 1000 || settings.timeoutMs > 60000) {
    throw new QualityReviewRequired('Configura un tiempo de espera entre 1000 y 60000 ms para el monitor.');
  }
  if (!Number.isInteger(settings.intervalMinutes) || settings.intervalMinutes < 5 || settings.intervalMinutes > 1440) {
    throw new QualityReviewRequired('Configura un intervalo entre 5 y 1440 minutos para el monitor.');
  }
  return [
    '// Comprobación individual del monitor configurado cada ' + settings.intervalMinutes + ' min.',
    ...nodeTarget(url),
    'const response = await fetch(target, {',
    "  method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(" + settings.timeoutMs + '),',
    '});',
    'await response.body?.cancel();',
    'console.log(\'HTTP \' + response.status);',
    'if (response.status < 200 || response.status >= 400) process.exitCode = 1;',
    '',
  ].join('\n');
}
