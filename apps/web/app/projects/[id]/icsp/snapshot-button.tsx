'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function SnapshotButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function snapshot() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/projects/${projectId}/icsp/snapshot`, { method: 'POST' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.message ?? 'No se pudo guardar el snapshot.');
        return;
      }
      router.refresh();
    } catch { setError('No se pudo guardar el snapshot.'); }
    finally { setBusy(false); }
  }

  return <div>
    <button type="button" className="secondary" onClick={snapshot} disabled={busy}>
      {busy ? 'Guardando…' : 'Guardar snapshot'}
    </button>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
