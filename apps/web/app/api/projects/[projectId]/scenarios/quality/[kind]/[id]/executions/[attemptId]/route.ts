import { failure, projectProxy } from '../../../../../../../../../autoqa-server';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const kinds = new Set(['availability', 'lighthouse', 'load', 'ux']);

async function proxy(request: Request, { params }: {
  params: Promise<{ projectId: string; kind: string; id: string; attemptId: string }>;
}) {
  const { projectId, kind, id, attemptId } = await params;
  if (![projectId, id, attemptId].every(value => uuid.test(value)) || !kinds.has(kind)) {
    return failure('Ejecución no encontrada.', 404);
  }
  return projectProxy(request, `/projects/${projectId}/scenarios/quality/${kind}/${id}/executions/${attemptId}`);
}

export { proxy as GET, proxy as POST };
