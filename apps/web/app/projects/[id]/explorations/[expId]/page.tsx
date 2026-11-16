import Link from 'next/link';
import { notFound } from 'next/navigation';
import { accountFetch } from '../../../../autoqa-server';
import { DiffPanel } from './diff-panel';

type ExplorationPage = {
  id: string; position: number; url: string; httpStatus: number | null;
  title: string | null; screenshotKey: string | null; domSize: number | null; visitedAt: string;
};

type ExplorationLog = {
  id: string; at: string; level: 'INFO' | 'WARN' | 'ERROR'; code: string; detail: string | null;
};

type ExplorationDetail = {
  id: string; projectId: string; environmentId: string; startUrl: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED';
  queuedAt: string; startedAt: string | null; finishedAt: string | null; errorCode: string | null;
  pages: ExplorationPage[]; logs: ExplorationLog[];
};

const statusLabel: Record<ExplorationDetail['status'], string> = {
  QUEUED: 'En cola', RUNNING: 'En curso', COMPLETED: 'Completada', FAILED: 'Falló', CANCELED: 'Cancelada',
};

export const dynamic = 'force-dynamic';

export default async function ExplorationDetailPage({ params }: { params: Promise<{ id: string; expId: string }> }) {
  const { id, expId } = await params;
  let response: Response | undefined;
  try { response = await accountFetch(`/projects/${id}/explorations/${expId}`); } catch {}
  if (response?.status === 404) notFound();
  if (!response?.ok) {
    return <section className="panel">
      <p><Link href={`/projects/${id}`}>Volver al proyecto</Link></p>
      <p className="error" role="alert">No se pudo cargar la exploración.</p>
    </section>;
  }
  const detail: ExplorationDetail = await response.json();

  return <section className="panel exploration-detail">
    <p><Link href={`/projects/${id}`}>← Volver al proyecto</Link></p>
    <header>
      <h1>Exploración</h1>
      <p><span className={`badge badge-${detail.status.toLowerCase()}`}>{statusLabel[detail.status]}</span></p>
      <dl className="exploration-meta-grid">
        <div><dt>URL de inicio</dt><dd>{detail.startUrl}</dd></div>
        <div><dt>Encolada</dt><dd>{new Date(detail.queuedAt).toLocaleString('es-CO')}</dd></div>
        <div><dt>Iniciada</dt><dd>{detail.startedAt ? new Date(detail.startedAt).toLocaleString('es-CO') : '—'}</dd></div>
        <div><dt>Finalizada</dt><dd>{detail.finishedAt ? new Date(detail.finishedAt).toLocaleString('es-CO') : '—'}</dd></div>
        {detail.errorCode && <div><dt>Error</dt><dd>{detail.errorCode}</dd></div>}
      </dl>
    </header>

    <section>
      <h2>Páginas visitadas ({detail.pages.length})</h2>
      {detail.pages.length === 0
        ? <p className="muted">Aún no se registran páginas visitadas.</p>
        : <ol className="exploration-pages">
          {detail.pages.map(page => <li key={page.id}>
            <div className="page-head">
              <span className="muted">#{page.position}</span>
              {page.httpStatus !== null && <span className={`badge badge-http badge-http-${Math.floor(page.httpStatus / 100)}`}>{page.httpStatus}</span>}
              <span className="page-url">{page.url}</span>
            </div>
            {page.title && <p className="page-title">{page.title}</p>}
            <p className="muted">
              {page.domSize !== null && `DOM ${(page.domSize / 1024).toFixed(1)} KB · `}
              Visitada {new Date(page.visitedAt).toLocaleString('es-CO')}
            </p>
            {page.screenshotKey && <p>
              <img className="page-screenshot" loading="lazy"
                src={`/api/projects/${id}/explorations/${expId}/pages/${page.id}/screenshot`}
                alt={`Captura de ${page.title ?? page.url}`}/>
            </p>}
          </li>)}
        </ol>}
    </section>

    {detail.status === 'COMPLETED' && <DiffPanel projectId={id} explorationId={expId} />}

    <section>
      <h2>Eventos ({detail.logs.length})</h2>
      {detail.logs.length === 0
        ? <p className="muted">Sin eventos registrados.</p>
        : <ul className="exploration-logs">
          {detail.logs.map(log => <li key={log.id} className={`log-level-${log.level.toLowerCase()}`}>
            <span className="muted">{new Date(log.at).toLocaleTimeString('es-CO')}</span>
            <span className={`badge badge-log badge-log-${log.level.toLowerCase()}`}>{log.level}</span>
            <code>{log.code}</code>
            {log.detail && <span className="muted">{log.detail}</span>}
          </li>)}
        </ul>}
    </section>
  </section>;
}
