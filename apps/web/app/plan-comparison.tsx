import Link from 'next/link';
import { ArrowRight, ChevronDown } from 'lucide-react';
import type { CapabilityAvailability, Plan, PlanCapability } from './autoqa-server';

const numeric = new Intl.NumberFormat('es-CO');
const browserNames: Record<string, string> = { CHROMIUM: 'Chromium', FIREFOX: 'Firefox', WEBKIT: 'WebKit' };
const statuses: Record<CapabilityAvailability, string> = {
  OPERATIONAL: 'Operativa', BETA: 'Beta', UPCOMING: 'Próximamente', NOT_INCLUDED: 'Sin incluir',
};

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

const cardRows = new Set(['FUNCTIONAL_TESTS', 'API_TESTS', 'BROWSER_TESTS', 'HTTP_MONITORS', 'FLOW_MONITORS', 'PERFORMANCE_TESTS', 'IPA']);

export function PlanCards({ plans, accountOrigin }: { plans: Plan[]; accountOrigin: string }) {
  return (
    <div className="plan-grid">
      {plans.map(plan => (
        <article className={'plan-card' + (plan.code === 'pro' ? ' plan-emphasis' : '')} key={plan.code}>
          <div className="plan-name"><h3>{plan.name}</h3>{plan.code === 'pro' && <span>Más popular</span>}</div>
          <p className="plan-price"><strong>{'$' + numeric.format(plan.priceCop)}</strong> <span>COP/mes</span></p>
          <ul className="plan-capabilities">
            {plan.capabilities.filter(capability => cardRows.has(capability.code) && capability.availability !== 'NOT_INCLUDED').map(capability => (
              <li key={capability.code} className="plan-capability">
                <div><strong>{capability.label}</strong><CapabilityStatus value={capability.availability}/></div>
                {detail(capability) && <small>{detail(capability)}</small>}
              </li>
            ))}
          </ul>
          <p className="plan-capacity">{plan.maxProjects} {plan.maxProjects === 1 ? 'aplicación' : 'aplicaciones'} · {plan.maxRoles} roles por aplicación</p>
          <Link className={'button ' + (plan.code === 'pro' ? 'primary' : 'outline')}
            href={accountOrigin + '/registro?plan=' + plan.code}>Elegir plan<ArrowRight size={16}/></Link>
        </article>
      ))}
    </div>
  );
}

export function PlanComparison({ plans }: { plans: Plan[] }) {
  const capabilities = [...new Map(plans.flatMap(plan => plan.capabilities).map(row => [row.code, row])).values()]
    .sort((a, b) => a.position - b.position);
  return (
    <details className="compare" open>
      <summary><span>Comparar planes</span><ChevronDown size={18}/></summary>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Comparación de planes">
        <table>
          <thead><tr><th scope="col">Capacidad</th>{plans.map(plan => <th scope="col" key={plan.code}>{plan.name}</th>)}</tr></thead>
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
                <span className="comparison-detail">{numeric.format(browser?.monthlyLimit ?? 0)}</span>
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
