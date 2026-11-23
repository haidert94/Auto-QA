import type { OrgRole } from '../../autoqa-server';
import { can } from '../../permissions';
import { scenarioRunEnvironmentError, type Project } from '../onboarding';
import type { ScenarioListItem } from './scenario-card';

export function qualityExecutionProblem(scenario: ScenarioListItem, project: Project, role?: OrgRole) {
  const quality = scenario.quality;
  if (!quality) return null;
  if (quality.kind === 'load' && !can(role, 'load.create')) return 'Tu rol no permite iniciar esta prueba.';
  if (!quality.automation.prepared) return 'Genera el código en Automatización.';
  if (quality.status.tone === 'pending') return 'Esta prueba ya está en cola o en ejecución.';
  const environment = project.environments.find(item => item.id === quality.executionConfig?.environmentId);
  if (!environment || scenarioRunEnvironmentError(environment) || !quality.executionConfig?.url) return 'Requiere un entorno y un destino autorizados.';
  if (quality.kind === 'lighthouse' && environment.readOnly === false) return 'Requiere un entorno de solo lectura.';
  return null;
}
