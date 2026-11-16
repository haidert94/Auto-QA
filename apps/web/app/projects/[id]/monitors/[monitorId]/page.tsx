import Link from 'next/link';
import { notFound } from 'next/navigation';
import { accountFetch } from '../../../../autoqa-server';

type Check = {
  id: string; at: string; status: string;
  httpStatus: number | null; latencyMs: number | null; errorCode: string | null;
};

type Monitor = {
  id: string; name: string; url: string; active: boolean;
  intervalMinutes: number; timeoutMs: number; notifyEmails: string[];
  lastStatus: string | null; lastLatencyMs: number | null;
  environment: { id: string; baseUrl: string | null; type: string | null } | null;
  checks: Check[];
};

export const dynamic = 'force-dynamic';

export default async function MonitorDetailPage({ params }: { params: Promise<{ id: string; monitorId: string }> }) {
  const { id, monitorId } = await params;
  let response: Response | undefined;
  try { response = await accountFetch(`/projects/${id}/monitors/${monitorId}`); } catch {}
  if (response?.status === 404) notFound();
  if (!response?.ok) {
    return <section className="panel">
      <p><Link href={`/projects/${id}/monitors`}>← Monitores</Link></p>
      <p className="error" role="alert">No se pudo cargar el monitor.</p>
    </section>;
  }
  const monitor: Monitor = await response.json();
  const upCount = monitor.checks.filter(c => c.status === 'UP').length;
  const uptime = monitor.checks.length > 0 ? Math.round(100 * upCount / monitor.checks.length) : null;

  return <section className="panel">
    <p><Link href={`/projects/${id}/monitors`}>← Monitores</Link></p>
    <h1>{monitor.name}</h1>
    <p className="muted">
      <code>{monitor.url}</code> · cada {monitor.intervalMinutes} min · timeout {monitor.timeoutMs} ms
      {' · '}{monitor.active ? 'activo' : 'pausado'}
    </p>

    <section>
      <h2>Resumen</h2>
      <dl className="dashboard-metrics">
        <div><dt>Estado actual</dt><dd>{monitor.lastStatus ?? '—'}</dd></div>
        <div><dt>Latencia</dt><dd>{monitor.lastLatencyMs ?? '—'} ms</dd></div>
        <div><dt>Uptime (últimos {monitor.checks.length})</dt><dd>{uptime === null ? '—' : uptime + ' %'}</dd></div>
        <div><dt>Alertas</dt><dd>{monitor.notifyEmails.length}</dd></div>
      </dl>
    </section>

    <section>
      <h2>Historial</h2>
      {monitor.checks.length === 0
        ? <p className="muted">Aún no hay chequeos registrados.</p>
        : <table className="trace-table">
          <thead><tr><th>Fecha</th><th>Estado</th><th>HTTP</th><th>Latencia</th><th>Error</th></tr></thead>
          <tbody>
            {monitor.checks.map(check => <tr key={check.id}>
              <td className="muted">{new Date(check.at).toLocaleString('es-CO')}</td>
              <td><span className={`badge badge-${check.status === 'UP' ? 'completed' : 'failed'}`}>{check.status}</span></td>
              <td>{check.httpStatus ?? '—'}</td>
              <td>{check.latencyMs ?? '—'} ms</td>
              <td className="muted">{check.errorCode ?? '—'}</td>
            </tr>)}
          </tbody>
        </table>}
    </section>
  </section>;
}
