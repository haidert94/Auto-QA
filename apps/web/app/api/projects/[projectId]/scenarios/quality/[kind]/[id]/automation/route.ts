import { failure, projectProxy } from '../../../../../../../../autoqa-server';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const kinds = new Set(['availability', 'lighthouse', 'load', 'ux']);

async function proxy(request: Request, { params }: {
  params: Promise<{ projectId: string; kind: string; id: string }>;
}) {
  const { projectId, kind, id } = await params;
  if (!uuid.test(projectId) || !kinds.has(kind) || !uuid.test(id)) {
    return failure('Prueba de calidad no encontrada.', 404);
  }
  return projectProxy(request, '/projects/' + projectId + '/scenarios/quality/' + kind + '/' + id + '/automation',
    false, request.method === 'POST' ? 30000 : undefined);
}

export { proxy as GET, proxy as POST };
