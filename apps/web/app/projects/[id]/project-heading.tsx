'use client';

import Link from 'next/link';
import { ArrowRight, ChevronRight, Download } from 'lucide-react';
import { statusLabels, type Project } from '../onboarding';
import { useId, useRef, useState, type ReactNode } from 'react';
import type { OrgRole } from '../../autoqa-server';
import { can } from '../../permissions';

export function ProjectHeading({ project, actions, summary, role, showScheduleButton = false, showSpecificationExport = true }: {
  project: Project; actions?: ReactNode; summary?: string; role?: OrgRole;
  showScheduleButton?: boolean; showSpecificationExport?: boolean;
}) {
  const canGenerate = can(role, 'automation.generate');
  const scheduleDialog = useRef<HTMLDialogElement>(null);
  const scheduleId = useId();
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [scheduleTimeZone, setScheduleTimeZone] = useState('');
  const scheduledAt = scheduleDate && scheduleTime ? new Date(scheduleDate + 'T' + scheduleTime) : null;

  function openSchedule() {
    setScheduleTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    scheduleDialog.current?.showModal();
  }

  function exportSpecification() {
    // Explicit projection: omit credentials, credential identities and vault references.
    const specification = {
      id: project.id, name: project.name, description: project.description, status: project.status,
      priorityModules: project.priorityModules,
      environments: project.environments.map(environment => ({
        type: environment.type, authorizationConfirmed: environment.authorizationConfirmed,
        allowedHosts: environment.allowedHosts, allowedPaths: environment.allowedPaths,
        excludedPaths: environment.excludedPaths, prohibitedActions: environment.prohibitedActions,
        readOnly: environment.readOnly,
      })),
      roles: project.roles.map(role => ({ name: role.name, description: role.description, permissions: role.permissions })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(specification, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'autoqa-especificacion.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <>
    <div className="project-breadcrumb-row">
      <nav className="project-breadcrumb" aria-label="Ruta del proyecto">
        <Link href="/projects">Proyectos</Link><ChevronRight size={11} /><span>{project.name}</span>
      </nav><span className="project-revision">Revisión {project.revision}</span>
    </div>
    <header className="project-heading">
      <div className="project-heading__identity">
        <div className="project-heading__title"><h1>{project.name}</h1></div>
        <span className={`project-status project-status--${project.status.toLowerCase()}`}><i aria-hidden="true" />{statusLabels[project.status]}</span>
        <p>{summary ?? project.description ?? 'Agrega una descripción para documentar el propósito de la aplicación.'}</p>
      </div>
      {(actions != null || showSpecificationExport || showScheduleButton || canGenerate) && <div className="project-heading__actions">
        {actions ?? <>
        {showSpecificationExport && <button type="button" className="secondary" onClick={exportSpecification}><Download size={14} /> Exportar especificación</button>}
        {showScheduleButton && <button type="button" className="secondary" aria-haspopup="dialog" aria-controls={scheduleId}
          onClick={openSchedule}>Programar ejecución</button>}
        {canGenerate && <a className="button-like" href="#automatizacion">Automatizar con IA <ArrowRight size={15} /></a>}
        </>}
      </div>}
    </header>
    {showScheduleButton && <dialog ref={scheduleDialog} id={scheduleId} className="scenario-run-dialog"
      aria-labelledby={scheduleId + '-title'} aria-describedby={scheduleId + '-description'}>
      <h2 id={scheduleId + '-title'}>Programar ejecución</h2>
      <p id={scheduleId + '-description'}>Vista previa del flujo automático.</p>
      <fieldset className="execution-schedule-timing" aria-describedby={scheduleId + '-timezone'}>
        <legend>Inicio programado</legend>
        <div className="execution-schedule-timing__fields">
          <label>Fecha<input type="date" value={scheduleDate} onChange={event => setScheduleDate(event.target.value)} /></label>
          <label>Hora<input type="time" value={scheduleTime} onChange={event => setScheduleTime(event.target.value)} /></label>
        </div>
        <p id={scheduleId + '-timezone'} className="muted">Zona horaria · {scheduleTimeZone}</p>
        {scheduledAt && <p role="status">
          {scheduledAt.getTime() > Date.now()
            ? <>Inicio previsto · <time dateTime={scheduledAt.toISOString()}>
                {Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeStyle: 'short', timeZone: scheduleTimeZone || undefined }).format(scheduledAt)}
              </time></>
            : 'Elige una fecha y una hora futuras.'}
        </p>}
      </fieldset>
      <ol className="execution-schedule-stages" aria-label="Etapas del flujo">
        <li><label className="check"><input type="checkbox" defaultChecked />Generar escenarios</label></li>
        <li><label className="check"><input type="checkbox" defaultChecked />Generar código de automatización</label></li>
        <li><label className="check"><input type="checkbox" defaultChecked />Ejecutar escenarios</label></li>
      </ol>
      <form method="dialog" className="actions">
        <button type="submit" className="secondary">Cerrar</button>
      </form>
    </dialog>}
  </>;
}
