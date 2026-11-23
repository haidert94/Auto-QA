'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';

type UploadedDoc = { filename: string; base64: string; size: number };

type ReviewCategory = { code: string; label: string; percent: number; detail?: string };
type ReviewStory = { title: string; coverage: 'completa' | 'parcial' | 'no-cubierta' | 'ambigua'; notes?: string };
type Review = {
  score: number;
  level: 'Óptimo' | 'Aceptable' | 'Mejorable' | 'Insuficiente';
  summary: string;
  categories: ReviewCategory[];
  stories: ReviewStory[];
  warnings: string[];
  recommendation: string;
};

type Outcome = { type: string; created: number; usedFallback: boolean; model: string; errorCount: number; issue?: string };
type Generation = { selection: string[]; outcomes: Outcome[]; totalCreated: number };

type Job = {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED';
  stage: string;
  errorCode: string | null;
  result: { review: Review; aiModel: string; usedFallback: boolean; generation?: Generation } | null;
};

const STAGE_LABELS: Record<string, string> = {
  pending: 'En cola',
  claimed: 'Preparando pipeline',
  converting: 'Convirtiendo documentos a Markdown',
  reviewing: 'Analizando con IA',
  'review-ready': 'Diagnóstico listo',
  'selection-done': 'Selección guardada — en cola para generar',
  'generation-batch-ready': 'Selección guardada — en cola para generar',
  generating: 'Generando casos de prueba',
  generated: 'Casos generados',
};

const TYPE_LABELS: Record<string, string> = {
  functional_web: 'Funcional web',
  mobile_emulated: 'Mobile emulado',
  compatibility: 'Compatibilidad',
  availability: 'Disponibilidad',
  performance: 'Performance',
  ux: 'UX',
  manual: 'Casos manuales',
};

