'use client';

import Link from 'next/link';
import { Check, Copy, FileCode2, FileText, KeyRound, Pencil, PlusCircle, ShieldCheck, Terminal } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { accessModes, environmentTypes, type Project } from '../onboarding';
import { categoryLabels, documentRequest, fileSize, type SavedDocument } from '../document-client';
import { ProjectForm } from '../project-form';
import { IpaHero, type IpaSummary } from './ipa-hero';

const documentStates = { DECLARED: 'Declarado', UPLOADED: 'Cargado', PROCESSED: 'Procesado', VALIDATED: 'Validado' };

function DetailCard({ number, title, action, children }: {
  number: string; title: string; action?: ReactNode; children: ReactNode;
}) {
  return <section className="detail-card">
    <header className="detail-card__head"><h2><span>{number} //</span> {title}</h2>{action}</header>
    <div className="detail-card__body">{children}</div>
  </section>;
}

export function DataTab({ project: initial, ipa }: { project: Project; ipa: IpaSummary | null }) {
  const [project, setProject] = useState(initial);
  const [editing, setEditing] = useState(initial.status !== 'READY');
  const [focusSection, setFocusSection] = useState('');
  const [environmentId, setEnvironmentId] = useState(initial.environments[0]?.id ?? '');
  const [documents, setDocuments] = useState<SavedDocument[] | null>(null);
  const [documentError, setDocumentError] = useState('');
  const [reload, setReload] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const environment = project.environments.find(env => env.id === environmentId) ?? project.environments[0];

  useEffect(() => {
    setProject(initial);
    if (initial.status !== 'READY') setEditing(true);
  }, [initial]);

  useEffect(() => {
    if (!editing || !focusSection) return;
    const heading = document.getElementById(focusSection);
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setFocusSection('');
  }, [editing, focusSection]);

  useEffect(() => {
    if (editing) return;
    const controller = new AbortController();
    setDocuments(null);
    setDocumentError('');
    documentRequest<SavedDocument[]>(project.id, '', { signal: controller.signal })
      .then(list => { if (!controller.signal.aborted) setDocuments(list); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setDocumentError(error instanceof Error ? error.message : 'No se pudieron cargar los documentos.');
      });
    return () => controller.abort();
  }, [project.id, project.revision, editing, reload]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  function edit(section = 'environment-heading') { setFocusSection(section); setEditing(true); }
  async function copyUrl() {
    setCopyError('');
    try { await navigator.clipboard.writeText(environment?.baseUrl ?? ''); setCopied(true); }
    catch { setCopyError('No se pudo copiar. Puedes seleccionar la URL y copiarla manualmente.'); }
  }

  if (editing) return <div className="project-edit">
    {project.status === 'READY' && <button type="button" className="secondary" onClick={() => setEditing(false)}>
      ← Volver a la vista de resumen
    </button>}
    <ProjectForm initial={project} onSaved={saved => {
      setProject(saved);
      if (saved.status === 'READY') setEditing(false);
    }} />
  </div>;

  return <div className="project-overview">
    <div className="project-overview__main">
      <DetailCard number="01" title="Parámetros del entorno y reglas de acceso" action={
        <button type="button" className="detail-edit" onClick={() => edit()}><Pencil size={12} /> Modificar</button>
      }>
        {project.environments.length > 1 && <label className="detail-label">Entorno seleccionado
          <select aria-label="Entorno seleccionado" value={environment?.id ?? ''} onChange={event => { setEnvironmentId(event.target.value); setCopied(false); setCopyError(''); }}>
            {project.environments.map(env => <option key={env.id} value={env.id}>
              {env.type ? environmentTypes[env.type] : 'Sin tipo'} · {env.baseUrl ?? 'Sin URL'}
            </option>)}
          </select>
        </label>}
        {environment ? <dl className="detail-fields">
          <div className="detail-fields__wide"><dt>URL base operativa</dt><dd className="detail-url">
            <code>{environment.baseUrl ?? 'Sin URL registrada'}</code>
            {environment.baseUrl && <button type="button" className="detail-copy" onClick={() => void copyUrl()} aria-label="Copiar URL base">
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>}
          </dd><span className="detail-copy-notice" role="status">{copied ? 'URL copiada.' : copyError}</span></div>
          <div><dt>Dominios autorizados</dt><dd className="detail-tags">{environment.allowedHosts.length
            ? environment.allowedHosts.map(host => <code key={host}>{host}</code>) : <span className="muted">Sin dominios declarados</span>}</dd></div>
          <div><dt>Equipo responsable</dt><dd>{project.ownerLabel ?? 'Sin responsable declarado'}</dd></div>
          <div className="detail-fields__wide"><dt>Autenticación y credenciales</dt><dd className="detail-credential">
            <KeyRound size={14} /><span>{environment.accessMode ? accessModes[environment.accessMode] : 'Sin modalidad de acceso'} · {environment.hasCredentials ? 'Credenciales guardadas' : 'Sin credenciales guardadas'}</span>
          </dd></div>
          <div><dt>Autorización de pruebas</dt><dd className={environment.authorizationConfirmed ? 'success' : 'error'}>
            {environment.authorizationConfirmed ? 'Confirmada' : 'Pendiente de confirmación'}</dd></div>
          <div><dt>Modo de operación</dt><dd>{environment.readOnly ? 'Solo lectura' : 'Según restricciones declaradas'}</dd></div>
          <div className="detail-fields__wide"><dt>Rutas permitidas</dt><dd className="detail-tags">{environment.allowedPaths.length
            ? environment.allowedPaths.map((route, i) => <code key={i}>{route.host}{route.path}</code>) : <span className="muted">Sin rutas específicas declaradas</span>}</dd></div>
          {(environment.excludedPaths.length > 0 || environment.prohibitedActions.length > 0) && <div className="detail-fields__wide">
            <dt>Restricciones y exclusiones</dt><dd className="detail-tags">
              {environment.excludedPaths.map((route, i) => <code key={i}>{route.host}{route.path}</code>)}
              {environment.prohibitedActions.map(action => <span key={action}>{action}</span>)}
            </dd></div>}
          {project.priorityModules.length > 0 && <div className="detail-fields__wide"><dt>Módulos prioritarios</dt><dd className="detail-tags">
            {project.priorityModules.map(module => <span key={module}>{module}</span>)}
          </dd></div>}
        </dl> : <p className="muted">No hay entornos registrados.</p>}
      </DetailCard>
      <DetailCard number="02" title="Documentos asociados y contratos técnicos" action={
        <span className="detail-count">{documents ? `${documents.length} archivos registrados` : documentError ? 'Sin consultar' : 'Cargando…'}</span>
      }>
        {documentError ? <div role="alert"><p className="error">{documentError}</p>
          <button type="button" className="secondary" onClick={() => setReload(value => value + 1)}>Reintentar consulta</button></div>
          : documents === null ? <p className="muted" role="status">Consultando documentación…</p>
          : documents.length === 0 ? <div className="detail-empty"><FileText size={24} /><p>Aún no hay documentos asociados.</p><small>Adjunta requisitos o especificaciones para enriquecer el análisis.</small></div>
          : <ul className="detail-documents">{documents.map(document => <li key={document.id}>
            <span className="detail-file-icon">{document.type === 'API' ? <FileCode2 size={17} /> : <FileText size={17} />}</span>
            <div className="detail-document-name"><strong>{document.filename}</strong><span>
              {categoryLabels[document.type]} · {fileSize(document.currentVersion?.size)}
              {document.currentVersion?.format && ` · ${document.currentVersion.format.toUpperCase()}`}
            </span></div>
            <span className={`detail-document-state detail-document-state--${document.state.toLowerCase()}`}>{documentStates[document.state]}</span>
          </li>)}</ul>}
        <button type="button" className="detail-attach" onClick={() => edit('document-heading')}>
          <PlusCircle size={14} /> Adjuntar nuevo documento o especificación
        </button>
      </DetailCard>
      <DetailCard number="03" title="Roles y matriz de autorización" action={<span className="detail-count">{project.roles.length} roles</span>}>
        {project.roles.length ? <ul className="detail-roles">{project.roles.map((role, i) => <li key={i}>
          <ShieldCheck size={16} /><div><h3>{role.name}</h3><p>{role.description ?? 'Sin descripción declarada.'}</p>
            {role.permissions.length > 0 && <ul className="detail-permissions">{role.permissions.map((permission, j) => <li key={j}>
              <span className={permission.allowed ? 'success' : 'error'}>{permission.allowed ? 'Permitido' : 'Denegado'}</span>
              {' · '}{permission.resource} / {permission.action}
            </li>)}</ul>}
          </div>
        </li>)}</ul> : <p className="muted">No hay roles declarados. Puedes agregarlos para probar permisos.</p>}
        <button type="button" className="detail-edit" onClick={() => edit('role-heading')}><Pencil size={12} /> Editar roles y permisos</button>
      </DetailCard>
    </div>
    <aside className="project-overview__aside" aria-label="Preparación y diagnóstico del proyecto">
      <section className="detail-card detail-ipa">
        {ipa ? <><IpaHero ipa={ipa} subtitle="Evaluación estructural del proyecto registrado." />
          <Link className="detail-audit" href={`/projects/${project.id}/ipa`}>Ver auditoría completa de IPA <span>→</span></Link></>
          : <><header className="detail-card__head"><h2>Índice de Preparación para Automatización (IPA)</h2></header>
            <div className="detail-card__body"><p className="muted">No se pudo consultar la evaluación. No hay una puntuación disponible.</p>
              <Link href={`/projects/${project.id}/ipa`}>Consultar IPA →</Link></div></>}
      </section>
      <section className="detail-diagnostics" aria-labelledby="diagnostic-heading">
        <header><h2 id="diagnostic-heading"><Terminal size={13} /> Diagnóstico del proyecto</h2><span>REGISTRO</span></header>
        <ul>
          <li><span>01 [ALCANCE]</span> {project.environments.filter(env => env.authorizationConfirmed).length} de {project.environments.length} entornos con autorización confirmada.</li>
          <li><span>02 [DOCUMENTOS]</span> {documents ? `${documents.filter(doc => doc.state === 'PROCESSED' || doc.state === 'VALIDATED').length} de ${documents.length} procesados o validados.` : documentError ? 'Consulta no disponible.' : 'Consultando archivos.'}</li>
          <li><span>03 [IPA]</span> {ipa ? (ipa.status === 'BLOCKED' ? 'Hay bloqueos que requieren atención.' : `Preparación estructural: ${ipa.score}/100.`) : 'Evaluación no disponible.'}</li>
        </ul>
        <p>Estado del registro. No representa una ejecución de pruebas.</p>
      </section>
    </aside>
  </div>;
}
