import { failure, projectProxy } from '../../../../../autoqa-server';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!uuid.test(projectId)) return failure('Proyecto no encontrado.', 404);
  return projectProxy(request, '/projects/' + projectId + '/icsp/snapshot');
}