type TestTypeOption = { code: string; label: string; description: string; available: boolean };

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function AutomateWizard({ projectId, projectName, suggestedUrl }: {
  projectId: string; projectName: string; suggestedUrl: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [url, setUrl] = useState(suggestedUrl);
  const [description, setDescription] = useState('');
  const [ownerLabel, setOwnerLabel] = useState('');
  const [credentialsHint, setCredentialsHint] = useState('');
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [types, setTypes] = useState<TestTypeOption[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submittingSelection, setSubmittingSelection] = useState(false);
  const [selectionDone, setSelectionDone] = useState(false);

  async function loadTypes() {
    if (types) return;
    try {
      const response = await fetch(`/api/projects/${projectId}/automation/types`, { cache: 'no-store' });
      if (!response.ok) return;
      const data: TestTypeOption[] = await response.json();
      setTypes(data);
      // Pre-selecciona los disponibles como opción amable.
      setSelected(new Set(data.filter(t => t.available).map(t => t.code)));
    } catch {}
  }

  function toggleSelected(code: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function acceptSelection() {
    if (!job || selected.size === 0) return;
    setSubmittingSelection(true); setError('');
    try {
      const response = await fetch(`/api/projects/${projectId}/automation/${job.id}/select`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ types: Array.from(selected) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.message ?? 'No se pudo guardar la selección.');
        return;
      }
      setSelectionDone(true);
      // La consulta vuelve a activar el seguimiento con el lote en cola.
      try {
        const check = await fetch(`/api/projects/${projectId}/automation/${job.id}`, { cache: 'no-store' });
        if (check.ok) {
          const data = await check.json();
          setJob({ id: data.id, status: data.status, stage: data.stage, errorCode: data.errorCode, result: data.result ?? null });
        }
      } catch {}
    } catch { setError('No se pudo guardar la selección.'); }
    finally { setSubmittingSelection(false); }
  }

  async function onFiles(files: FileList | null) {
    if (!files) return;
    const next: UploadedDoc[] = [];
    for (const file of Array.from(files).slice(0, 10)) {
      if (file.size > 5 * 1024 * 1024) { setError(file.name + ' supera 5 MB.'); continue; }
      const base64 = await readFile(file);
      next.push({ filename: file.name, base64, size: file.size });
    }
    setDocs(prev => [...prev, ...next].slice(0, 10));
  }

  function removeDoc(filename: string) {
    setDocs(prev => prev.filter(d => d.filename !== filename));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/projects/${projectId}/automation`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          description: description.trim() || undefined,
          ownerLabel: ownerLabel.trim() || undefined,
          credentialsHint: credentialsHint.trim() || undefined,
          documents: docs.map(d => ({ filename: d.filename, base64: d.base64 })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setError(payload.message ?? 'No se pudo encolar la automatización.'); return; }
      setJob({ id: payload.id, status: payload.status, stage: payload.stage, errorCode: null, result: null });
      setStep(1);
    } catch { setError('No se pudo encolar la automatización.'); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (job?.status === 'COMPLETED' && job.stage === 'review-ready') void loadTypes();
  }, [job?.status, job?.stage]);

  // Polling: corre mientras el job esté QUEUED o RUNNING. Se detiene al
  // llegar a COMPLETED/FAILED, pero vuelve a armarse si acceptSelection
  // vuelve a poner el trabajo en cola.
  useEffect(() => {
    if (!job) return;
    if (job.status !== 'QUEUED' && job.status !== 'RUNNING') return;
    pollRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/automation/${job.id}`, { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        setJob({ id: data.id, status: data.status, stage: data.stage, errorCode: data.errorCode, result: data.result ?? null });
        if ((data.status === 'COMPLETED' || data.status === 'FAILED') && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        if (data.status === 'COMPLETED' || data.status === 'FAILED') setStep(2);
      } catch {}
    }, 3000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [job?.id, job?.status, projectId]);

  if (step === 0) {
    return <form onSubmit={submit} className="automate-form">
      <p className="muted">
        Arrancamos la automatización para <strong>{projectName}</strong>. La IA convierte tus documentos, genera un
        diagnóstico de preparación y luego propone los casos de prueba según tu plan.
      </p>

      <label>URL base de la aplicación
        <input type="url" value={url} onChange={e => setUrl(e.target.value)} required maxLength={2048}
               placeholder="https://app.mi-cliente.com"/>
      </label>

      <label>Descripción del producto (opcional)
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} maxLength={2000}
                  placeholder="¿Qué hace esta aplicación y para qué público?"/>
      </label>

      <label>Propietario del producto (opcional)
        <input value={ownerLabel} onChange={e => setOwnerLabel(e.target.value)} maxLength={200}
               placeholder="Nombre del dueño de producto o área responsable"/>
      </label>

      <label>Credenciales de prueba (opcional)
        <input value={credentialsHint} onChange={e => setCredentialsHint(e.target.value)} maxLength={120}
               placeholder="Referencia a la cuenta de prueba — NO contraseña real"/>
        <small className="muted">
          Las credenciales reales se gestionarán con un vault cifrado en una próxima iteración.
          Hoy sólo guardamos la referencia (ej. "cuenta-qa-01") para el agente, no secretos.
        </small>
      </label>

      <label>Documentación funcional (hasta 10 archivos, 5 MB c/u)
        <input type="file" multiple onChange={e => void onFiles(e.target.files)}
               accept=".pdf,.docx,.xlsx,.xls,.md,.markdown,.txt"/>
      </label>

      {docs.length > 0 && <ul className="doc-list">
        {docs.map(d => <li key={d.filename}>
          <span>{d.filename}</span>
          <span className="muted">{(d.size / 1024).toFixed(1)} KB</span>
          <button type="button" className="secondary" onClick={() => removeDoc(d.filename)}>Quitar</button>
        </li>)}
      </ul>}

      {error && <p className="error" role="alert">{error}</p>}

      <div className="actions">
        <button type="submit" disabled={busy || !url.trim()}>
          {busy ? 'Enviando…' : 'Analizar con IA'}
        </button>
      </div>
    </form>;
  }

  // Mientras no haya review-ready, muestra pantalla de progreso. Pero si
  // ya tenemos review-ready y el usuario está generando, mantenemos la
  // IPA visible con un banner inferior.
  const generating = job?.stage === 'selection-done' || job?.stage === 'generation-batch-ready' || job?.stage === 'generating';
  const generated = job?.stage === 'generated';
  const outdatedWorker = selectionDone && job?.status === 'COMPLETED' && job.stage === 'review-ready';
  if (outdatedWorker || (generating && (job?.status === 'FAILED' || job?.status === 'CANCELED'))) {
    const missingTypes = job?.result?.generation?.outcomes.filter(outcome => outcome.issue)
      .map(outcome => TYPE_LABELS[outcome.type] ?? outcome.type) ?? [];
    return <section className="automate-progress">
      <h2>El lote quedó pendiente</h2>
      <p role="alert">No se guardaron casos nuevos. {outdatedWorker
        ? 'Actualiza Explorer antes de reintentar.'
        : missingTypes.length ? 'Tipos sin casos válidos: ' + missingTypes.join(', ') + '.' : 'Vuelve a intentar la generación.'}</p>
      <button type="button" onClick={() => { setJob(null); setSelectionDone(false); setStep(0); }}>Volver a intentar</button>
    </section>;
  }
  if ((step === 1 || !job?.result) && !generating && !generated) {
    const stageLabel = STAGE_LABELS[job?.stage ?? 'pending'] ?? job?.stage ?? 'Procesando…';
    const done = job?.status === 'FAILED';
    return <section className="automate-progress">
      <h2>{done ? 'La automatización falló' : 'Procesando…'}</h2>
      <p className="muted">{stageLabel}</p>
      {!done && <div className="pulse" aria-hidden="true"/>}
      {done && <p className="error">{job?.errorCode ?? 'Error desconocido'}</p>}
      {done && <button type="button" onClick={() => { setJob(null); setStep(0); }}>Volver a intentar</button>}
    </section>;
  }

  // step === 2: mostrar IPA. Si job.result es null pese al gate anterior,
  // volvemos al progreso para no romper la render.
  if (!job?.result) {
    return <section className="automate-progress"><p className="muted">Cargando resultado…</p></section>;
  }
  const review = job.result.review;
  return <section className="ipa-diagnostic">
    <header className="ipa-diagnostic-head">
      <div>
        <p className="ipa-eyebrow">Diagnóstico de automatización</p>
        <h2>Índice de Preparación para Automatización (IPA)</h2>
      </div>
      <span className={`ipa-level-badge ipa-level-${review.level.toLowerCase()}`}>Nivel {review.level}</span>
    </header>

    <div className="ipa-score-card">
      <div className="ipa-score-circle">
        <span className="ipa-score-value">{review.score}</span>
        <span className="ipa-score-max">/ 100</span>
      </div>
      <div>
        <p className="ipa-score-headline">{review.score} / 100 — Nivel {review.level} para Automatización</p>
        <p className="muted">{review.summary}</p>
        <p className="muted"><small>Modelo: {job.result.aiModel}{job.result.usedFallback ? ' · fallback sin IA' : ''}</small></p>
      </div>
    </div>

    <ul className="ipa-category-list">
      {review.categories.map(cat => <li key={cat.code}>
        <div className="ipa-category-head">
          <span>{cat.label}</span>
          <strong>{cat.percent}%</strong>
        </div>
        <div className="ipa-category-bar"><div className="ipa-category-fill" style={{ width: cat.percent + '%' }}/></div>
        {cat.detail && <p className="muted">{cat.detail}</p>}
      </li>)}
    </ul>

    {review.stories.length > 0 && <section>
      <h3>Historias de usuario detectadas ({review.stories.length})</h3>
      <ul className="ipa-stories">
        {review.stories.map((s, i) => <li key={i} className={`ipa-story ipa-story-${s.coverage}`}>
          <strong>{s.title}</strong>
          <span className="ipa-story-coverage">{s.coverage}</span>
          {s.notes && <p className="muted">{s.notes}</p>}
        </li>)}
      </ul>
    </section>}

    {review.warnings.length > 0 && <section className="ipa-warnings">
      <h3>Advertencias y ambigüedades</h3>
      <ul>{review.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
    </section>}

    {!selectionDone && !generating && !generated && <section className="automation-selection">
      <h3>Selecciona qué tipos de prueba quieres generar</h3>
      <p className="muted">
        Marca los tipos a generar. Los bloqueados requieren un plan superior.
      </p>
      {types === null
        ? <p className="muted"><button type="button" onClick={loadTypes}>Cargar opciones</button></p>
        : <ul className="type-select">
          {types.map(t => <li key={t.code} className={t.available ? '' : 'locked'}>
            <label title={t.available ? '' : 'Requiere un plan superior'}>
              <input type="checkbox" checked={selected.has(t.code)} disabled={!t.available}
                     onChange={() => toggleSelected(t.code)}/>
              <span>
                <strong>{t.label}</strong>
                <small className="muted">{t.description}</small>
                {!t.available && <small className="error">Requiere plan superior</small>}
              </span>
            </label>
          </li>)}
        </ul>}
      <div className="actions">
        <button type="button" onClick={acceptSelection} disabled={submittingSelection || selected.size === 0 || types === null}>
          {submittingSelection ? 'Enviando…' : `Aceptar y generar (${selected.size})`}
        </button>
        <button type="button" className="secondary" onClick={() => router.push(`/projects/${projectId}`)}>Cancelar</button>
      </div>
    </section>}

    {generating && <section className="success-banner">
      <p className="success">
        <strong>Generando casos con {selected.size || review.categories.length} agentes paralelos.</strong>
        {' '}Etapa: {STAGE_LABELS[job.stage] ?? job.stage}.
      </p>
      <div className="pulse" aria-hidden="true"/>
    </section>}

    {generated && job.result.generation && <section className="generation-result">
      <h3>Generación completa</h3>
      <p className="muted">
        Se crearon <strong>{job.result.generation.totalCreated}</strong> artefactos en total.
        Puedes revisarlos y lanzarlos desde las pestañas del proyecto.
      </p>
      <ul className="generation-counters">
        {job.result.generation.outcomes.map(o => <li key={o.type}>
          <div className="counter-head">
            <span>{TYPE_LABELS[o.type] ?? o.type}</span>
            <strong>{o.created}</strong>
          </div>
          <small className="muted">
            Modelo: {o.model}{o.usedFallback ? ' · fallback' : ''}
            {o.errorCount > 0 ? ` · ${o.errorCount} errores no bloqueantes` : ''}
          </small>
        </li>)}
      </ul>
      <div className="actions">
        <button type="button" onClick={() => router.push(`/projects/${projectId}`)}>Ir al proyecto</button>
      </div>
    </section>}

    {error && !selectionDone && <p className="error" role="alert">{error}</p>}
  </section>;
}
