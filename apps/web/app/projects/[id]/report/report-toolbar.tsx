'use client';

export function ReportToolbar({ projectId }: { projectId: string }) {
  return <div className="report-toolbar">
    <a className="secondary button-like" href={`/api/projects/${projectId}/report/export`} download>
      Descargar JSON
    </a>
    <button type="button" className="secondary" onClick={() => window.print()}>
      Imprimir / Guardar como PDF
    </button>
  </div>;
}
