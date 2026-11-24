import Link from 'next/link';
import { notFound } from 'next/navigation';
import { accountFetch } from '../../../autoqa-server';
import { ReportToolbar } from './report-toolbar';

type Dimension = { code: string; label: string; weight: number; value: number; numerator: number; denominator: number };
type Report = {
  generatedAt: string;
  project: { id: string; name: string; description: string | null; status: string; createdAt: string };
  analysis: { id: string; createdAt: string; warnings: string[] } | null;
  ipa: {
    score: number; status: string; denominator: number;
    documents: { declared: number; uploaded: number; processed: number; validated: number };
    verifiable: number; ambiguous: number;
    signals: Array<{ criterion: string; weight: number; points: number; available: string[]; missing: string[] }>;
    blockers: string[]; hints: string[];
  };
  icsp: {
    score: number; dimensions: Dimension[];
    counts: { requirements: number; scenarios: number; runs: number; results: number; passed: number; failed: number };
    window: { days: number; from: string; to: string };
  };
  traceability: Array<{
    requirement: { id: string; title: string; externalKey: string | null };
    scenarios: Array<{ id: string; title: string;
      lastRun: { id: string; status: string; createdAt: string; result: { status: string } | null } | null;
    }>;
  }>;
};

export const dynamic = 'force-dynamic';

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let response: Response | undefined;
  try { response = await accountFetch(`/projects/${id}/report/export`); } catch {}
  if (response?.status === 404) notFound();
  if (!response?.ok) {
    const reason = response?.status === 409 ? await response.json().catch(() => null) : null;
    return <section className="panel">
      <p><Link href={`/projects/${id}#calidad`}>← Volver</Link></p>
      <p className="error" role="alert">{typeof reason?.message === 'string' ? reason.message : 'No se pudo generar el reporte.'}</p>
    </section>;
  }
  const report: Report = await response.json();

  return <section className="panel report-panel">
    <p className="report-back"><Link href={`/projects/${id}#calidad`}>← Volver</Link></p>
    <ReportToolbar projectId={id} />

    <header className="report-header">
      <h1>Reporte de calidad · {report.project.name}</h1>
      <p className="muted">
        Generado {new Date(report.generatedAt).toLocaleString('es-CO')}.
        Estado del proyecto: {report.project.status}.
      </p>
    </header>

    <section className="report-section">
      <h2>Resumen ejecutivo</h2>
      <div className="report-summary">
        <div><strong>IPA</strong><div className="ipa-score-number ipa-assessed">{report.ipa.score}</div><p className="muted">Preparación del proyecto</p></div>
        <div><strong>ICSP</strong><div className="ipa-score-number ipa-assessed">{report.icsp.score}</div><p className="muted">Salud del producto</p></div>
      </div>
      {report.ipa.blockers.length > 0 && <div className="ipa-blockers">
        <strong>Bloqueos:</strong>
        <ul>{report.ipa.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
      </div>}
    </section>

    <section className="report-section">
      <h2>IPA — Índice de Preparación</h2>
      <ul className="ipa-signals">
        {report.ipa.signals.map((s, i) => {
          const pct = s.weight > 0 ? Math.round(100 * s.points / s.weight) : 0;
          return <li key={i}>
            <div className="signal-head">
              <strong>{s.criterion}</strong>
              <span className="muted">{s.points} / {s.weight}</span>
            </div>
            <div className="signal-bar"><div className="signal-bar-fill" style={{ width: `${pct}%` }} /></div>
            {s.available.length > 0 && <ul className="signal-available">{s.available.map((a, j) => <li key={j}>✓ {a}</li>)}</ul>}
            {s.missing.length > 0 && <ul className="signal-missing">{s.missing.map((m, j) => <li key={j}>✗ {m}</li>)}</ul>}
          </li>;
        })}
      </ul>
    </section>

    <section className="report-section">
      <h2>ICSP — Salud del Producto</h2>
      <p className="muted">Ventana: {report.icsp.window.days} días · {report.icsp.counts.requirements} requisitos · {report.icsp.counts.scenarios} escenarios · {report.icsp.counts.runs} ejecuciones · {report.icsp.counts.passed} pasaron / {report.icsp.counts.failed} fallaron.</p>
      <ul className="ipa-signals">
        {report.icsp.dimensions.map(dim => {
          const pct = Math.round(dim.value * 100);
          return <li key={dim.code}>
            <div className="signal-head">
              <strong>{dim.label}</strong>
              <span className="muted">{dim.numerator} / {dim.denominator} · {pct}%</span>
              <span className="muted">(peso {dim.weight}%)</span>
            </div>
            <div className="signal-bar"><div className="signal-bar-fill" style={{ width: `${pct}%` }} /></div>
          </li>;
        })}
      </ul>
    </section>

    <section className="report-section">
      <h2>Trazabilidad requisito → escenario → resultado</h2>
      {report.traceability.length === 0
        ? <p className="muted">Sin requisitos registrados todavía.</p>
        : <table className="trace-table">
          <thead>
            <tr>
              <th>Requisito</th>
              <th>Pruebas asociadas</th>
              <th>Último resultado</th>
            </tr>
          </thead>
          <tbody>
            {report.traceability.map(row => {
              const lastRun = row.scenarios.map(s => s.lastRun).filter(run => run !== null)
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
              const status = lastRun?.result?.status ?? lastRun?.status;
              return <tr key={row.requirement.id}>
                <td>
                  {row.requirement.externalKey && <code>[{row.requirement.externalKey}]</code>}{' '}
                  {row.requirement.title}
                </td>
                <td>
                  {row.scenarios.length === 0
                    ? <span className="muted">Por cubrir</span>
                    : <ul className="trace-scenarios">
                      {row.scenarios.map(s => <li key={s.id}>{s.title}</li>)}
                    </ul>}
                </td>
                <td>
                  {status === 'MEASURED' ? <span className="muted">Medición registrada</span>
                    : status ? <span className={`badge badge-result-${(lastRun?.result?.status ?? 'blocked').toLowerCase()}`}>{status}</span>
                    : <span className="muted">—</span>}
                </td>
              </tr>;
            })}
          </tbody>
        </table>}
    </section>
  </section>;
}
