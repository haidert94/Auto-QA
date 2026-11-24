import { FRAME_LOCATOR_OPERATIONS, generateSharedSteps, generateSpec, readFramePath } from './playwright-generator';
import type { PreparedAutomation } from './automation-agent';
import { hasBlockingIssue, lintGeneratedCode, lintPreparedSteps } from './spec-linter';

export type FrameRepair = { step: number; frames: string[] };

export function readFrameRepair(raw: unknown): FrameRepair | null {
  if (!raw || typeof raw !== 'object') return null;
  const { step, frames } = raw as Partial<FrameRepair>;
  const path = readFramePath(frames);
  return typeof step === 'number' && Number.isInteger(step) && step >= 1 && step <= 100 && path
    ? { step, frames: path } : null;
}

export function proposeFrameRepair(scenarioId: string, automation: PreparedAutomation, repair: FrameRepair) {
  const index = automation.steps.findIndex(step => step.ordinal === repair.step);
  const target = automation.steps[index];
  if (!target || target.frames || !FRAME_LOCATOR_OPERATIONS.includes(target.action.split(':', 1)[0])) return null;

  // Solo cambia el contexto del localizador. El selector, los datos y las
  // aserciones se conservan exactamente como en la automatización ejecutada.
  const steps = automation.steps.map((step, position) => position === index ? { ...step, frames: repair.frames } : step);
  const spec = generateSpec({ id: scenarioId, title: automation.title, steps }, true);
  const issues = [
    ...lintPreparedSteps(steps),
    ...lintGeneratedCode(spec, steps.some(step => step.action.startsWith('expect-'))),
    ...lintGeneratedCode(generateSharedSteps(steps)),
  ];
  return hasBlockingIssue(issues) ? null : steps;
}
