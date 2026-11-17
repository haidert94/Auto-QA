import { failure, projectProxy } from '../../../../../../autoqa-server';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; runId: string }> }) {
  const { projectId, runId } = await params;
  if (!uuid.test(projectId) || !uuid.test(runId)) return failure('Recurso no encontrado.', 404);
  return projectProxy(request, '/projects/' + projectId + '/runs/' + runId + '/explain');
}
