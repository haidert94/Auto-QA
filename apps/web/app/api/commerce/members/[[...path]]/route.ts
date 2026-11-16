import { failure, projectProxy } from '../../../../autoqa-server';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const tokenPattern = /^[a-f0-9]{64}$/;

function permitted(method: string, path: string[]): boolean {
  if (path.length === 0) return method === 'GET';
  const [first, second] = path;
  if (path.length === 1) {
    if (first === 'invite') return method === 'POST';
    if (first === 'accept') return method === 'POST';
    if (first === 'audit') return method === 'GET';
    return uuid.test(first) && method === 'DELETE';
  }
  if (path.length === 2) {
    if (first === 'invite') return second ? tokenPattern.test(second) && method === 'GET' : false;
    if (first === 'invites') return uuid.test(second) && method === 'DELETE';
    if (uuid.test(first) && second === 'role') return method === 'PATCH';
  }
  return false;
}

async function forward(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  if (!permitted(request.method, path)) return failure('Ruta no encontrada.', 404);
  const suffix = path.length ? '/' + path.join('/') : '';
  return projectProxy(request, '/commerce/members' + suffix);
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const DELETE = forward;
