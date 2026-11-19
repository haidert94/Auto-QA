export const ACTIVE_RUN_STATUSES = ['QUEUED', 'RUNNING'] as const;
export const REPORTABLE_RUN_STATUSES = ['COMPLETED', 'FAILED'] as const;
export const REPORT_WHILE_RUNNING = 'El reporte estará disponible cuando finalicen las ejecuciones del proyecto.';
export const REPORT_WITHOUT_RUNS = 'El reporte estará disponible después de la primera ejecución finalizada.';

export function isReportableRunStatus(status: string) {
  return REPORTABLE_RUN_STATUSES.some(reportStatus => reportStatus === status);
}
