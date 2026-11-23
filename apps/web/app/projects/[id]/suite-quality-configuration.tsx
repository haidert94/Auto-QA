import { environmentTypes, scenarioRunEnvironmentError, type Project } from '../onboarding';
import type { ScenarioListItem } from './scenario-card';

export function SuiteQualityConfiguration({ project, scenarios }: { project: Project; scenarios: ScenarioListItem[] }) {
  return <details className="suite-quality-settings">
    <summary>Configuración de las pruebas de calidad</summary>
    <ul>{scenarios.map(({ id, title, quality }) => {
      if (!quality) return null;
      const config = quality.executionConfig;
      const environment = project.environments.find(item => item.id === config?.environmentId);
      const environmentLabel = environment?.type ? environmentTypes[environment.type] : 'Entorno';
      const fields = [
        { label: 'Entorno', value: environment ? environmentLabel : 'Sin entorno asociado' },
        { label: 'URL objetivo', value: config?.url ?? 'Sin URL válida' },
        ...(config?.parameters ?? []),
      ];
      return <li key={id}>
        <h4>{title}</h4>
        <dl>{fields.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {(!environment || scenarioRunEnvironmentError(environment)) && <p>Requiere un entorno autorizado.</p>}
      </li>;
    })}</ul>
  </details>;
}
