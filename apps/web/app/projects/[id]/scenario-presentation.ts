import { gherkinKeyword, type ScenarioListItem, type ScenarioStep } from './scenario-card';

const controlLabels = new Map(Object.entries({
  'user name': 'nombre de usuario',
  username: 'nombre de usuario',
  password: 'contraseña',
  'login button': 'Iniciar sesión',
  'sign in': 'Iniciar sesión',
  'first name': 'nombre',
  'last name': 'apellido',
  'postal code': 'código postal',
  'continue shopping': 'Seguir comprando',
  'back to products': 'Volver a productos',
}));

function controlLabel(selector: string) {
  const attribute = selector.match(/\[(?:aria-label|placeholder|title|data-testid|data-test|data-cy|id|name|type)\s*=\s*(?:"([^"]+)"|'([^']+)'|([\w-]+))\]/i);
  const simpleTarget = selector.match(/^[#.]?([\p{L}\p{N}][\p{L}\p{N}\s_-]*)$/u);
  const name = (attribute?.[1] ?? attribute?.[2] ?? attribute?.[3] ?? simpleTarget?.[1] ?? '')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return controlLabels.get(name.toLowerCase()) ?? name;
}

export function scenarioStepText(step: ScenarioStep) {
  const action = step.action.trim();
  const separator = action.indexOf(':');
  const target = separator === -1 ? '' : action.slice(separator + 1).trim();
  const command = target ? action.slice(0, separator).trim().toLowerCase() : '';
  const page = target === '/' ? 'la página de inicio' : `la página «${target}»`;
  switch (command) {
    case 'navigate':
    case 'goto':
    case 'open':
      return `Abre ${page}.`;
    case 'click': {
      const label = controlLabel(target);
      const product = label.match(/^add to cart (.+)$/i)?.[1];
      if (product) {
        const productName = product.replace(/\b[a-z]/gi, letter => letter.toUpperCase());
        return `Agrega «${productName}» al carrito.`;
      }
      return label ? `Pulsa «${label}».` : 'Pulsa el control indicado.';
    }
    case 'fill': {
      const label = controlLabel(target);
      const field = label ? `el campo «${label}»` : 'el campo indicado';
      if (!step.data) return `Deja vacío ${field}.`;
      const normalized = label.normalize('NFD').replace(/\p{M}/gu, '');
      if (/\b(password|passwd|pwd|contrasena)\b/i.test(normalized)) return 'Ingresa la contraseña.';
      if (/\b(token|secret|pin)\b/i.test(normalized)) return `Ingresa el dato confidencial en ${field}.`;
      return `Escribe «${step.data}» en ${field}.`;
    }
    case 'press':
    case 'key':
      return `Presiona la tecla «${target}».`;
    case 'expect-text':
    case 'expect text':
      return `Comprueba que aparece «${target}» en la página.`;
    case 'expect-url':
    case 'expect url':
      return `Comprueba que se abrió ${page}.`;
    default:
      return step.data ? `${action} · Usa «${step.data}».` : action;
  }
}


export type ScenarioRun = {
  id: string; scenarioId: string | null; status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED';
  createdAt: string; completedAt?: string | null;
  results: { status: 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED'; durationMs: number | null }[];
};

export function runPresentation(run: ScenarioRun | undefined, available: boolean) {
  if (!available) return { label: 'Estado no disponible', tone: 'unknown', duration: null };
  if (!run) return { label: 'Sin ejecuciones', tone: 'unknown', duration: null };
  const results = run.results ?? [];
  const durations = results.map(result => result.durationMs).filter((value): value is number => value !== null);
  const duration = durations.length ? durations.reduce((sum, value) => sum + value, 0) : null;
  if (run.status === 'QUEUED') return { label: 'En cola', tone: 'pending', duration };
  if (run.status === 'RUNNING') return { label: 'En curso', tone: 'pending', duration };
  if (run.status === 'CANCELED') return { label: 'Cancelada', tone: 'unknown', duration };
  if (run.status === 'FAILED' || results.some(result => result.status === 'FAILED')) return { label: 'Falló', tone: 'failed', duration };
  if (results.some(result => result.status === 'BLOCKED')) return { label: 'Bloqueada', tone: 'pending', duration };
  if (results.some(result => result.status === 'SKIPPED')) return { label: 'Con omisiones', tone: 'unknown', duration };
  if (results.length && results.every(result => result.status === 'PASSED')) return { label: 'Pasó', tone: 'passed', duration };
  return { label: 'Sin resultado', tone: 'unknown', duration };
}

export function durationLabel(duration: number | null) {
  return duration === null ? '' : duration < 1000 ? `${duration} ms` : `${(duration / 1000).toFixed(1)} s`;
}

const line = (value: string) => value.replace(/[\r\n\u2028\u2029]+/g, ' ').trim();
export function featureText(projectName: string, scenarios: ScenarioListItem[]) {
  return ['# language: es', '# Vista derivada de los pasos guardados. Revisar las palabras clave inferidas antes de usar.',
    `Característica: ${line(projectName)}`, '',
    ...scenarios.flatMap(scenario => [
      `  # ID: ${scenario.id}`,
      ...(scenario.requirement ? [`  # Requisito: ${line(scenario.requirement.externalKey ?? scenario.requirement.title)}`] : []),
      ...(scenario.tags?.length ? [`  ${scenario.tags.map(line).join(' ')}`] : []),
      `  Escenario: ${line(scenario.title)}`,
      ...(scenario.steps ?? []).flatMap((step, i) => [
        `    ${gherkinKeyword(step, scenario.steps?.[i - 1])} ${line(step.action)}`,
        ...(step.data ? [`      # Dato registrado: ${line(step.data)}`] : []),
        ...(step.expected ? [`      # Esperado registrado: ${line(step.expected)}`] : []),
      ]),
      ...(scenario.expectedResult ? [`    # Resultado esperado registrado: ${line(scenario.expectedResult)}`] : []), '',
    ]),
  ].join('\n');
}
