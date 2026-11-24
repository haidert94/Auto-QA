import { useRef, useState } from 'react';
import { environmentTypes, scenarioRunEnvironmentError, type Project } from '../onboarding';
import { defaultMonitorHttpCheck } from '../../../../api/src/monitors/monitor-http-check';
import type { ScenarioListItem } from './scenario-card';

type Quality = NonNullable<ScenarioListItem['quality']>;
type QualityConfig = Quality['executionConfig'];

function QualityConfigurationEditor({ project, quality, onSaved, onCancel, saving, onSaving }: {
  project: Project; quality: Quality; onSaved: (scenario: ScenarioListItem) => void;
  onCancel: () => void; saving: boolean; onSaving: (saving: boolean) => void;
}) {
  const config: QualityConfig = quality.executionConfig;
  const environments = project.environments.filter(item => !scenarioRunEnvironmentError(item)
    && (quality.kind !== 'lighthouse' || item.readOnly !== false));
  const [environmentId, setEnvironmentId] = useState(config.environmentId ?? '');
  const [url, setUrl] = useState(config.url ?? '');
  const [interval, setInterval] = useState(String(config.monitor?.intervalMinutes ?? ''));
  const [timeout, setTimeoutMs] = useState(String(config.monitor?.timeoutMs ?? ''));
  const [active, setActive] = useState(config.monitor?.active ?? false);
  const [method, setMethod] = useState(config.monitor?.method ?? defaultMonitorHttpCheck.method);
  const [minStatus, setMinStatus] = useState(String(config.monitor?.minStatus ?? defaultMonitorHttpCheck.minStatus));
  const [maxStatus, setMaxStatus] = useState(String(config.monitor?.maxStatus ?? defaultMonitorHttpCheck.maxStatus));
  const [stages, setStages] = useState(() => (config.stages ?? []).map(stage => ({
    duration: stage.duration, target: String(stage.target),
  })));
  const [error, setError] = useState('');
  const editor = useRef<HTMLFieldSetElement>(null);

  async function save() {
    if (saving || !editor.current) return;
    const fields = editor.current.querySelectorAll('input, select');
    for (const field of fields) {
      if ((field instanceof HTMLInputElement || field instanceof HTMLSelectElement) && !field.reportValidity()) return;
    }
    if (quality.kind === 'availability' && Number(minStatus) > Number(maxStatus)) {
      setError('El código HTTP inicial debe ser menor o igual al final.');
      return;
    }
    if (quality.kind === 'load' && !stages.length) {
      setError('Agrega al menos una etapa.');
      return;
    }
    setError('');
    onSaving(true);
    try {
      const response = await fetch(`/api/projects/${project.id}/scenarios/quality/${quality.kind}/${quality.resourceId}/configuration`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          environmentId,
          ...(url.trim() !== config.url && { url: url.trim() }),
          ...(quality.kind === 'availability' && {
            method, minStatus: Number(minStatus), maxStatus: Number(maxStatus),
            intervalMinutes: Number(interval), timeoutMs: Number(timeout), active,
          }),
          ...(quality.kind === 'load' && { stages: stages.map(stage => ({ duration: stage.duration.trim(), target: Number(stage.target) })) }),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.quality?.resourceId !== quality.resourceId || payload.quality.kind !== quality.kind) {
        const message = Array.isArray(payload?.message) ? payload.message.join(' · ') : payload?.message;
        throw new Error(message || 'No se pudo guardar la configuración.');
      }
      onSaved(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar la configuración.');
    } finally {
      onSaving(false);
    }
  }

  return <fieldset ref={editor} className="suite-quality-editor" disabled={saving}>
    <legend>Editar configuración</legend>
    <label>Entorno<select required value={environmentId} onChange={event => setEnvironmentId(event.target.value)}>
      <option value="" disabled>Selecciona un entorno autorizado</option>
      {environments.map(env => <option key={env.id} value={env.id}>
        {env.type ? environmentTypes[env.type] : 'Entorno'} · {env.baseUrl}
      </option>)}
    </select></label>
    <label>URL objetivo<input type="url" required maxLength={2048} value={url} onChange={event => setUrl(event.target.value)} /></label>
    {quality.kind === 'availability' && <div className="suite-quality-editor-grid">
      <label>Método HTTP<select value={method} onChange={event => setMethod(event.target.value)}>
        <option value="GET">GET</option>
        <option value="HEAD">HEAD</option>
      </select></label>
      <label>Código HTTP inicial<input type="number" required min={200} max={599}
        value={minStatus} onChange={event => setMinStatus(event.target.value)} /></label>
      <label>Código HTTP final<input type="number" required min={200} max={599}
        value={maxStatus} onChange={event => setMaxStatus(event.target.value)} /></label>
      <label>Intervalo del monitor (min)<input type="number" required min={5} max={1440}
        value={interval} onChange={event => setInterval(event.target.value)} /></label>
      <label>Tiempo máximo de respuesta (ms)<input type="number" required min={1000} max={60000}
        value={timeout} onChange={event => setTimeoutMs(event.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} />Monitor activo</label>
    </div>}
    {quality.kind === 'load' && <div className="suite-quality-editor-stages">
      {stages.map((stage, index) => <div key={index} className="suite-quality-editor-grid">
        <label>Duración de etapa {index + 1}<input required pattern="[0-9]+[smh]" placeholder="30s"
          value={stage.duration} onChange={event => setStages(previous => previous.map((row, position) =>
            position === index ? { ...row, duration: event.target.value } : row))} /></label>
        <label>Usuarios virtuales de etapa {index + 1}<input type="number" min={0} max={1000} required
          value={stage.target} onChange={event => setStages(previous => previous.map((row, position) =>
            position === index ? { ...row, target: event.target.value } : row))} /></label>
        <button type="button" className="secondary" onClick={() => setStages(previous => previous.filter((_, position) => position !== index))}>
          Quitar etapa {index + 1}
        </button>
      </div>)}
      <button type="button" className="secondary" disabled={stages.length >= 10}
        onClick={() => setStages(previous => [...previous, { duration: '30s', target: '1' }])}>Agregar etapa</button>
    </div>}
    {error && <p role="alert" className="error">{error}</p>}
    <div className="actions">
      <button type="button" onClick={save}>{saving ? 'Guardando…' : 'Guardar configuración'}</button>
      <button type="button" className="secondary" onClick={onCancel}>Cancelar edición</button>
    </div>
  </fieldset>;
}

export function SuiteQualityConfiguration({ project, scenarios, editingId, onEdit, onSaved, saving, onSaving }: {
  project: Project; scenarios: ScenarioListItem[]; editingId: string | null;
  onEdit: (id: string | null) => void; onSaved: (scenario: ScenarioListItem) => void;
  saving: boolean; onSaving: (saving: boolean) => void;
}) {
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
        {editingId === id ? <QualityConfigurationEditor project={project} quality={quality} onSaved={onSaved}
          onCancel={() => onEdit(null)} saving={saving} onSaving={onSaving} /> : <>
          <dl>{fields.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          <button type="button" className="secondary suite-quality-edit" aria-label={`Editar configuración de ${title}`}
            disabled={editingId !== null} onClick={() => onEdit(id)}>Editar configuración</button>
        </>}
      </li>;
    })}</ul>
  </details>;
}
