import { notFound } from 'next/navigation';
import { accountFetch, requireAccount, type OrgRole } from '../../../autoqa-server';
import { AppPageHeading } from '../../../app-page-heading';
import { PerformancePanel } from './performance-panel';

type Environment = { id: string; type: string | null; baseUrl: string | null; authorizationConfirmed?: boolean; readOnly?: boolean };

export const dynamic = 'force-dynamic';

export default async function PerformancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let project: Response | undefined;
  try { project = await accountFetch(`/projects/${id}`); } catch {}
  if (project?.status === 404) notFound();
  if (!project?.ok) {
    return <>
      <AppPageHeading
        crumbs={[{ href: `/projects/${id}#calidad`, label: 'Calidad' }, { label: 'Performance' }]}
        title="Performance · Lighthouse"
        summary="No se pudo cargar el proyecto."
      />
      <section className="app-section"><p className="error" role="alert">No se pudo cargar el proyecto.</p></section>
    </>;
  }
  const data = await project.json();
  const envs: Environment[] = (data.environments ?? [])
    .filter((e: Environment) => e.authorizationConfirmed && e.readOnly !== false);

  let role: OrgRole = 'VIEWER';
  try { role = (await requireAccount()).role; } catch {}

  return <>
    <AppPageHeading
      crumbs={[{ href: `/projects/${id}#calidad`, label: 'Calidad' }, { label: 'Performance' }]}
      title="Performance · Lighthouse"
      badge={{ label: `${envs.length} entorno${envs.length === 1 ? '' : 's'} elegible${envs.length === 1 ? '' : 's'}`, tone: envs.length > 0 ? 'ready' : 'draft' }}
      summary="Lanza auditorías Lighthouse contra URLs autorizadas en modo solo lectura y revisa su histórico."
    />
    <section className="app-section">
      <header><h2><span>01 //</span> AUDITORÍAS</h2></header>
      <PerformancePanel projectId={id} environments={envs.map(e => ({ id: e.id, type: e.type, baseUrl: e.baseUrl }))} role={role} />
    </section>
  </>;
}
