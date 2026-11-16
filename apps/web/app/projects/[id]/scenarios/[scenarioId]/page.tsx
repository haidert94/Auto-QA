import Link from 'next/link';
import { notFound } from 'next/navigation';
import { accountFetch } from '../../../../autoqa-server';
import { ScenarioEditor, type RequirementOption, type Scenario } from './scenario-editor';

export const dynamic = 'force-dynamic';

export default async function ScenarioDetailPage({ params }: { params: Promise<{ id: string; scenarioId: string }> }) {
  const { id, scenarioId } = await params;

  let scenarioResponse: Response | undefined;
  let requirementsResponse: Response | undefined;
  try {
    [scenarioResponse, requirementsResponse] = await Promise.all([
      accountFetch(`/projects/${id}/scenarios/${scenarioId}`),
      accountFetch(`/projects/${id}/scenarios/requirements`),
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
  const requirements: RequirementOption[] = requirementsResponse?.ok ? await requirementsResponse.json() : [];

  return <section className="panel">
    <p><Link href={`/projects/${id}`}>← Volver al proyecto</Link></p>
    <h1>Editar escenario</h1>
    <ScenarioEditor initial={{ ...scenario, projectId: id }} requirements={requirements} />
  </section>;
}
