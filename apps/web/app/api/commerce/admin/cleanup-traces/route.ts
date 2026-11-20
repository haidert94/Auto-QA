// Proxy del endpoint de limpieza de evidenceKey huérfanas. El token
// X-Admin-Token viene del cliente y lo valida el backend contra
// AUTOQA_ADMIN_TOKEN (timing-safe). No añade auth propia.

import { NextResponse } from 'next/server';
import { accountFetch } from '../../../../autoqa-server';

export async function POST(request: Request) {
  const adminToken = request.headers.get('x-admin-token') ?? '';
  try {
    const response = await accountFetch('/commerce/admin/cleanup-traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
    }, { public: true });
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json({ message: 'No se pudo comunicar con la API de AutoQA.' }, { status: 502 });
  }
}
