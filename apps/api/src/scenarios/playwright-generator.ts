// Convierte un TestScenario en un spec de @playwright/test en TypeScript.
// Mecanico, sin IA: reconoce un vocabulario pequeno de prefijos en el campo
// "action" y emite la llamada Playwright correspondiente. Lo que no case se
// traduce a un `// TODO:` con el texto original para que el autor lo
// complete antes de correr la prueba.
//
// Seguridad: todo string interpolado se escapa como literal JS para evitar
// inyeccion de codigo. Nunca pegamos texto crudo del usuario en el spec.

export type GeneratorStep = {
  ordinal: number;
  action: string;
  data?: string | null;
  expected?: string | null;
};

export type GeneratorScenario = {
  id: string;
  title: string;
  expectedResult?: string | null;
  steps: GeneratorStep[];
};

// Escape conservador para literales de string con comillas simples.
// Cubre backslash, comillas simples, newlines/tabs/retornos y los separadores
// Unicode U+2028/U+2029 (que romperian un literal de string JS).
const LINE_SEPARATOR = new RegExp('[\\u2028\\u2029]', 'g');
export function escapeJsString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(LINE_SEPARATOR, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

// Particion simple: toma un prefijo "<verbo>:" y devuelve { verb, rest }.
function splitAction(raw: string): { verb: string; rest: string } | null {
  const idx = raw.indexOf(':');
  if (idx < 0) return null;
  const verb = raw.slice(0, idx).trim().toLowerCase();
  const rest = raw.slice(idx + 1).trim();
  if (!verb || !rest) return null;
  return { verb, rest };
}

function commentLines(text: string, indent: string): string[] {
  return text.split(/\r?\n/).map(line => indent + '// ' + line);
}

export function generateStepLines(step: GeneratorStep, indent: string): string[] {
  const lines: string[] = [];
  lines.push(`${indent}// Paso ${step.ordinal}: ${step.action.split(/\r?\n/)[0]}`);
  if (step.expected && step.expected.trim()) {
    lines.push(...commentLines('Esperado: ' + step.expected.trim(), indent));
  }

  const parsed = splitAction(step.action);
  if (!parsed) {
    lines.push(`${indent}// TODO: ${step.action}`);
    return lines;
  }

  const { verb, rest } = parsed;
  switch (verb) {
    case 'navigate':
    case 'goto':
    case 'open':
      lines.push(`${indent}await page.goto('${escapeJsString(rest)}');`);
      break;
    case 'click':
      lines.push(`${indent}await page.locator('${escapeJsString(rest)}').click();`);
      break;
    case 'fill':
      lines.push(`${indent}await page.locator('${escapeJsString(rest)}').fill('${escapeJsString(step.data ?? '')}');`);
      break;
    case 'press':
    case 'key':
      lines.push(`${indent}await page.keyboard.press('${escapeJsString(rest)}');`);
      break;
    case 'expect-text':
    case 'expect text':
      lines.push(`${indent}await expect(page.getByText('${escapeJsString(rest)}')).toBeVisible();`);
      break;
    case 'expect-url':
    case 'expect url':
      lines.push(`${indent}await expect(page).toHaveURL('${escapeJsString(rest)}');`);
      break;
    default:
      lines.push(`${indent}// TODO (verbo "${verb}" no reconocido): ${step.action}`);
  }
  return lines;
}

export function generateSpec(scenario: GeneratorScenario): string {
  const title = escapeJsString(scenario.title);
  const lines: string[] = [];
  lines.push("import { expect, test } from '@playwright/test';");
  lines.push('');
  lines.push(`// Escenario AutoQA ${scenario.id}`);
  if (scenario.expectedResult && scenario.expectedResult.trim()) {
    lines.push(...commentLines('Resultado esperado: ' + scenario.expectedResult.trim(), ''));
  }
  lines.push('');
  lines.push(`test('${title}', async ({ page }) => {`);
  if (scenario.steps.length === 0) {
    lines.push('  // TODO: define los pasos del escenario en AutoQA.');
  } else {
    for (const step of scenario.steps) {
      lines.push(...generateStepLines(step, '  '));
      lines.push('');
    }
    if (scenario.expectedResult && scenario.expectedResult.trim()) {
      lines.push('  // Validacion final sugerida (completar si aplica):');
      lines.push(`  // await expect(page.getByText('${escapeJsString(scenario.expectedResult.trim())}')).toBeVisible();`);
    }
  }
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

export function suggestedFilename(scenario: Pick<GeneratorScenario, 'title' | 'id'>): string {
  const slug = scenario.title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || scenario.id.slice(0, 8);
  return slug + '.spec.ts';
}
