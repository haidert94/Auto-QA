'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { environmentTypes, type Environment } from '../onboarding';
import { EvaluationCard, Score } from '../../quality-evaluation-card';
import type { GeneratedCodeHealth } from '../../../../api/src/quality/generated-code-health';
import { dateText } from './run-report-data';

const labels = { passed: 'Aprobadas', failed: 'Fallidas', blocked: 'Bloqueadas', skipped: 'Omitidas', pending: 'Pendientes' } as const;
const outcomes = { passed: 'Aprobada', failed: 'Fallida', blocked: 'Bloqueada', skipped: 'Omitida', pending: 'Pendiente' } as const;
const validationLabels = { QUEUED: 'En cola', RUNNING: 'En curso', COMPLETED: 'Aprobada', FAILED: 'Con incidencias', CANCELED: 'Detenida' } as const;

type Outcome = keyof typeof labels;
type Validation = {
  id: string; createdAt: string; completedAt: string | null; status: keyof typeof validationLabels;
  version: string; environmentType: NonNullable<Environment['type']>; environmentId: string;
  reason: string | null; workflowUrl: string | null; currentVersion?: boolean;
  counts: Record<Outcome, number>;
  cases: { scenarioId: string; title: string; automationId: string; status: Outcome; reason: string | null }[];
};
type Catalog = {
  configured: boolean; ready: boolean; maxCases: number;
  environments: Array<Pick<Environment, 'id' | 'type' | 'baseUrl' | 'readOnly'>>;
  scenarios: Array<{ id: string; title: string }>;
  history: Validation[];
  codeHealth?: GeneratedCodeHealth;
  ciValidationId?: string | null;
};

function resultLabel(counts: Validation['counts']) {
  return (Object.keys(labels) as Outcome[]).filter(key => counts[key]).map(key => labels[key] + ' ' + counts[key]).join(' · ');
}

function inProgress(validation?: Validation) {
  return validation?.status === 'QUEUED' || validation?.status === 'RUNNING';
}

const toolLabels = {
  playwright: 'Playwright', availability: 'Disponibilidad', lighthouse: 'Lighthouse', load: 'k6', ux: 'UX',
};

function GeneratedCodeSummary({ health, ci }: { health: GeneratedCodeHealth; ci?: Validation }) {
  const selected = ci ? Object.values(ci.counts).reduce((total, count) => total + count, 0) : 0;
  return <>
    <div className="quality-score-summary">
      <Score label="Salud del código generado" value={health.score} />
      <div>
        <h3>Salud del código generado</h3>
        {health.analyzed ? <p>{health.clean} de {health.analyzed} automatizaciones revisadas sin hallazgos.</p>
          : <p>Genera código en Automatización para evaluarlo.</p>}
        {!!health.analyzed && <small>{health.errors} errores · {health.warnings} avisos</small>}
        {!!health.pending && <small>{health.pending} pendientes de revisión de código</small>}
        {ci && selected > 0
          ? <p>GitHub Actions · {Math.round(100 * ci.counts.passed / selected)}% de los casos Playwright seleccionados aprobados ({ci.counts.passed}/{selected}).</p>
          : <p>GitHub Actions · Sin resultados de Playwright para las versiones actuales.</p>}
      </div>
    </div>
    {health.findings.length > 0 && <details className="validation-selection">
      <summary>Ver hallazgos del código ({health.findings.length})</summary>
      <ul className="code-health-list">{health.findings.map(issue => <li className="code-health-item"
        key={issue.scenarioId + ':' + issue.code + ':' + issue.message}>
        <strong>{issue.title}</strong> · {toolLabels[issue.kind]} · {issue.severity === 'error' ? 'Error' : 'Aviso'}
        <small>{issue.message}</small>
      </li>)}</ul>
    </details>}
  </>;
}

function ValidationHistory({ history, projectId }: { history: Validation[]; projectId: string }) {
  if (!history.length) return <p className="muted">Aún no hay validaciones registradas.</p>;
  return <section className="validation-history" aria-label="Historial de validación de la automatización">
    <h3>Resultados por validación</h3>
    <ol className="validation-history-list">
      {history.map(item => <li key={item.id}>
        <div className="validation-history-heading">
          <strong>{validationLabels[item.status]}</strong>
          <time dateTime={item.completedAt ?? item.createdAt}>{dateText(item.completedAt ?? item.createdAt)}</time>
          <span>{environmentTypes[item.environmentType]} · <code title={item.version}>{item.version.slice(0, 10)}</code></span>
        </div>
        <div className="validation-bar" role="img" aria-label={resultLabel(item.counts)}>
          {(Object.keys(labels) as Outcome[]).filter(key => item.counts[key]).map(key =>
            <span className={`validation-segment validation-segment--${key}`} key={key} style={{ flexGrow: item.counts[key] }} />)}
        </div>
        <p>{resultLabel(item.counts)}</p>
        {item.currentVersion === false && <p className="muted">Validación de una versión anterior.</p>}
        {item.reason && <p className="muted">{item.reason}</p>}
        <details>
          <summary>Ver escenarios y versiones</summary>
          <ul>{item.cases.map(test => <li key={test.scenarioId}>
            <strong>{test.title}</strong> · {outcomes[test.status]} · <code title={test.automationId}>{test.automationId.slice(0, 8)}</code>
            {test.reason && <p className="muted">{test.reason}</p>}
          </li>)}</ul>
        </details>
        <div className="validation-links">
          {item.workflowUrl && <a href={item.workflowUrl} target="_blank" rel="noreferrer">Ver ejecución en GitHub ↗</a>}
          {!inProgress(item) && <Link href={`/projects/${projectId}#reporte`}>Ver Reportes →</Link>}
        </div>
      </li>)}
    </ol>
  </section>;
}

