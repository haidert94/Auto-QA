import { accountFetch, requireAccount } from '../../autoqa-server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { type Project } from '../onboarding';
import { AutomationPanel } from './automation-panel';
import { DataTab } from './data-tab';
import { ExecutionReport } from './execution-report';
import { ExplorationPanel, type Environment as PanelEnvironment } from './exploration-panel';
import { type IpaSummary } from './ipa-hero';
import { ProjectTabs } from './project-tabs';
import { ProjectHeading } from './project-heading';
import { ScenariosPanel } from './scenarios-panel';

export const dynamic = 'force-dynamic';

function hasBrowserTests(account: Awaited<ReturnType<typeof requireAccount>>) {
  const capability = account.subscription.plan?.capabilities.find(c => c.code === 'BROWSER_TESTS');
  return !!capability && capability.availability !== 'NOT_INCLUDED';
}

export default async function ProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let response: Response | undefined;
  try {
    response = await accountFetch('/projects/' + encodeURIComponent(id));
  } catch {
    // The error view also covers a non-404 response from an unavailable API.
  }
  if (response?.status === 404 || response?.status === 400) notFound();
  if (!response?.ok) {
    return (
      <section className="panel">
        <p><Link href="/projects">Volver a proyectos</Link></p>
        <p className="error" role="alert">No se pudo cargar el proyecto. Comprueba que la API esté ejecutándose.</p>
      </section>
    );
  }
  const project: Project = await response.json();

  let showExploration = true;
  try {
    const account = await requireAccount();
    showExploration = hasBrowserTests(account);
  } catch { showExploration = false; }

  const readOnlyEnvs: PanelEnvironment[] = project.environments
    .filter(env => env.authorizationConfirmed)
    .map(env => ({ id: env.id, type: env.type, baseUrl: env.baseUrl }));

  // IPA estructural: solo se fetchea cuando el proyecto ya está READY, para
  // mostrarlo junto al resumen. Si falla, DataTab indica la indisponibilidad
  // sin atribuir una puntuación al proyecto.
  let ipa: IpaSummary | null = null;
  if (project.status === 'READY') {
    try {
      const ipaResponse = await accountFetch(`/projects/${project.id}/ipa`);
      if (ipaResponse.ok) ipa = (await ipaResponse.json()).ipa;
    } catch {}
  }

  return (
    <div className="project-detail">
    <ProjectTabs heading={<ProjectHeading project={project} />} showExploration={showExploration} context={
      <span className="project-environment-context"><i aria-hidden="true" />{project.environments.length} {project.environments.length === 1 ? 'entorno' : 'entornos'} registrados</span>
    }>
      {{
        datos: <DataTab project={project} ipa={ipa} />,
        escenarios: <ScenariosPanel key={project.id} project={project} />,
        automatizacion: <AutomationPanel key={project.id} project={project} />,
        reporte: <ExecutionReport key={project.id} project={project} />,
        calidad: (
          <section className="panel">
            <h2>Calidad</h2>
            <p className="muted">
              IPA mide la preparación del proyecto; ICSP mide la salud del producto.
              El reporte consolida ambos con trazabilidad requisito → escenario → resultado.
            </p>
            <p>
              <Link href={`/projects/${project.id}/ipa`}>Ver IPA →</Link>{' · '}
              <Link href={`/projects/${project.id}/icsp`}>Ver ICSP →</Link>{' · '}
              <Link href={`/projects/${project.id}/performance`}>Performance →</Link>{' · '}
              <Link href={`/projects/${project.id}/load`}>Carga (k6) →</Link>{' · '}
              <Link href={`/projects/${project.id}/monitors`}>Monitores →</Link>{' · '}
              <Link href={`/projects/${project.id}/report`}>Reporte consolidado →</Link>
            </p>
          </section>
        ),
        exploracion: showExploration
          ? <ExplorationPanel projectId={project.id} environments={readOnlyEnvs} />
          : undefined,
      }}
    </ProjectTabs>
    </div>
  );
}
