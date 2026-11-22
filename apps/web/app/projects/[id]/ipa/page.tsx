import Link from 'next/link';
import { notFound } from 'next/navigation';
import { accountFetch } from '../../../autoqa-server';
import { AppPageHeading } from '../../../app-page-heading';
import { IpaHero } from '../ipa-hero';

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
    return <>
      <AppPageHeading
        crumbs={[{ href: `/projects/${id}#calidad`, label: 'Calidad' }, { label: 'IPA' }]}
        title="Evaluación IPA"
        summary="No se pudo cargar la evaluación de este proyecto."
      />
      <section className="app-section"><p className="error" role="alert">No se pudo cargar el IPA.</p></section>
    </>;
  }

  const { ipa, generatedAt }: { ipa: Ipa; analysisId: string | null; generatedAt: string } = await current.json();
  const historyRows: HistoryItem[] = history?.ok ? await history.json() : [];
  const signalsWithEvidence = ipa.signals.filter(s => s.anchors.length > 0);
  const nextIndex = (start: number) => String(start).padStart(2, '0');

  return <>
    <AppPageHeading
      back={{ href: `/projects/${id}#calidad` }}
      crumbs={[{ href: `/projects/${id}#calidad`, label: 'Calidad' }, { label: 'IPA' }]}
      title="Evaluación IPA"
      badge={{ label: ipa.status === 'ASSESSED' ? `Evaluado · ${ipa.score}/100` : 'Bloqueado', tone: ipa.status === 'ASSESSED' ? 'ready' : 'draft' }}
      summary="Índice de preparación para automatización. Reglas en readiness.ts; cada señal se calcula con su evidencia."
    />
    <section className="app-section">
      <header><h2><span>01 //</span> RESUMEN</h2></header>
      <IpaHero ipa={ipa} generatedAt={generatedAt} subtitle="Reglas en readiness.ts." />
    </section>

    {ipa.blockers.length > 0 && <section className="app-section ipa-blockers">
      <header><h2><span>02 //</span> BLOQUEOS ({ipa.blockers.length})</h2></header>
      <ul>{ipa.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
    </section>}

    {signalsWithEvidence.length > 0 && <section className="app-section signal-evidence-list">
      <header><h2><span>{nextIndex(ipa.blockers.length > 0 ? 3 : 2)} //</span> EVIDENCIA POR SEÑAL</h2></header>
      <ul className="ipa-category-list">
        {signalsWithEvidence.map((signal, i) => (
          <li key={i}>
            <strong>{signal.criterion}</strong>
            <details className="signal-anchors">
              <summary><small>Evidencia ({signal.anchors.length})</small></summary>
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
            </details>
          </li>
        ))}
      </ul>
    </section>}

    {historyRows.length > 0 && <section className="app-section">
      <header><h2><span>{nextIndex(2 + (ipa.blockers.length > 0 ? 1 : 0) + (signalsWithEvidence.length > 0 ? 1 : 0))} //</span> HISTÓRICO ({historyRows.length})</h2></header>
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
  </>;
}
