// Alias de compatibilidad para el worker externo. La implementación real
// vive en apps/api/src/automation/pipeline-runner.ts y es consumida tanto
// por este worker como por InlineWorkerService (ejecución en-proceso en
// Hostinger). Cualquier cambio al pipeline va en ese archivo, no acá.

export { runAutomation } from '../../api/src/automation/pipeline-runner';
export type { AutomationClaim } from '../../api/src/automation/pipeline-runner';
