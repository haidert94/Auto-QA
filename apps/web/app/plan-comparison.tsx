import Link from 'next/link';
import { ArrowRight, ChevronDown } from 'lucide-react';
import type { CapabilityAvailability, Plan, PlanCapability } from './autoqa-server';
import { browserMinutesLimit } from '../../api/src/commerce/browser-minutes';

const numeric = new Intl.NumberFormat('es-CO');
const browserNames: Record<string, string> = { CHROMIUM: 'Chromium', FIREFOX: 'Firefox', WEBKIT: 'WebKit' };
const statuses: Record<CapabilityAvailability, string> = {
  OPERATIONAL: 'Operativa', BETA: 'Beta', UPCOMING: 'Próximamente', NOT_INCLUDED: 'Sin incluir',
};

function browserLimitText(planCode: string, capability?: PlanCapability) {
  const limit = browserMinutesLimit(planCode, capability);
  return limit === null ? 'Sin límite' : numeric.format(limit);
}

export function CapabilityStatus({ value }: { value: CapabilityAvailability }) {
  return <span className={'capability-status ' + (value === 'OPERATIONAL' ? 'available' : 'roadmap')}>{statuses[value]}</span>;
}

function detail(capability: PlanCapability) {
  if (capability.availability === 'NOT_INCLUDED') return '';
  if (capability.code === 'HTTP_MONITORS') {
    const interval = capability.minIntervalMinutes;
    return numeric.format(capability.monitorLimit ?? 0) + (interval === 1 ? ' cada minuto' : ' cada ' + interval + ' minutos');
  }
  if (capability.code === 'BROWSER_TESTS') {
    return [capability.detail, capability.browsers.map(browser => browserNames[browser] ?? browser).join(', ')].filter(Boolean).join(' · ');
  }
  if (capability.code === 'PERFORMANCE_TESTS') {
    const perRun = [
      capability.maxVirtualUsers !== null ? 'hasta ' + capability.maxVirtualUsers + ' usuarios virtuales' : '',
      capability.maxDurationMinutes !== null ? capability.maxDurationMinutes + ' min por ejecución' : '',
    ].filter(Boolean).join(' · ');
    const monthly = capability.monthlyLimit ? numeric.format(capability.monthlyLimit) + ' ejecuciones al mes' : 'Cuota mensual por acordar';
    return [capability.detail, perRun, monthly].filter(Boolean).join(' · ');
  }
  return capability.detail ?? '';
}

const cardRows = new Set([
  'FUNCTIONAL_TESTS', 'API_TESTS', 'BROWSER_TESTS', 'RESPONSIVE_TESTS',
  'HTTP_MONITORS', 'FLOW_MONITORS', 'PERFORMANCE_TESTS',
]);

export function PlanCards({ plans, accountOrigin }: { plans: Plan[]; accountOrigin: string }) {
  return (
    <div className="plan-grid">
      {plans.map(plan => {
        const browser = plan.capabilities.find(item => item.code === 'BROWSER_TESTS');
        return (
          <article className={'plan-card' + (plan.code === 'pro' ? ' plan-emphasis' : '')} key={plan.code}>
            <div className="plan-name"><h3>{plan.name}</h3></div>
            <p className="plan-price"><strong>{'$' + numeric.format(plan.priceCop)}</strong><span>COP/mes</span></p>
            <ul className="plan-capabilities">
              {plan.capabilities.filter(capability => cardRows.has(capability.code) && capability.availability !== 'NOT_INCLUDED').map(capability => {
                const summary = detail(capability);
                return (
                  <li key={capability.code}>
                    <div><strong>{capability.label}</strong>{summary && <small>{summary}</small>}</div>
                    <CapabilityStatus value={capability.availability}/>
                  </li>
                );
              })}
            </ul>
            <dl className="plan-capacity">
              <div><dt>Aplicaciones</dt><dd>{plan.maxProjects}</dd></div>
              <div><dt>Roles por aplicación</dt><dd>{plan.maxRoles}</dd></div>
              <div><dt>Minutos de navegador/mes</dt><dd>{browserLimitText(plan.code, browser)}</dd></div>
              <div><dt>Ejecuciones simultáneas</dt><dd>{plan.parallelRuns}</dd></div>
            </dl>
            <Link className={'button ' + (plan.code === 'pro' ? 'primary' : 'outline')}
              href={accountOrigin + '/registro?plan=' + plan.code}>Elegir {plan.name}<ArrowRight size={16} aria-hidden="true"/></Link>
          </article>
        );
      })}
    </div>
  );
}

export function PlanComparison({ plans }: { plans: Plan[] }) {
  const capabilities = [...new Map(plans.flatMap(plan => plan.capabilities).map(row => [row.code, row])).values()]
    .sort((a, b) => a.position - b.position);
  return (
    <details className="compare" open>
      <summary><span>Comparar planes</span><ChevronDown size={18} aria-hidden="true"/></summary>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Comparación de planes">
        <table>
          <thead><tr><th scope="col">Capacidad</th>{plans.map(plan => <th scope="col" key={plan.code} data-plan={plan.code}>{plan.name}</th>)}</tr></thead>
          <tbody>
            {capabilities.map(row => (
              <tr key={row.code}>
                <th scope="row">{row.label}</th>
                {plans.map(plan => {
                  const capability = plan.capabilities.find(item => item.code === row.code);
                  const summary = capability ? detail(capability) : '';
                  return <td key={plan.code}>
                    {summary && <span className="comparison-detail">{summary}</span>}
                    <CapabilityStatus value={capability?.availability ?? 'NOT_INCLUDED'}/>
                  </td>;
                })}
              </tr>
            ))}
            <tr><th scope="row">Minutos de navegador al mes</th>{plans.map(plan => {
              const browser = plan.capabilities.find(item => item.code === 'BROWSER_TESTS');
              return <td key={plan.code}>
                <span className="comparison-detail">{browserLimitText(plan.code, browser)}</span>
                <CapabilityStatus value={browser?.availability ?? 'NOT_INCLUDED'}/>
              </td>;
            })}</tr>
            <tr><th scope="row">Ejecuciones simultáneas</th>{plans.map(plan => <td key={plan.code}>
              <span className="comparison-detail">{plan.parallelRuns}</span><CapabilityStatus value={plan.runAvailability}/>
            </td>)}</tr>
            <tr><th scope="row">Aplicaciones</th>{plans.map(plan => <td key={plan.code}>{plan.maxProjects}</td>)}</tr>
            <tr><th scope="row">Roles por aplicación</th>{plans.map(plan => <td key={plan.code}>{plan.maxRoles}</td>)}</tr>
          </tbody>
        </table>
      </div>
    </details>
  );
}
