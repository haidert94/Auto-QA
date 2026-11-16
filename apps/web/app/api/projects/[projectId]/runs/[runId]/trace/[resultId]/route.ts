import { failure, projectProxy } from '../../../../../../../autoqa-server';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string; runId: string; resultId: string }> }) {
  const { projectId, runId, resultId } = await params;
  if (!uuid.test(projectId) || !uuid.test(runId) || !uuid.test(resultId)) return failure('Recurso no encontrado.', 404);
  return projectProxy(request, '/projects/' + projectId + '/runs/' + runId + '/trace/' + resultId);
}
