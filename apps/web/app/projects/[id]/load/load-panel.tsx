'use client';

import { useState, type FormEvent } from 'react';
import type { OrgRole } from '../../../autoqa-server';
import { can } from '../../../permissions';
import { QualityResultsLink } from '../quality-results-link';
import { postmanFileLimit, readPostmanCollection, resolvePostmanEndpoint, type PostmanImport } from './postman-import';

type EnvironmentOption = { id: string; type: string | null; baseUrl: string | null };

const PROFILES = [
  { label: 'Suave · 10 VUs 2 min', stages: [
    { duration: '30s', target: 5 }, { duration: '1m', target: 10 }, { duration: '30s', target: 0 },
  ]},
  { label: 'Medio · 30 VUs 5 min', stages: [
    { duration: '1m', target: 10 }, { duration: '3m', target: 30 }, { duration: '1m', target: 0 },
  ]},
  { label: 'Intensivo · 100 VUs 10 min', stages: [
    { duration: '2m', target: 20 }, { duration: '2m', target: 50 }, { duration: '5m', target: 100 }, { duration: '1m', target: 0 },
  ]},
];

export function LoadPanel({ projectId, environments, role }: { projectId: string; environments: EnvironmentOption[]; role?: OrgRole }) {
  const canCreate = can(role, 'load.create');
  const [envId, setEnvId] = useState(environments[0]?.id ?? '');
  const [name, setName] = useState('');
  const [url, setUrl] = useState(environments[0]?.baseUrl ?? '');
  const [collection, setCollection] = useState<PostmanImport>();
  const [endpointIndex, setEndpointIndex] = useState('');
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
  const [profileIndex, setProfileIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function importCollection(file: File) {
    if (selectedEndpoint) setUrl(environments.find(env => env.id === envId)?.baseUrl ?? '');
    setCollection(undefined);
    setEndpointIndex('');
    setImportError('');
    if (file.size === 0 || file.size > postmanFileLimit) {
      setImportError('Selecciona una colección JSON de hasta 5 MiB.');
      return;
    }
    setImporting(true);
    try {
      setCollection(readPostmanCollection(await file.text()));
    } catch (reason) {
      setImportError(reason instanceof SyntaxError ? 'El archivo no contiene JSON válido.' : 'No se pudo importar la colección. Usa un export de Postman en JSON v2.0 o v2.1.');
    } finally {
      setImporting(false);
    }
  }

  const selectedEndpoint = endpointIndex === '' ? undefined : collection?.endpoints[Number(endpointIndex)];

  function changeEnvironment(id: string) {
    setEnvId(id);
    if (!selectedEndpoint) return;
    const candidate = resolvePostmanEndpoint(selectedEndpoint, environments.find(env => env.id === id)?.baseUrl ?? null);
    setUrl(candidate ?? '');
    setImportError(candidate ? '' : 'El entorno seleccionado necesita una URL base válida.');
  }

  function selectEndpoint(index: string) {
    setEndpointIndex(index);
    setImportError('');
    if (index === '') {
      if (selectedEndpoint) setUrl(environments.find(env => env.id === envId)?.baseUrl ?? '');
      return;
    }
    const endpoint = collection?.endpoints[Number(index)];
    if (!endpoint) return;
    const candidate = resolvePostmanEndpoint(endpoint, environments.find(env => env.id === envId)?.baseUrl ?? null);
    setUrl(candidate ?? '');
    if (!candidate) setImportError('El entorno seleccionado necesita una URL base válida.');
  }

  async function queue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/projects/${projectId}/load-tests`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          environmentId: envId, name: name.trim(), url,
          stages: PROFILES[profileIndex].stages,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.detail ? `${payload.message ?? 'Error'} (${payload.issue}: ${payload.detail})` : payload.message ?? 'No se pudo encolar la prueba.');
        return;
      }
      setName('');
      setNotice('Prueba de carga encolada.');
    } catch { setError('No se pudo encolar la prueba.'); }
    finally { setBusy(false); }
  }

  if (environments.length === 0) {
    return <><p className="muted">Autoriza al menos un entorno para encolar pruebas de carga.</p>
      <QualityResultsLink projectId={projectId} /></>;
  }

  return <>
    <p className="muted">
      Simula tráfico concurrente contra una URL autorizada. Define cuántos usuarios virtuales (VUs) por
      cuánto tiempo y AutoQA mide latencias p50/p95/p99, requests por segundo y tasa de error.
    </p>

    {canCreate && <section className="load-import" aria-labelledby="load-import-title">
      <h2 id="load-import-title">Importar colección de Postman</h2>
      <label htmlFor="load-postman-file">Colección JSON</label>
      <input id="load-postman-file" type="file" accept=".json,application/json" disabled={busy || importing}
        onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void importCollection(file);
        }} />
      {importing && <p className="muted" role="status">Leyendo colección…</p>}
      {collection && <>
        {collection.endpoints.length > 0 ? <label>Endpoint GET<select value={endpointIndex} disabled={busy || importing}
          onChange={event => selectEndpoint(event.target.value)}>
          <option value="">Seleccionar endpoint</option>
          {collection.endpoints.map((endpoint, index) => <option key={index} value={index}>
            GET {endpoint.relativeToBase ? '· Entorno ' : '· Raíz '}{endpoint.path}
          </option>)}
        </select></label> : <p className="muted" role="status">No hay endpoints GET listos para usar.</p>}
        {(collection.otherMethods > 0 || collection.authenticated > 0 || collection.incomplete > 0) &&
          <ul className="muted load-import__omitted">
            {collection.otherMethods > 0 && <li>Solicitudes con otros métodos: {collection.otherMethods}</li>}
            {collection.authenticated > 0 && <li>Solicitudes que requieren autenticación: {collection.authenticated}</li>}
            {collection.incomplete > 0 && <li>Solicitudes con rutas pendientes de completar: {collection.incomplete}</li>}
          </ul>}
      </>}
      {importError && <p className="error" role="alert">{importError}</p>}
    </section>}

    {canCreate && <form onSubmit={queue} className="run-form">
      <label>Nombre<input value={name} onChange={e => setName(e.target.value)} required maxLength={120}
        placeholder="Pico mañana del lunes"/></label>
      <label>Entorno<select value={envId} onChange={e => changeEnvironment(e.target.value)} required>
        {environments.map(env => <option key={env.id} value={env.id}>
          {env.type ?? 'Entorno'} · {env.baseUrl ?? env.id.slice(0, 8)}
        </option>)}
      </select></label>
      <div>
        <label htmlFor="load-target-url">URL a cargar</label>
        <input id="load-target-url" type="url" value={url} onChange={e => {
          setEndpointIndex('');
          setImportError('');
          setUrl(e.target.value);
        }} required maxLength={2048} aria-describedby={selectedEndpoint?.hasQuery ? 'load-query-note' : undefined} />
        {selectedEndpoint?.hasQuery && <small id="load-query-note" className="muted">Agrega en la URL los parámetros de prueba que correspondan.</small>}
      </div>
      <label>Perfil<select value={profileIndex} onChange={e => setProfileIndex(Number(e.target.value))}>
        {PROFILES.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
      </select></label>
      <div className="actions">
        <button type="submit" disabled={busy}>{busy ? 'Encolando…' : 'Encolar prueba'}</button>
      </div>
    </form>}

    {error && <p className="error" role="alert">{error}</p>}

    {notice && <p className="success" role="status">{notice}</p>}
    <p><QualityResultsLink projectId={projectId} /></p>
  </>;
}
