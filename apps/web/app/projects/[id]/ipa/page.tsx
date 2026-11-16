import Link from 'next/link';
import { notFound } from 'next/navigation';
import { accountFetch } from '../../../autoqa-server';

type Anchor = {
  kind: 'environment' | 'document' | 'version' | 'finding' | 'requirement';
  id: string;
  label: string;
  locator?: string | null;
  documentId?: string;
  versionNumber?: number;
};

type Signal = {
  criterion: string; weight: number; points: number;
  available: string[]; missing: string[];
  anchors: Anchor[]; blocking: boolean;
};

type Ipa = {
  score: number;
  status: 'ASSESSED' | 'BLOCKED';
  denominator: number;
  signals: Signal[];
  verifiable: number;
  ambiguous: number;
  documents: { declared: number; uploaded: number; processed: number; validated: number };
  recommendations: string[];
  blockers: string[];
  hints: string[];
};

type HistoryItem = {
  id: string; analysisId: string | null; score: number | null;
  status: string | null; blockers: string[]; createdAt: string; delta: number | null;
};

export const dynamic = 'force-dynamic';

function formatDelta(delta: number | null): { className: string; text: string } {
  if (delta === null) return { className: 'muted', text: '—' };
  if (delta === 0) return { className: 'muted', text: '0' };
  if (delta > 0) return { className: 'success', text: `+${delta}` };
  return { className: 'error', text: String(delta) };
}

function anchorHref(projectId: string, anchor: Anchor): string | null {
  switch (anchor.kind) {
    case 'environment': return `/projects/${projectId}`;
    case 'document': return `/projects/${projectId}/documents`;
    case 'finding':
    case 'requirement': return `/projects/${projectId}/documents`;
    default: return null;
  }
}

export default async function IpaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let current: Response | undefined;
  let history: Response | undefined;
  try {
    [current, history] = await Promise.all([
      accountFetch(`/projects/${id}/ipa`),
      accountFetch(`/projects/${id}/ipa/history`),
    ]);
  } catch {}

  if (current?.status === 404) notFound();
  if (!current?.ok) {
    return <section className="panel">
      <p><Link href={`/projects/${id}`}>← Volver al proyecto</Link></p>
      <p className="error" role="alert">No se pudo cargar el IPA.</p>
    </section>;
  }

  const { ipa, generatedAt }: { ipa: Ipa; analysisId: string | null; generatedAt: string } = await current.json();
  const historyRows: HistoryItem[] = history?.ok ? await history.json() : [];

  return <section className="panel ipa-panel">
    <p><Link href={`/projects/${id}`}>← Volver al proyecto</Link></p>
    <header className="ipa-header">
      <div>
        <h1>IPA — Índice de Preparación</h1>
        <p className="muted">
          Calculado {new Date(generatedAt).toLocaleString('es-CO')}.
          Reglas y pesos documentados en <code>readiness.ts</code>.
        </p>
      </div>
      <div className="ipa-score">
        <div className={`ipa-score-number ipa-${ipa.status.toLowerCase()}`}>{ipa.score}</div>
        <span className={`badge badge-${ipa.status === 'ASSESSED' ? 'completed' : 'failed'}`}>
          {ipa.status === 'ASSESSED' ? 'Evaluado' : 'Bloqueado'}
        </span>
      </div>
    </header>

    {ipa.blockers.length > 0 && <section className="ipa-blockers">
      <h2>Bloqueos</h2>
      <ul>{ipa.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
    </section>}

    <section>
      <h2>Señales</h2>
      <ul className="ipa-signals">
        {ipa.signals.map((signal, i) => {
          const pct = signal.weight > 0 ? Math.round(100 * signal.points / signal.weight) : 0;
          return <li key={i} className={signal.blocking && signal.points < signal.weight ? 'blocking' : ''}>
            <div className="signal-head">
              <strong>{signal.criterion}</strong>
              <span className="muted">{signal.points} / {signal.weight}</span>
              {signal.blocking && <span className="badge badge-failed">Bloqueante</span>}
            </div>
            <div className="signal-bar"><div className="signal-bar-fill" style={{ width: `${pct}%` }} /></div>
            {signal.available.length > 0 && <ul className="signal-available">
              {signal.available.map((a, j) => <li key={j}>✓ {a}</li>)}
            </ul>}
            {signal.missing.length > 0 && <ul className="signal-missing">
              {signal.missing.map((m, j) => <li key={j}>✗ {m}</li>)}
            </ul>}
            {signal.anchors.length > 0 && <details className="signal-anchors">
              <summary>Evidencia ({signal.anchors.length})</summary>
              <ul>
                {signal.anchors.map(anchor => {
                  const href = anchorHref(id, anchor);
                  const label = <>
                    <span className="anchor-kind">{anchor.kind}</span>
                    <span className="anchor-label">{anchor.label}</span>
                    {anchor.locator && <code className="anchor-locator">{anchor.locator}</code>}
                  </>;
                  return <li key={anchor.id}>{href ? <Link href={href}>{label}</Link> : label}</li>;
                })}
              </ul>
            </details>}
          </li>;
        })}
      </ul>
    </section>

    {historyRows.length > 0 && <section>
      <h2>Histórico (últimas {historyRows.length})</h2>
      <ol className="ipa-history">
        {historyRows.map(row => {
          const delta = formatDelta(row.delta);
          return <li key={row.id}>
            <span className="history-score">{row.score ?? '—'}</span>
            <span className={`history-delta ${delta.className}`}>{delta.text}</span>
            <span className="muted">{new Date(row.createdAt).toLocaleString('es-CO')}</span>
            <span className={`badge badge-${row.status === 'ASSESSED' ? 'completed' : 'failed'}`}>
              {row.status === 'ASSESSED' ? 'Evaluado' : 'Bloqueado'}
            </span>
            {row.blockers.length > 0 && <span className="muted">· {row.blockers.length} bloqueo(s)</span>}
          </li>;
        })}
      </ol>
    </section>}
  </section>;
}
