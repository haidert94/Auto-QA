import { failure, projectProxy } from '../../../../../../../../autoqa-server';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const kinds = new Set(['availability', 'lighthouse', 'load', 'ux']);

export async function PATCH(request: Request, { params }: {
  params: Promise<{ projectId: string; kind: string; id: string }>;
}) {
  const { projectId, kind, id } = await params;
  if (![projectId, id].every(value => uuid.test(value)) || !kinds.has(kind)) {
    return failure('Prueba no encontrada.', 404);
  }
  return projectProxy(request, `/projects/${projectId}/scenarios/quality/${kind}/${id}/configuration`);
}
