import Link from 'next/link';
import { notFound } from 'next/navigation';
import { defaultScenarioBrowser } from '../../../../../../api/src/scenarios/playwright-generator';
import { accountFetch, requireAccount, type OrgRole } from '../../../../autoqa-server';
import { RunsPanel, type EnvironmentOption } from './runs-panel';
import { scenarioRunEnvironmentError } from '../../../onboarding';
import { isManualScenario } from '../../scenario-presentation';
import type { ScenarioStepSource } from '../../scenario-steps-editor';
import { ScenarioEditor, type RequirementOption, type Scenario } from './scenario-editor';

export const dynamic = 'force-dynamic';

type ProjectForRuns = {
  id: string;
  environments: Array<{
    id: string; type?: string | null; baseUrl?: string | null;
    authorizationConfirmed?: boolean; readOnly?: boolean; authorizedAt?: string | null;
  }>;
};

export default async function ScenarioDetailPage({ params }: { params: Promise<{ id: string; scenarioId: string }> }) {
  const { id, scenarioId } = await params;

  let scenarioResponse: Response | undefined;
  let requirementsResponse: Response | undefined;
  let projectResponse: Response | undefined;
  let scenariosResponse: Response | undefined;
  try {
    [scenarioResponse, requirementsResponse, projectResponse, scenariosResponse] = await Promise.all([
      accountFetch(`/projects/${id}/scenarios/${scenarioId}`),
      accountFetch(`/projects/${id}/scenarios/requirements`),
      accountFetch(`/projects/${id}`),
      accountFetch(`/projects/${id}/scenarios`).catch(() => undefined),
    ]);
  } catch {}

  if (scenarioResponse?.status === 404) notFound();
  if (!scenarioResponse?.ok) {
    return <section className="panel">
      <p><Link href={`/projects/${id}`}>← Volver al proyecto</Link></p>
      <p className="error" role="alert">No se pudo cargar el escenario.</p>
    </section>;
  }
  const scenario: Scenario = await scenarioResponse.json();
  const scenariosPayload: unknown = scenariosResponse?.ok ? await scenariosResponse.json().catch(() => null) : null;
  const scenarios = Array.isArray(scenariosPayload)
    ? (scenariosPayload as ScenarioStepSource[]).map(({ title, steps }) => ({ title, steps }))
    : null;
  const requirements: RequirementOption[] = requirementsResponse?.ok ? await requirementsResponse.json() : [];
  const project: ProjectForRuns | null = projectResponse?.ok ? await projectResponse.json() : null;
  const environments: EnvironmentOption[] = (project?.environments ?? [])
    .filter(env => !scenarioRunEnvironmentError(env))
    .map(env => ({
      id: env.id, type: env.type ?? null, baseUrl: env.baseUrl ?? null,
      readOnly: env.readOnly !== false, authorizedAt: env.authorizedAt ?? null,
    }));

  let role: OrgRole = 'VIEWER';
  try { role = (await requireAccount()).role; } catch {}

  return <section className="panel">
    <p><Link href={`/projects/${id}`}>← Volver al proyecto</Link></p>
    <h1>Editar escenario</h1>
    <ScenarioEditor initial={{ ...scenario, projectId: id }} requirements={requirements} scenarios={scenarios} role={role} />
    <RunsPanel projectId={id} scenarioId={scenario.id} environments={environments} role={role}
      manual={isManualScenario(scenario)} initialBrowser={defaultScenarioBrowser(scenario)} />
  </section>;
}
