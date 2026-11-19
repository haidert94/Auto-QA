'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { environmentTypes, type Environment } from '../onboarding';
import type { ScenarioListItem } from './scenario-card';
import type { GeneratedSpec } from './automation-export';

export function ScenarioRunDialog({ projectId, scenarios, environments, specs, onClose, onQueued }: {
  projectId: string; scenarios: ScenarioListItem[]; environments: Environment[];
  specs?: Record<string, GeneratedSpec>;
  onClose: () => void; onQueued: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [environmentId, setEnvironmentId] = useState(environments[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ title: string; queued: boolean; detail: string }[] | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);

  async function queue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || results || !environments.some(environment => environment.id === environmentId)) return;
    setBusy(true);
    const next = [];
    for (const scenario of scenarios) {
      try {
        const response = await fetch(`/api/projects/${projectId}/scenarios/${scenario.id}/runs`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ environmentId, automationId: specs?.[scenario.id]?.automationId }),
          signal: AbortSignal.timeout(15000),
        });
        const payload = await response.json().catch(() => ({}));
        next.push({ title: scenario.title, queued: response.ok, detail: response.ok ? `En cola · ${payload.id}`
          : Array.isArray(payload.message) ? payload.message.join(' · ') : payload.message ?? 'No se pudo encolar.' });
      } catch { next.push({ title: scenario.title, queued: false, detail: 'No se confirmó el envío. Consulta el reporte antes de volver a intentarlo.' }); }
    }
    setResults(next);
    setBusy(false);
    onQueued();
  }

  return <dialog ref={dialog} className="scenario-run-dialog" aria-labelledby="suite-title"
    onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <h2 id="suite-title">Ejecutar suite ({scenarios.length})</h2>
    <p>Se solicitará una ejecución por escenario. La API comprobará autorización, alcance, plan y cuotas.</p>
    <ul className="scenario-run-targets">{scenarios.map(scenario => <li key={scenario.id}>{scenario.title}</li>)}</ul>
    {!results ? <form onSubmit={queue}>
      <label>Entorno autorizado<select value={environmentId} onChange={event => setEnvironmentId(event.target.value)} disabled={busy} required>
        {environments.map(environment => <option key={environment.id} value={environment.id}>
          {environment.type ? environmentTypes[environment.type] : 'Entorno'} · {environment.baseUrl}
        </option>)}
      </select></label>
      <label className="check"><input type="checkbox" required disabled={busy} />Confirmo ejecutar los escenarios seleccionados dentro del alcance autorizado y en modo de solo lectura.</label>
      <div className="actions"><button type="submit" disabled={busy || !environmentId}>{busy ? 'Encolando…' : 'Confirmar ejecución'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancelar</button></div>
    </form> : <>
      <ul className="scenario-queue-results" aria-live="polite">{results.map((result, i) => <li key={i}>
        <strong>{result.title}</strong><span className={result.queued ? 'success' : 'error'}>{result.detail}</span>
      </li>)}</ul>
      <p className="muted">En cola no significa que la prueba haya finalizado o pasado.</p>
      <div className="actions"><Link href="#reporte" className="button-like" onClick={onClose}>Ver reporte</Link>
        <button type="button" className="secondary" onClick={onClose}>Cerrar</button></div>
    </>}
  </dialog>;
}
