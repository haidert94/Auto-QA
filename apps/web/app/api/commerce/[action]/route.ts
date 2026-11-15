import { NextResponse } from 'next/server';
import { accountFetch, allowedOrigin, failure, responseCopy, sessionCookie, setting } from '../../../autoqa-server';

const actions = new Set(['login', 'register', 'verify', 'resend', 'forgot', 'reset', 'logout', 'checkout', 'simulate', 'cancel']);

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (!actions.has(action)) return failure('Ruta no encontrada.', 404);
  if (!allowedOrigin(request)) return failure('Solicitud fuera del origen de AutoQA.', 403);

  try {
    const type = request.headers.get('content-type');
    const response = await accountFetch('/commerce/' + action, {
      method: 'POST', body: request.body, duplex: 'half', headers: type ? { 'Content-Type': type } : {},
    } as RequestInit & { duplex: 'half' });
    if (!response.ok && !(action === 'logout' && response.status === 401)) return responseCopy(response);
    if (action === 'login' || action === 'logout') {
      const outgoing = NextResponse.json({ message: action === 'login' ? 'Sesión iniciada.' : 'Sesión cerrada.' },
        { headers: { 'Cache-Control': 'no-store' } });
      const data = action === 'login' ? await response.json() as { token: string; maxAge: number } : { token: '', maxAge: 0 };
      outgoing.cookies.set(sessionCookie, data.token, {
        httpOnly: true, sameSite: 'lax', secure: setting('AUTOQA_DEPLOYMENT') === 'hosted' ||
          (setting('AUTOQA_ACCOUNT_ORIGIN') ?? '').startsWith('https:'), path: '/', maxAge: data.maxAge,
      });
      return outgoing;
    }
    return responseCopy(response);
  } catch { return failure('No se pudo comunicar con la API de AutoQA.', 502); }
}
