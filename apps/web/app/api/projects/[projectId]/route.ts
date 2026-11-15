import { failure, projectProxy } from '../../../autoqa-server';

async function forward(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(projectId)) return failure('Proyecto no encontrado.', 404);
  return projectProxy(request, '/projects/' + projectId);
}

export const GET = forward;
export const PUT = forward;
