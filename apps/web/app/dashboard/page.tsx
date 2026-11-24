import Link from 'next/link';
import { accountFetch, requireAccount, type Usage } from '../autoqa-server';
import type { ProjectSummary } from '../projects/onboarding';
import { AppPageHeading } from '../app-page-heading';
import { can } from '../permissions';

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

  // Clasificación operativa por ciclo de vida de pruebas:
  //   Borrador: sin runs completados todavía (incluye DRAFT de onboarding).
  //   En proceso: al menos un run completado pero sin snapshot ICSP guardado.
  //   Listos: hay al menos un snapshot ICSP (versión congelada en el historial).
  const readyProjects = projects.filter(p => (p.icspSnapshots ?? 0) > 0);
  const inProgressProjects = projects.filter(p => (p.completedRuns ?? 0) > 0 && (p.icspSnapshots ?? 0) === 0);
  const draftProjects = projects.filter(p => (p.completedRuns ?? 0) === 0 && (p.icspSnapshots ?? 0) === 0);

  const nextSteps = buildNextSteps(account, projects);

  return <>
    <AppPageHeading
      crumbs={[{ label: account.organization.name }, { label: 'Resumen' }]}
      title={`Hola, ${account.name?.split(' ')[0] ?? account.email}`}
      badge={{ label: `Plan ${account.subscription.plan?.name ?? 'sin plan'} · ${account.subscription.status}`, tone: account.subscription.status === 'ACTIVE' ? 'ready' : 'draft' }}
      summary="Estado general de tu cuenta, proyectos activos y uso del plan."
      actions={<>
        {can(account.role, 'project.create') && <Link href="/onboarding" className="button-like">Registrar aplicación</Link>}
        <Link href="/projects" className="secondary button-like">Ver proyectos</Link>
      </>}
    />

    {projects.length > 0 && <section className="app-section">
      <header><h2><span>01 //</span> AUTOMATIZA UN PROYECTO CON IA</h2></header>
      <p className="muted">
        Sube la documentación de uno de tus proyectos y la IA te devuelve el diagnóstico IPA,
        las historias detectadas y los casos de prueba sugeridos según tu plan.
      </p>
      <ul className="dashboard-projects">
        {projects.slice(0, 3).map(p => <li key={p.id}>
          <div className="dashboard-project-head">
            <span className="dashboard-project-title">{p.name}</span>
            {p.status === 'READY'
              ? <Link href={`/projects/${p.id}#datos`} className="button-like secondary">Abrir proyecto →</Link>
              : <Link href={`/projects/${p.id}/automate`} className="button-like secondary">Iniciar wizard →</Link>}
          </div>
        </li>)}
      </ul>
    </section>}

    {nextSteps.length > 0 && <section className="app-section">
      <header><h2><span>02 //</span> PRÓXIMOS PASOS</h2></header>
      <ol className="dashboard-steps">
        {nextSteps.map((step, i) => <li key={i}>
          <strong>{step.title}</strong>
          <p className="muted">{step.description}</p>
          <Link href={step.href}>{step.cta} →</Link>
        </li>)}
      </ol>
    </section>}

    <section className="app-section">
      <header><h2><span>03 //</span> USO DEL MES</h2>
        <Link href="/billing" className="app-section__link">Ver facturación completa →</Link></header>
      {!usage
        ? <p className="muted">No se pudo cargar el consumo.</p>
        : <dl className="dashboard-metrics">
          <div><dt>Proyectos</dt><dd>{usage.projects.used} / {usage.projects.limit || '∞'}</dd></div>
          <div><dt>Ejecuciones</dt><dd>{usage.runs.completed} completadas · {usage.runs.active} activas</dd></div>
          <div><dt>Segundos de navegador</dt><dd>{usage.browser.secondsUsed} / {usage.browser.minutesLimit === null ? 'Sin límite mensual' : usage.browser.minutesLimit * 60}</dd></div>
          <div><dt>Monitores</dt><dd>{usage.monitors.active} / {usage.monitors.limit || '∞'}</dd></div>
        </dl>}
    </section>

    <section className="app-section">
      <header><h2><span>04 //</span> RESUMEN DE PROYECTOS</h2></header>
      <dl className="dashboard-metrics dashboard-metrics--clickable">
        <Link href="/projects?status=all"><dt>Total</dt><dd>{projects.length}</dd></Link>
        <Link href="/projects?status=ready"><dt>Listos</dt><dd>{readyProjects.length}</dd></Link>
        <Link href="/projects?status=in-progress"><dt>En proceso</dt><dd>{inProgressProjects.length}</dd></Link>
        <Link href="/projects?status=draft"><dt>Borrador</dt><dd>{draftProjects.length}</dd></Link>
      </dl>
    </section>

    {exploration && <section className="app-section">
      <header><h2><span>05 //</span> EXPLORACIÓN DEL MES</h2></header>
      <p className="muted">
        Cuando no tienes documentación suficiente, el agente de Exploración entra al entorno
        autorizado, recorre sus módulos y registra las URLs y evidencias que encuentra.
      </p>
      <dl className="dashboard-metrics">
        <div><dt>Completadas</dt><dd>{exploration.completed.toLocaleString('es-CO')}</dd></div>
        <div><dt>En curso</dt><dd>{(exploration.running + exploration.queued).toLocaleString('es-CO')}</dd></div>
        <div><dt>Páginas descubiertas</dt><dd>{exploration.pagesFound.toLocaleString('es-CO')}</dd></div>
        {exploration.failed > 0 && <div><dt>Con errores</dt><dd>{exploration.failed.toLocaleString('es-CO')}</dd></div>}
      </dl>
    </section>}

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
  if (projects.length === 0 && can(account.role, 'project.create')) {
    steps.push({
      title: 'Registra tu primera aplicación',
      description: 'Declara el proyecto, el entorno autorizado y los dominios y rutas incluidas en el alcance.',
      cta: 'Registrar aplicación', href: '/onboarding',
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
