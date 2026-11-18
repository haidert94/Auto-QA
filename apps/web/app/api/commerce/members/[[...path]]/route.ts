import { NextResponse } from 'next/server';
import { accountFetch, failure, projectProxy, responseCopy, sessionCookie, setting } from '../../../../autoqa-server';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const tokenPattern = /^[a-f0-9]{64}$/;

function permitted(method: string, path: string[]): boolean {
  if (path.length === 0) return method === 'GET';
  const [first, second] = path;
  if (path.length === 1) {
    if (first === 'invite') return method === 'POST';
    if (first === 'accept') return method === 'POST';
    if (first === 'claim') return method === 'POST';
    if (first === 'audit') return method === 'GET';
    return uuid.test(first) && method === 'DELETE';
  }
  if (path.length === 2) {
    if (first === 'invite') return second ? tokenPattern.test(second) && method === 'GET' : false;
    if (first === 'invites') return uuid.test(second) && method === 'DELETE';
    if (uuid.test(first) && second === 'role') return method === 'PATCH';
    if (uuid.test(first) && second === 'projects') return method === 'PUT';
  }
  return false;
}

async function forward(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  if (!permitted(request.method, path)) return failure('Ruta no encontrada.', 404);
  const suffix = path.length ? '/' + path.join('/') : '';

  // Caso especial: POST /claim crea cuenta y abre sesión en un solo paso.
  // Reproducimos el patrón del login de /api/commerce/[action] para setear
  // la cookie httpOnly con el token devuelto por el backend.
  if (path.length === 1 && path[0] === 'claim' && request.method === 'POST') {
    const type = request.headers.get('content-type');
    try {
      const response = await accountFetch('/commerce/members/claim', {
        method: 'POST', body: request.body, duplex: 'half',
        headers: type ? { 'Content-Type': type } : {},
      } as RequestInit & { duplex: 'half' });
      if (!response.ok) return responseCopy(response);
      const data = await response.json() as { token: string; maxAge: number };
      const outgoing = NextResponse.json({ message: 'Cuenta creada y unida a la organización.' },
        { headers: { 'Cache-Control': 'no-store' } });
      outgoing.cookies.set(sessionCookie, data.token, {
        httpOnly: true, sameSite: 'lax',
        secure: setting('AUTOQA_DEPLOYMENT') === 'hosted' ||
          (setting('AUTOQA_ACCOUNT_ORIGIN') ?? '').startsWith('https:'),
        path: '/', maxAge: data.maxAge,
      });
      return outgoing;
    } catch { return failure('No se pudo comunicar con la API de AutoQA.', 502); }
  }

  return projectProxy(request, '/commerce/members' + suffix);
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
