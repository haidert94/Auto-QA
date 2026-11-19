import { failure, projectProxy } from '../../../../autoqa-server';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!uuid.test(projectId)) return failure('Proyecto no encontrado.', 404);
  const paramsIn = new URL(request.url).searchParams;
  const ids = paramsIn.get('ids');
  const search = ids !== null ? `?${new URLSearchParams({ ids })}` : paramsIn.get('view') === 'report' ? '?view=report' : '';
  return projectProxy(request, '/projects/' + projectId + '/runs' + search);
}
