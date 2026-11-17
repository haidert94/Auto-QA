// Proxy del endpoint admin de NestJS. No añade autenticación propia:
// la protección la ejerce el backend, que exige X-Admin-Token hex de
// 64 caracteres y lo compara con AUTOQA_ADMIN_TOKEN del servidor en
// timing-safe. El token viene del cliente (nunca del env), por lo que
// quien no lo tenga no puede activar nada.
//
// La ruta existe porque server.js envía todo /api/* a Next; sin este
// proxy el endpoint admin de NestJS quedaba inalcanzable desde fuera.

import { NextResponse } from 'next/server';
import { accountFetch } from '../../../../autoqa-server';

export async function POST(request: Request) {
  const adminToken = request.headers.get('x-admin-token') ?? '';
  const type = request.headers.get('content-type') ?? 'application/json';
  try {
    const response = await accountFetch('/commerce/admin/activate', {
      method: 'POST', body: request.body, duplex: 'half',
      headers: { 'Content-Type': type, 'X-Admin-Token': adminToken },
    } as RequestInit & { duplex: 'half' }, { public: true });
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json({ message: 'No se pudo comunicar con la API de AutoQA.' }, { status: 502 });
  }
}
