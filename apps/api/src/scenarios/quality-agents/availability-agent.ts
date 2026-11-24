import type { MonitorHttpCheck } from '../../monitors/monitor-http-check';
import { nodeTarget, QualityReviewRequired } from './agent-context';

export function prepareAvailability(url: URL, settings: MonitorHttpCheck & { timeoutMs: number; intervalMinutes: number }) {
  if (!Number.isInteger(settings.timeoutMs) || settings.timeoutMs < 1000 || settings.timeoutMs > 60000) {
    throw new QualityReviewRequired('Configura un tiempo de espera entre 1000 y 60000 ms para el monitor.');
  }
  if (!Number.isInteger(settings.intervalMinutes) || settings.intervalMinutes < 5 || settings.intervalMinutes > 1440) {
    throw new QualityReviewRequired('Configura un intervalo entre 5 y 1440 minutos para el monitor.');
  }
  const { method, minStatus, maxStatus } = settings;
  if ((method !== 'GET' && method !== 'HEAD') || !Number.isInteger(minStatus) || !Number.isInteger(maxStatus)
      || minStatus < 200 || maxStatus > 599 || minStatus > maxStatus) {
    throw new QualityReviewRequired('Define un método y un rango de códigos HTTP válidos.');
  }
  return [
    '// Comprobación individual del monitor configurado cada ' + settings.intervalMinutes + ' min.',
    ...nodeTarget(url),
    'const response = await fetch(target, {',
    '  method: ' + JSON.stringify(method) + ", redirect: 'manual', signal: AbortSignal.timeout(" + settings.timeoutMs + '),',
    '});',
    'await response.body?.cancel();',
    'console.log(\'HTTP \' + response.status);',
    'if (response.status < ' + minStatus + ' || response.status > ' + maxStatus + ') process.exitCode = 1;',
    '',
  ].join('\n');
}
