'use client';

import Link from 'next/link';
import { Check, Copy, FileCode2, FileText, KeyRound, Pencil, PlusCircle, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { accessModes, environmentTypes, type Project } from '../onboarding';
import { categoryLabels, documentRequest, fileSize, type Report, type SavedDocument } from '../document-client';
import { AnalysisCard } from './analysis-card';
import { ProjectForm } from '../project-form';
import { IpaHero, type IpaSummary } from './ipa-hero';
import { EnvironmentsDialog } from './environments-dialog';
import { DocumentsDialog } from './documents-dialog';
import { RolesDialog } from './roles-dialog';
import type { OrgRole } from '../../autoqa-server';
import { can } from '../../permissions';

const documentStates = { DECLARED: 'Declarado', UPLOADED: 'Cargado', PROCESSED: 'Procesado', VALIDATED: 'Validado' };

function DetailCard({ number, title, action, children }: {
  number: string; title: string; action?: ReactNode; children: ReactNode;
}) {
  return <section className="detail-card">
    <header className="detail-card__head"><h2><span>{number} //</span> {title}</h2>{action}</header>
    <div className="detail-card__body">{children}</div>
  </section>;
}

export function DataTab({ project: initial, ipa, role }: { project: Project; ipa: IpaSummary | null; role?: OrgRole }) {
  const [project, setProject] = useState(initial);
  const canEdit = can(role, 'project.update');
  const [editing, setEditing] = useState(initial.status !== 'READY' && canEdit);
  const [focusSection, setFocusSection] = useState('');
  const [environmentId, setEnvironmentId] = useState(initial.environments[0]?.id ?? '');
  const [documents, setDocuments] = useState<SavedDocument[] | null>(null);
  const [documentError, setDocumentError] = useState('');
  const [reload, setReload] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [envDialogOpen, setEnvDialogOpen] = useState(false);
  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const [rolesDialogOpen, setRolesDialogOpen] = useState(false);
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
    setReport(null);
    documentRequest<SavedDocument[]>(project.id, '', { signal: controller.signal })
      .then(list => { if (!controller.signal.aborted) setDocuments(list); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setDocumentError(error instanceof Error ? error.message : 'No se pudieron cargar los documentos.');
      });
    // El reporte solo existe una vez que /analyze corrió; si falla (404
    // cuando aún no hay análisis guardado), dejamos el card con el
    // placeholder de "aún no hay análisis".
    documentRequest<Report>(project.id, '/analysis', { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setReport(data); })
      .catch(() => {});
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
    <ProjectForm initial={project} role={role} onSaved={saved => {
      setProject(saved);
      if (saved.status === 'READY') setEditing(false);
    }} />
  </div>;

  return <div className="project-overview">
    <div className="project-overview__main">
      <DetailCard number="01" title="Parámetros del entorno y reglas de acceso" action={
        canEdit ? <button type="button" className="detail-edit" onClick={() => setEnvDialogOpen(true)}><Pencil size={12} /> Modificar</button> : null
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
        {canEdit && <button type="button" className="detail-attach" onClick={() => setDocDialogOpen(true)}>
          <PlusCircle size={14} /> Adjuntar nuevo documento o especificación
        </button>}
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
        {canEdit && <button type="button" className="detail-edit" onClick={() => setRolesDialogOpen(true)}><Pencil size={12} /> Editar roles y permisos</button>}
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
      <AnalysisCard report={report}
        pending={documentError
          ? 'No se pudo consultar el análisis documental.'
          : documents === null
            ? 'Consultando documentación…'
            : documents.length === 0
              ? 'Aún no hay documentos cargados. Sube al menos uno desde el card de documentos para que el agente lo procese.'
              : 'El análisis se dispara automáticamente al subir un módulo. Si no aparece aquí en unos segundos, reintenta la carga.'} />
    </aside>
    {envDialogOpen && <EnvironmentsDialog project={project} onClose={() => setEnvDialogOpen(false)}
      onSaved={saved => { setProject(saved); setEnvDialogOpen(false); }} />}
    {docDialogOpen && <DocumentsDialog projectId={project.id} role={role}
      onClose={() => setDocDialogOpen(false)}
      onChanged={() => setReload(value => value + 1)} />}
    {rolesDialogOpen && <RolesDialog project={project} onClose={() => setRolesDialogOpen(false)}
      onSaved={saved => { setProject(saved); setRolesDialogOpen(false); }} />}
  </div>;
}
