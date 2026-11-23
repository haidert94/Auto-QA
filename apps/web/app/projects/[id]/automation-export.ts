import type { ScenarioListItem } from './scenario-card';

export type GeneratedSpec = {
  scenarioId: string; title: string; filename: string; code: string; signature: string;
  review: string[]; error?: string; automationId?: string | null; notice?: string;
};

export function scenarioSpecSignature(scenario: ScenarioListItem) {
  return JSON.stringify([scenario.title, scenario.expectedResult, scenario.steps]);
}

export function specFilename(filename: string, id: string) {
  const leaf = filename.split(/[\\/]/).at(-1) ?? '';
  const safe = leaf.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^\.+/, '').slice(0, 150);
  return safe.endsWith('.spec.ts') && safe.length > 8 ? safe : `${id.replace(/[^a-zA-Z0-9_-]/g, '')}.spec.ts`;
}

export function specPath(spec: Pick<GeneratedSpec, 'filename' | 'scenarioId'>) {
  return `tests/${spec.scenarioId.replace(/[^a-zA-Z0-9_-]/g, '')}-${specFilename(spec.filename, spec.scenarioId)}`;
}
