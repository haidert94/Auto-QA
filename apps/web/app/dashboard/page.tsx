import Link from 'next/link';
import { accountFetch, requireAccount } from '../autoqa-server';
import { environmentTypes, statusLabels, type ProjectSummary } from '../projects/onboarding';

export const dynamic = 'force-dynamic';

type Usage = {
  month: string;
  projects: { used: number; limit: number };
  runs: { active: number; simultaneousLimit: number; completed: number; availability: string };
  browser: { secondsUsed: number; minutesLimit: number; availability: string };
  monitors: { active: number; limit: number; availability: string };
};

export default async function Dashboard() {
  const account = await requireAccount();

  const [projectsRes, usageRes, aiBudgetRes] = await Promise.all([
    accountFetch('/projects').catch(() => null),
    accountFetch('/commerce/usage').catch(() => null),
    accountFetch('/ai/budget').catch(() => null),
  ]);
  const projects: ProjectSummary[] = projectsRes?.ok ? await projectsRes.json() : [];
  const usage: Usage | null = usageRes?.ok ? await usageRes.json() : null;
  const aiBudget: { aiTokensUsed: number; aiTokensLimit: number; aiCostCop: number; remainingTokens: number } | null =
    aiBudgetRes?.ok ? await aiBudgetRes.json() : null;

  const readyProjects = projects.filter(p => p.status === 'READY');
  const draftProjects = projects.filter(p => p.status === 'DRAFT');

  const nextSteps = buildNextSteps(account, projects);

  return <>
    <section className="dashboard-hero panel">
      <div>
        <p className="muted">{account.organization.name}</p>
        <h1>Hola, {account.name?.split(' ')[0] ?? account.email}</h1>
        <p className="muted">
          Plan actual: <strong>{account.subscription.plan?.name ?? 'sin plan'}</strong>
          {' · '}Estado: <strong>{account.subscription.status}</strong>
        </p>
      </div>
      <div className="dashboard-cta">
        <Link href="/onboarding" className="button-like primary">Registrar aplicación</Link>
        <Link href="/projects" className="button-like secondary">Ver proyectos</Link>
      </div>
    </section>

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
            <Link href={`/projects/${p.id}/automate`} className="button-like primary">Automatizar</Link>
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
            <div><dt>Segundos de navegador</dt><dd>{usage.browser.secondsUsed} / {usage.browser.minutesLimit ? usage.browser.minutesLimit * 60 : '∞'}</dd></div>
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

      {aiBudget && aiBudget.aiTokensLimit > 0 && <article className="panel">
        <h2>Créditos IA del mes</h2>
        <dl className="dashboard-metrics">
          <div><dt>Tokens usados</dt><dd>{aiBudget.aiTokensUsed.toLocaleString('es-CO')}</dd></div>
          <div><dt>Límite</dt><dd>{aiBudget.aiTokensLimit.toLocaleString('es-CO')}</dd></div>
          <div><dt>Costo acumulado</dt><dd>{aiBudget.aiCostCop.toLocaleString('es-CO')} COP</dd></div>
        </dl>
        <div className="signal-bar">
          <div className="signal-bar-fill" style={{ width: `${Math.min(100, Math.round(100 * aiBudget.aiTokensUsed / aiBudget.aiTokensLimit))}%` }} />
        </div>
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
