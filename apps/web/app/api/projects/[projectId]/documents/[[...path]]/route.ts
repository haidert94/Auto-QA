import { failure, projectProxy } from '../../../../../autoqa-server';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function permitted(method: string, path: string[]) {
  if (!path.length) return method === 'GET' || method === 'POST';
  if (path.length === 1) {
    if (path[0] === 'analysis') return method === 'GET';
    if (path[0] === 'analyze') return method === 'POST';
    return uuid.test(path[0]) && (method === 'GET' || method === 'DELETE');
  }
  return path.length === 2 && uuid.test(path[0]) && path[1] === 'validation' && method === 'PATCH';
}

async function forward(request: Request, { params }: { params: Promise<{ projectId: string; path?: string[] }> }) {
  const { projectId, path = [] } = await params;
  if (!uuid.test(projectId) || !permitted(request.method, path)) return failure('Ruta no encontrada.', 404);
  const suffix = path.length ? '/' + path.join('/') : '';
  return projectProxy(request, '/projects/' + projectId + '/documents' + suffix, true);
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const DELETE = forward;
