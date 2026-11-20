import { failure, projectProxy } from '../../../../../../autoqa-server';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!uuid.test(projectId)) return failure('Recurso no encontrado.', 404);
  const url = new URL(request.url);
  const format = url.searchParams.get('format') ?? '';
  const ids = url.searchParams.get('ids') ?? '';
  const qs = new URLSearchParams();
  if (format) qs.set('format', format);
  if (ids) qs.set('ids', ids);
  const search = qs.toString();
  return projectProxy(request, '/projects/' + projectId + '/scenarios/export' + (search ? '?' + search : ''));
}