export function AutomationValidationCard({ active, projectId, canRun }: { active: boolean; projectId: string; canRun: boolean }) {
  const endpoint = `/api/projects/${projectId}/automation-validations`;
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [environmentId, setEnvironmentId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const latest = catalog?.history[0];
  const ci = catalog?.history.find(item => item.id === catalog.ciValidationId);
  const busy = inProgress(latest);
  const environment = catalog?.environments.find(env => env.id === environmentId);
  const scenarios = catalog?.scenarios ?? [];
  const selection = scenarios.filter(scenario => selected.includes(scenario.id));

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      try {
        const response = await fetch(endpoint, { cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
        if (!response.ok) throw new Error();
        const data: Catalog = await response.json();
        if (!Array.isArray(data.history) || !Array.isArray(data.environments) || !Array.isArray(data.scenarios)) throw new Error();
        if (controller.signal.aborted) return;
        setCatalog(data);
        setLoadError('');
        if (data.history.some(inProgress)) timer = setTimeout(load, 5000);
      } catch {
        if (!controller.signal.aborted) {
          setLoadError('No se pudo consultar la validación de la automatización.');
          timer = setTimeout(load, 10000);
        }
      }
    }

    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, endpoint, reload]);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (starting || busy || !catalog?.configured || !environment || !selection.length) return;
    setStarting(true);
    setMessage('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(18000),
        body: JSON.stringify({ environmentId, scenarioIds: selection.map(scenario => scenario.id) }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setMessage(typeof body?.message === 'string' ? body.message : 'No se pudo iniciar la validación.');
      } else {
        setMessage('Validación solicitada a GitHub Actions.');
      }
    } catch {
      setMessage('No se pudo confirmar el inicio. Consulta el historial de validaciones.');
    } finally {
      setStarting(false);
      setReload(value => value + 1);
    }
  }

  return <EvaluationCard index="04" title="Validación de la automatización"
    badge={latest ? validationLabels[latest.status] : 'GitHub Actions'}>
    <div className="quality-evaluation__body">
      {loadError && <p role="alert">{loadError}</p>}
      {!catalog && !loadError && <p role="status">Consultando validaciones…</p>}
      {catalog && <>
        {catalog.codeHealth && <GeneratedCodeSummary health={catalog.codeHealth} ci={ci} />}
        {!catalog.configured ? <p className="muted">La conexión con GitHub Actions está pendiente de configuración.</p>
          : !catalog.ready || !catalog.environments.length ? <p className="muted">Registra un entorno de pruebas autorizado para validar.</p>
          : !scenarios.length ? <p className="muted">Genera código Playwright en Automatización para poder validarlo.</p>
          : canRun && <form className="validation-form" onSubmit={start}>
            <label>Entorno de pruebas
              <select required value={environmentId} onChange={event => setEnvironmentId(event.target.value)} disabled={starting || busy}>
                <option value="">Selecciona un entorno</option>
                {catalog.environments.map(env => <option key={env.id} value={env.id}>
                  {env.type ? environmentTypes[env.type] : ''} · {env.baseUrl}
                </option>)}
              </select>
            </label>
            {environment?.readOnly === false && <p>La validación usará el modo autorizado de cambios con datos de prueba.</p>}
            <details className="validation-selection">
              <summary>Escenarios Playwright ({selection.length})</summary>
              <fieldset disabled={starting || busy}>
                <legend>Selecciona hasta {catalog.maxCases} escenarios</legend>
                {scenarios.map(({ id, title }) => <label key={id}>
                  <input type="checkbox" checked={selected.includes(id)}
                    disabled={!selected.includes(id) && selection.length >= catalog.maxCases}
                    onChange={event => {
                      const checked = event.target.checked;
                      setSelected(previous => checked ? [...previous, id] : previous.filter(value => value !== id));
                    }} />
                  {title}
                </label>)}
              </fieldset>
            </details>
            <button type="submit" disabled={starting || busy || !environment || !selection.length}>
              {starting ? 'Solicitando validación…' : 'Validar en GitHub Actions'}
            </button>
          </form>}
        {message && <p role="status">{message}</p>}
        <ValidationHistory history={catalog.history} projectId={projectId} />
      </>}
    </div>
  </EvaluationCard>;
}
