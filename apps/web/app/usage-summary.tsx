import { accountFetch, type Usage } from './autoqa-server';
import { CapabilityStatus } from './plan-comparison';

const number = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });

export async function UsageSummary() {
  let usage: Usage;
  try {
    const response = await accountFetch('/commerce/usage');
    if (!response.ok) throw new Error();
    usage = await response.json();
  } catch {
    return <p role="status">El consumo del plan no está disponible en este momento.</p>;
  }
  const { projects, roles, browser, runs, monitors, performance } = usage;
  return (
    <section className="usage-summary" aria-labelledby="usage-title">
      <h2 id="usage-title">Consumo del plan</h2>
      <p className="muted">Mes calendario UTC · <time dateTime={usage.month}>{usage.month}</time></p>
      <dl>
        <div><dt>Aplicaciones</dt><dd>{projects.used} / {projects.limit}</dd></div>
        <div><dt>Roles por aplicación</dt><dd>Límite {roles.limit}</dd></div>
        <div><dt>Minutos de navegador usados</dt><dd>{number.format(browser.secondsUsed / 60)}</dd></div>
        <div><dt>Minutos de navegador reservados</dt><dd>{number.format(browser.secondsReserved / 60)}</dd></div>
        <div><dt>Límite mensual de navegador</dt><dd>{browser.minutesLimit === null ? 'Sin límite' : number.format(browser.minutesLimit)}
          <CapabilityStatus value={browser.availability}/></dd></div>
        <div><dt>Ejecuciones simultáneas</dt><dd>{runs.active} / {runs.simultaneousLimit}<CapabilityStatus value={runs.availability}/></dd></div>
        <div><dt>Ejecuciones del mes completadas</dt><dd>{runs.completed}</dd></div>
        <div><dt>Monitores HTTP activos</dt><dd>{monitors.active} / {monitors.limit}<CapabilityStatus value={monitors.availability}/></dd></div>
        <div><dt>Ejecuciones de performance del mes</dt><dd>{performance.used} / {performance.limit}<CapabilityStatus value={performance.availability}/></dd></div>
      </dl>
      {performance.previousPending > 0 && <p>Reservas de performance de meses anteriores · {performance.previousPending}</p>}
      {roles.projects.length > 0 && <details><summary>Roles usados por aplicación</summary><ul>
        {roles.projects.map(project => <li key={project.id}>{project.name} · {project.used} / {roles.limit}</li>)}
      </ul></details>}
    </section>
  );
}
