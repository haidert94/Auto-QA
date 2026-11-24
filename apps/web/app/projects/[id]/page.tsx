import { accountFetch, requireAccount, type OrgRole } from '../../autoqa-server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { type Project } from '../onboarding';
import { AutomationPanel } from './automation-panel';
import { DataTab } from './data-tab';
import { ExecutionReport } from './execution-report';
import { ExplorationPanel, type Environment as PanelEnvironment } from './exploration-panel';
import { IPA_AUTOMATION_THRESHOLD, type IpaSummary } from './ipa-hero';
import { ProjectTabs } from './project-tabs';
import { ScenariosPanel } from './scenarios-panel';
import { QualityPanel } from './quality-panel';
import { can } from '../../permissions';

export const dynamic = 'force-dynamic';

const historyDate = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

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

  let showExploration: boolean;
  let role: OrgRole = 'VIEWER';
  let canExplainFailures = false;
  try {
    const account = await requireAccount();
    showExploration = hasBrowserTests(account);
    role = account.role;
    canExplainFailures = can(role, 'run.explain') && !!account.subscription.plan?.capabilities.some(capability =>
      capability.code === 'AI_FAILURE_EXPLANATION' && ['OPERATIONAL', 'BETA'].includes(capability.availability));
  } catch { showExploration = false; }

  const readOnlyEnvs: PanelEnvironment[] = project.environments
    .filter(env => env.authorizationConfirmed && env.readOnly)
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
    <ProjectTabs key={project.id} project={project} role={role} showExploration={showExploration}
      showScheduleButton={ipa?.status === 'ASSESSED' && ipa.score >= IPA_AUTOMATION_THRESHOLD} context={
      <span className="project-environment-context"><i aria-hidden="true" />{project.environments.length} {project.environments.length === 1 ? 'entorno' : 'entornos'} registrados</span>
    }>
      {{
        datos: <DataTab project={project} ipa={ipa} role={role} />,
        escenarios: <ScenariosPanel key={project.id} project={project} role={role} />,
        automatizacion: <AutomationPanel key={project.id} project={project} role={role} />,
        reporte: <ExecutionReport key={project.id} project={project} canExplainFailures={canExplainFailures} />,
        historial: (
          <div className="project-overview">
            <section className="detail-card" aria-labelledby="project-finalized-versions-heading">
              <header className="detail-card__head"><h2 id="project-finalized-versions-heading">Versiones finalizadas</h2></header>
              <div className="detail-card__body">
                <p className="muted">Aún no hay versiones finalizadas registradas.</p>
              </div>
            </section>
            <section className="detail-card" aria-labelledby="project-logs-heading">
              <header className="detail-card__head"><h2 id="project-logs-heading">Logs</h2></header>
              <div className="detail-card__body">
                <dl className="detail-fields">
                  <div><dt>Creación del proyecto</dt>
                    <dd><time dateTime={project.createdAt}>{historyDate.format(new Date(project.createdAt))} UTC</time></dd></div>
                  {project.updatedAt !== project.createdAt && <div><dt>Última actualización</dt>
                    <dd><time dateTime={project.updatedAt}>{historyDate.format(new Date(project.updatedAt))} UTC</time></dd></div>}
                </dl>
              </div>
            </section>
          </div>
        ),
        calidad: <QualityPanel key={project.id} project={project} role={role} />,
        exploracion: showExploration
          ? <ExplorationPanel projectId={project.id} environments={readOnlyEnvs} project={project} role={role} />
          : undefined,
      }}
    </ProjectTabs>
    </div>
  );
}
