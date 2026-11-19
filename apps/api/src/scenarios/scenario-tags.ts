export const MANUAL_SCENARIO_TAG = '@manual';
export const MANUAL_SCENARIO_MESSAGE = 'Este escenario requiere ejecución manual.';

export function isManualScenario(scenario: { tags?: readonly string[] | null }): boolean {
  return scenario.tags?.includes(MANUAL_SCENARIO_TAG) ?? false;
}
