import Link from 'next/link';
import { accountFetch, requireAccount, type Usage } from '../autoqa-server';
import { environmentTypes, statusLabels, type ProjectSummary } from '../projects/onboarding';
import { AppPageHeading } from '../app-page-heading';

export const dynamic = 'force-dynamic';

type DashboardUsage = Usage & {
  exploration?: { completed: number; running: number; queued: number; failed: number; pagesFound: number };
};

export default async function Dashboard() {
  const account = await requireAccount();

  const [projectsRes, usageRes] = await Promise.all([
    accountFetch('/projects').catch(() => null),
    accountFetch('/commerce/usage').catch(() => null),
  ]);
  const projectsPayload = projectsRes?.ok ? await projectsRes.json().catch(() => []) : [];
  const projects: ProjectSummary[] = Array.isArray(projectsPayload) ? projectsPayload : [];
  const usage: DashboardUsage | null = usageRes?.ok ? await usageRes.json() : null;
  const exploration = usage?.exploration;

  const readyProjects = projects.filter(p => p.status === 'READY');
  const draftProjects = projects.filter(p => p.status === 'DRAFT');

  const nextSteps = buildNextSteps(account, projects);

  return <>
    <AppPageHeading
      crumbs={[{ label: account.organization.name }, { label: 'Resumen' }]}
      title={`Hola, ${account.name?.split(' ')[0] ?? account.email}`}
      badge={{ label: `Plan ${account.subscription.plan?.name ?? 'sin plan'} · ${account.subscription.status}`, tone: account.subscription.status === 'ACTIVE' ? 'ready' : 'draft' }}
      summary="Estado general de tu cuenta, proyectos activos y uso del plan."
      actions={<>
        <Link href="/onboarding" className="button-like">Registrar aplicación</Link>
        <Link href="/projects" className="secondary button-like">Ver proyectos</Link>
      </>}
    />

    {projects.length > 0 && <section className="panel">
      <h2>Automatiza un proyecto con IA</h2>
      <p className="muted">
        Sube la documentación de uno de tus proyectos y la IA te devuelve el diagnóstico IPA,
        las historias detectadas y los casos de prueba sugeridos según tu plan.
      </p>
      <ul className="dashboard-projects">
        {projects.slice(0, 3).map(p => <li key={p.id}>
          <div className="dashboard-project-head">
            <span className="dashboard-project-title">{p.name}</span>
            <Link href={`/projects/${p.id}/automate`} className="button-like">Automatizar</Link>
          </div>
        </li>)}
      </ul>
    </section>}

    {nextSteps.length > 0 && <section className="panel">
      <h2>Próximos pasos</h2>
      <ol className="dashboard-steps">
        {nextSteps.map((step, i) => <li key={i}>
          <strong>{step.title}</strong>
          <p className="muted">{step.description}</p>
          <Link href={step.href}>{step.cta} →</Link>
        </li>)}
      </ol>
    </section>}

    <section className="dashboard-grid">
      <article className="panel">
        <h2>Uso del mes</h2>
        {!usage
          ? <p className="muted">No se pudo cargar el consumo.</p>
          : <dl className="dashboard-metrics">
            <div><dt>Proyectos</dt><dd>{usage.projects.used} / {usage.projects.limit || '∞'}</dd></div>
            <div><dt>Ejecuciones</dt><dd>{usage.runs.completed} completadas · {usage.runs.active} activas</dd></div>
            <div><dt>Segundos de navegador</dt><dd>{usage.browser.secondsUsed} / {usage.browser.minutesLimit === null ? 'Sin límite mensual' : usage.browser.minutesLimit * 60}</dd></div>
            <div><dt>Monitores</dt><dd>{usage.monitors.active} / {usage.monitors.limit || '∞'}</dd></div>
          </dl>}
        <p><Link href="/billing">Ver facturación completa →</Link></p>
      </article>

      <article className="panel">
        <h2>Resumen de proyectos</h2>
        <dl className="dashboard-metrics">
          <div><dt>Total</dt><dd>{projects.length}</dd></div>
          <div><dt>Listos</dt><dd>{readyProjects.length}</dd></div>
          <div><dt>En borrador</dt><dd>{draftProjects.length}</dd></div>
        </dl>
      </article>

      {exploration && <article className="panel">
        <h2>Exploración del mes</h2>
        <p className="muted"><small>
          Cuando no tienes documentación suficiente, el agente de Exploración entra al entorno
          autorizado, recorre sus módulos y registra las URLs y evidencias que encuentra.
        </small></p>
        <dl className="dashboard-metrics">
          <div><dt>Completadas</dt><dd>{exploration.completed.toLocaleString('es-CO')}</dd></div>
          <div><dt>En curso</dt><dd>{(exploration.running + exploration.queued).toLocaleString('es-CO')}</dd></div>
          <div><dt>Páginas descubiertas</dt><dd>{exploration.pagesFound.toLocaleString('es-CO')}</dd></div>
          {exploration.failed > 0 && <div><dt>Con errores</dt><dd>{exploration.failed.toLocaleString('es-CO')}</dd></div>}
        </dl>
      </article>}
    </section>

    <section className="panel">
      <h2>Proyectos recientes</h2>
      {projects.length === 0
        ? <p className="muted">Aún no has registrado aplicaciones. Empieza con <Link href="/onboarding">Registrar aplicación</Link>.</p>
        : <ul className="dashboard-projects">
          {projects.slice(0, 5).map(project => <li key={project.id}>
            <div className="dashboard-project-head">
              <Link href={`/projects/${project.id}`} className="dashboard-project-title">{project.name}</Link>
              <span className="muted">{statusLabels[project.status]}</span>
            </div>
            {project.environments.length > 0 && <ul className="dashboard-envs">
              {project.environments.slice(0, 3).map(env => <li key={env.id}>
                {env.type ? environmentTypes[env.type] : 'pendiente'} · {env.baseUrl ?? '—'}
              </li>)}
            </ul>}
            <div className="dashboard-project-links">
              <Link href={`/projects/${project.id}/ipa`}>IPA</Link>
              <Link href={`/projects/${project.id}/icsp`}>ICSP</Link>
              <Link href={`/projects/${project.id}/report`}>Reporte</Link>
            </div>
          </li>)}
        </ul>}
    </section>
  </>;
}

