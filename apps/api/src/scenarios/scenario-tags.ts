export const COMPATIBILITY_SCENARIO_TAG = '@compatibilidad';
export const COMPATIBILITY_SCENARIO_TAGS = [COMPATIBILITY_SCENARIO_TAG, '@compatibility'] as const;

export const MANUAL_SCENARIO_TAG = '@manual';
export const MANUAL_SCENARIO_MESSAGE = 'Este escenario requiere ejecución manual.';

export function isManualScenario(scenario: { tags?: readonly string[] | null }): boolean {
  return scenario.tags?.includes(MANUAL_SCENARIO_TAG) ?? false;
}
