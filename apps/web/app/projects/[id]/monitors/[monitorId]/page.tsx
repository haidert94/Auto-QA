import Link from 'next/link';
import { notFound } from 'next/navigation';
import { accountFetch } from '../../../../autoqa-server';
import { QualityResultsLink } from '../../quality-results-link';

type Monitor = {
  id: string; name: string; url: string; active: boolean;
  intervalMinutes: number; timeoutMs: number; notifyEmails: string[];
  environment: { id: string; baseUrl: string | null; type: string | null } | null;
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

  return <section className="panel">
    <p><Link href={`/projects/${id}/monitors`}>← Monitores</Link></p>
    <h1>{monitor.name}</h1>
    <p className="muted">
      <code>{monitor.url}</code> · cada {monitor.intervalMinutes} min · timeout {monitor.timeoutMs} ms
      {' · '}{monitor.active ? 'activo' : 'pausado'}
    </p>

    <dl className="dashboard-metrics">
      <div><dt>Alertas configuradas</dt><dd>{monitor.notifyEmails.length}</dd></div>
    </dl>
    <QualityResultsLink projectId={id} />
  </section>;
}
