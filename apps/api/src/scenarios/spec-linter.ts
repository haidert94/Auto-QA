// Capa 3a del pipeline: linter determinista sobre el resultado del agente.
// Son reglas puras (sin LLM) que atrapan patrones que CodeQL marcaría
// después y que son más baratas de prevenir aquí que arreglar en producción.
// Separa severidad:
//   - error: bloquea el guardado del spec y fuerza el fallback.
//   - warn: se propaga al usuario como notice; el spec se guarda igual.

import type { GeneratorStep } from './playwright-generator';

export type LintIssue = { code: string; message: string; severity: 'error' | 'warn' };

const EXTERNAL_URL = /\b(?:https?:)?\/\/[^\s"'`]+/i;
const SECRET_LITERAL = /\b(?:password|passwd|contrase(?:ñ|n)a|token|secret|api[_ -]?key|pin)\s*[:=]\s*['"][^'"\s]+['"]/i;
const DEBUG_API = /\b(?:console\.(?:log|debug|info|warn|error)|debugger\b|eval\s*\()/;
const FORBIDDEN_WAIT = /\bpage\.waitForTimeout\s*\(/;

export function lintPreparedSteps(steps: GeneratorStep[]): LintIssue[] {
  const issues: LintIssue[] = [];
  if (!steps.length) {
    issues.push({ code: 'empty', severity: 'error', message: 'El agente no devolvió acciones.' });
    return issues;
  }
  const kinds = steps.map(step => step.action.split(':', 1)[0]);
  const hasAssertion = kinds.some(kind => kind.startsWith('expect-'));
  if (!hasAssertion) issues.push({ code: 'no-assertion', severity: 'error', message: 'La automatización no incluye aserciones.' });

  // Cada operación de navegación o verificación de URL debe ser relativa.
  for (const step of steps) {
    const [kind, ...rest] = step.action.split(':');
    const target = rest.join(':').trim();
    if ((kind === 'navigate' || kind === 'expect-url' || kind === 'expect-http-ok') && EXTERNAL_URL.test(target)) {
      issues.push({
        code: 'absolute-url',
        severity: 'error',
        message: `El paso ${step.ordinal} usa una URL absoluta (${target.slice(0, 80)}). Debe ser relativa a la raíz del proyecto.`,
      });
    }
    if (typeof step.data === 'string' && /\b(?:password|contrase(?:ñ|n)a|token|secret)\b/i.test(target)
      && step.data.length < 4) {
      issues.push({
        code: 'weak-secret-input',
        severity: 'warn',
        message: `El paso ${step.ordinal} llena un campo sensible con un valor de ${step.data.length} caracteres. Verifica que sea un dato de prueba.`,
      });
    }
  }
  return issues;
}

export function lintGeneratedCode(code: string, hasAssertions = code.includes('expect(')): LintIssue[] {
  const issues: LintIssue[] = [];
  if (!hasAssertions) {
    issues.push({ code: 'no-expect', severity: 'error', message: 'El código generado no contiene aserciones expect(.' });
  }
  if (DEBUG_API.test(code)) {
    issues.push({ code: 'debug-left', severity: 'warn', message: 'Hay sentencias de depuración (console.log / debugger / eval) en el spec.' });
  }
  if (SECRET_LITERAL.test(code)) {
    issues.push({ code: 'hardcoded-secret', severity: 'error', message: 'El spec contiene un valor literal que parece credencial. Usa variables de entorno.' });
  }
  if (FORBIDDEN_WAIT.test(code)) {
    issues.push({ code: 'wait-for-timeout', severity: 'warn', message: 'Evita page.waitForTimeout(): usa aserciones que esperan a que la UI esté lista.' });
  }
  // URLs externas solo se permiten como identificadores de rol o aria,
  // nunca como destino de navegación. Detectamos page.goto("http...") y
  // similares.
  if (/\bpage\.(?:goto|request\.fetch)\s*\(\s*['"]https?:/i.test(code)) {
    issues.push({ code: 'external-navigation', severity: 'error', message: 'El spec intenta navegar a una URL absoluta. Usa rutas relativas.' });
  }
  return issues;
}

export function summarizeIssues(issues: LintIssue[]): string | undefined {
  if (!issues.length) return undefined;
  return issues.map(issue => `${issue.severity === 'error' ? '⛔' : '⚠'} ${issue.message}`).join(' · ');
}

export function hasBlockingIssue(issues: LintIssue[]): boolean {
  return issues.some(issue => issue.severity === 'error');
}
