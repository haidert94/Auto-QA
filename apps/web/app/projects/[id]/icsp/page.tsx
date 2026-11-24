import { notFound } from 'next/navigation';
import { accountFetch, requireAccount, type OrgRole } from '../../../autoqa-server';
import { AppPageHeading } from '../../../app-page-heading';
import { can } from '../../../permissions';
import { SnapshotButton } from './snapshot-button';

type Dimension = {
  code: 'requirementsCoverage' | 'executionCoverage' | 'stability' | 'traceability';
  label: string; weight: number; value: number;
  numerator: number; denominator: number; description: string;
};

type Gap = { kind: string; id: string; label: string; detail?: string };

type Icsp = {
  score: number;
  dimensions: Dimension[];
  gaps: {
    requirementsWithoutScenario: Gap[];
    scenariosNotExecuted: Gap[];
    unstableScenarios: Gap[];
  };
  counts: { requirements: number; scenarios: number; runs: number; results: number; passed: number; failed: number };
  window: { from: string; to: string; days: number };
  generatedAt: string;
};

type HistoryItem = { id: string; score: number | null; createdAt: string; delta: number | null; counts: unknown };

export const dynamic = 'force-dynamic';

export default async function IcspPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let current: Response | undefined;
  let history: Response | undefined;
  try {
    [current, history] = await Promise.all([
      accountFetch(`/projects/${id}/icsp`),
      accountFetch(`/projects/${id}/icsp/history`),
    ]);
  } catch {}

  if (current?.status === 404) notFound();
  if (!current?.ok) {
    return <>
      <AppPageHeading
        crumbs={[{ href: `/projects/${id}#calidad`, label: 'Calidad' }, { label: 'ICSP' }]}
        title="ICSP — Salud del Producto"
        summary="No se pudo cargar la evaluación de este proyecto."
      />
      <section className="app-section"><p className="error" role="alert">No se pudo cargar el ICSP.</p></section>
    </>;
  }

  const icsp: Icsp = await current.json();
  const historyRows: HistoryItem[] = history?.ok ? await history.json() : [];

  let role: OrgRole = 'VIEWER';
  try { role = (await requireAccount()).role; } catch {}
  const canSnapshot = can(role, 'icsp.snapshot');

  return <>
    <AppPageHeading
      back={{ href: `/projects/${id}#calidad` }}
      crumbs={[{ href: `/projects/${id}#calidad`, label: 'Calidad' }, { label: 'ICSP' }]}
      title="ICSP — Salud del Producto"
      badge={{ label: `Evaluado · ${icsp.score}/100`, tone: 'ready' }}
      summary={`Ventana de ${icsp.window.days} días. Pesos: cobertura requisitos 30%, cobertura ejecución 20%, estabilidad 30%, trazabilidad 20%. Fórmula en icsp-calculator.ts.`}
      actions={canSnapshot ? <SnapshotButton projectId={id} /> : undefined}
    />

    <section className="app-section">
      <header><h2><span>01 //</span> DIMENSIONES</h2></header>
      <ul className="ipa-signals">
        {icsp.dimensions.map(dim => {
          const pct = Math.round(dim.value * 100);
          return <li key={dim.code}>
            <div className="signal-head">
              <strong>{dim.label}</strong>
              <span className="muted">{dim.numerator} / {dim.denominator} · {pct}%</span>
              <span className="muted">(peso {dim.weight}%)</span>
            </div>
            <div className="signal-bar"><div className="signal-bar-fill" style={{ width: `${pct}%` }} /></div>
            <p className="muted">{dim.description}</p>
          </li>;
        })}
      </ul>
    </section>

    <section className="app-section">
      <header><h2><span>02 //</span> BRECHAS ACCIONABLES</h2></header>
      <GapList title="Requisitos por cubrir" gaps={icsp.gaps.requirementsWithoutScenario} empty="Todos los requisitos tienen al menos una prueba asociada." />
      <GapList title={`Escenarios sin ejecución en ${icsp.window.days}d`} gaps={icsp.gaps.scenariosNotExecuted} empty="Todos los escenarios se han ejecutado recientemente." />
      <GapList title="Escenarios inestables" gaps={icsp.gaps.unstableScenarios} empty="Ningún escenario muestra inestabilidad en la ventana." />
    </section>

    {historyRows.length > 0 && <section className="app-section">
      <header><h2><span>03 //</span> HISTÓRICO ({historyRows.length})</h2></header>
      <ol className="ipa-history">
        {historyRows.map(row => {
          const delta = row.delta === null ? '—' : (row.delta > 0 ? `+${row.delta}` : String(row.delta));
          const deltaClass = row.delta === null ? 'muted' : row.delta > 0 ? 'success' : row.delta < 0 ? 'error' : 'muted';
          return <li key={row.id}>
            <span className="history-score">{row.score ?? '—'}</span>
            <span className={`history-delta ${deltaClass}`}>{delta}</span>
            <span className="muted">{new Date(row.createdAt).toLocaleString('es-CO')}</span>
          </li>;
        })}
      </ol>
    </section>}
  </>;
}

function GapList({ title, gaps, empty }: { title: string; gaps: Gap[]; empty: string }) {
  return <div className="gap-group">
    <h3>{title} ({gaps.length})</h3>
    {gaps.length === 0
      ? <p className="muted">{empty}</p>
      : <ul className="gap-list">
        {gaps.slice(0, 50).map(g => <li key={g.id}>
          <span>{g.label}</span>
          {g.detail && <span className="muted">· {g.detail}</span>}
        </li>)}
        {gaps.length > 50 && <li className="muted">… y {gaps.length - 50} más.</li>}
      </ul>}
  </div>;
}
