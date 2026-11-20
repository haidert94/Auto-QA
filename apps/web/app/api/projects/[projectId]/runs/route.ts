import { failure, projectProxy } from '../../../../autoqa-server';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!uuid.test(projectId)) return failure('Proyecto no encontrado.', 404);
  const paramsIn = new URL(request.url).searchParams;
  const ids = paramsIn.get('ids');
  const view = paramsIn.get('view');
  const query = new URLSearchParams();
  if (ids !== null) query.set('ids', ids);
  else if (view === 'report' || view === 'overview') query.set('view', view);
  const search = query.size ? `?${query}` : '';
  return projectProxy(request, '/projects/' + projectId + '/runs' + search);
}
