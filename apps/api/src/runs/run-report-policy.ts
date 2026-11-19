export const ACTIVE_RUN_STATUSES = ['QUEUED', 'RUNNING'] as const;
export const FINAL_RUN_STATUSES = ['COMPLETED', 'FAILED', 'CANCELED'] as const;
export const REPORT_WHILE_RUNNING = 'El reporte estará disponible cuando finalicen las ejecuciones del proyecto.';
export const REPORT_WITHOUT_RUNS = 'El reporte estará disponible después de la primera ejecución finalizada.';

export function isFinalRunStatus(status: string) {
  return FINAL_RUN_STATUSES.some(finalStatus => finalStatus === status);
}
