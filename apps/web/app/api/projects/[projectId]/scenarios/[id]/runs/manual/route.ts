import { failure, projectProxy } from '../../../../../../../autoqa-server';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; id: string }> }) {
  const { projectId, id } = await params;
  if (!uuid.test(projectId) || !uuid.test(id)) return failure('Recurso no encontrado.', 404);
  return projectProxy(request, '/projects/' + projectId + '/scenarios/' + id + '/runs/manual');
}
