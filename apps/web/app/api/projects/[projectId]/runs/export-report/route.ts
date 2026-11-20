import { failure, projectProxy } from '../../../../../autoqa-server';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!uuid.test(projectId)) return failure('Recurso no encontrado.', 404);
  const url = new URL(request.url);
  const ids = url.searchParams.get('ids') ?? '';
  const qs = ids ? '?ids=' + encodeURIComponent(ids) : '';
  return projectProxy(request, '/projects/' + projectId + '/runs/export-report' + qs);
}