type Step = { title: string; description: string; cta: string; href: string };

function buildNextSteps(account: Awaited<ReturnType<typeof requireAccount>>, projects: ProjectSummary[]): Step[] {
  const steps: Step[] = [];
  if (!['ACTIVE', 'TRIALING'].includes(account.subscription.status)) {
    steps.push({
      title: 'Activa una suscripción',
      description: 'Tu suscripción está pendiente. Actívala para empezar a registrar proyectos.',
      cta: 'Ir a facturación', href: '/billing',
    });
  }
  if (projects.length === 0) {
    steps.push({
      title: 'Registra tu primera aplicación',
      description: 'Declara el proyecto, el entorno autorizado y los dominios y rutas incluidas en el alcance.',
      cta: 'Iniciar onboarding', href: '/onboarding',
    });
  } else {
    const anyWithoutAuthEnv = projects.some(p => p.environments.every(e => !e.authorizationConfirmed));
    if (anyWithoutAuthEnv) {
      const target = projects.find(p => p.environments.every(e => !e.authorizationConfirmed))!;
      steps.push({
        title: 'Autoriza un entorno',
        description: 'Confirma que estás autorizado a probar al menos un entorno de tu aplicación.',
        cta: 'Abrir proyecto', href: `/projects/${target.id}`,
      });
    }
    const anyDraft = projects.find(p => p.status === 'DRAFT');
    if (anyDraft) {
      steps.push({
        title: `Completa "${anyDraft.name}"`,
        description: 'Este proyecto está en borrador. Sube documentación y crea tu primer escenario.',
        cta: 'Abrir proyecto', href: `/projects/${anyDraft.id}`,
      });
    }
  }
  return steps.slice(0, 3);
}
