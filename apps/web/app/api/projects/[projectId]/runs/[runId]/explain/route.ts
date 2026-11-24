import { failure, projectProxy } from '../../../../../../autoqa-server';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; runId: string }> }) {
  const { projectId, runId } = await params;
  if (!uuid.test(projectId) || !uuid.test(runId)) return failure('Recurso no encontrado.', 404);
  const resultId = new URL(request.url).searchParams.get('resultId');
  if (resultId !== null && !uuid.test(resultId)) return failure('Resultado inválido.', 400);
  const query = resultId ? '?resultId=' + resultId : '';
  return projectProxy(request, '/projects/' + projectId + '/runs/' + runId + '/explain' + query, false, 30000);
}
