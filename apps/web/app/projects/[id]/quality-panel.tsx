'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { ArrowRight, Download, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Project } from '../onboarding';
import { ProjectHeading } from './project-heading';
import { useQualityHeader } from './project-tabs';
import { hasRunActivity, readRunActivity, useReportActivity } from './run-activity';
import { REPORT_WHILE_RUNNING, REPORT_WITHOUT_RUNS } from '../../../../api/src/runs/run-report-policy';
import { levelFor, type IpaSummary } from './ipa-hero';
import { dateText, durationText, runLabels } from './run-report-data';
import { useScenarioInsights } from './scenario-insights';
import { CodeHealthCard } from './code-health';
import { IcspGapModal } from './icsp-gap-modal';
import { LighthouseDetailModal, type LighthouseCategory } from './quality-detail-modal';

type IcspGapKind = 'requirementsWithoutScenario' | 'scenariosNotExecuted' | 'unstableScenarios';

type Ipa = IpaSummary & {
  documents?: { declared: number; uploaded: number; processed: number; validated: number };
  verifiable?: number; ambiguous?: number; blockers?: string[]; hints?: string[]; recommendations?: string[];
};
type Icsp = {
  score: number; generatedAt?: string;
  dimensions: { code: string; label: string; value: number; weight: number; numerator: number; denominator: number; description?: string }[];
  counts: { requirements: number; scenarios: number; runs: number; results: number; passed: number; failed: number };
  window: { days: number; from: string; to: string };
  gaps: Record<'requirementsWithoutScenario' | 'scenariosNotExecuted' | 'unstableScenarios', { id: string; label: string; detail?: string }[]>;
};
type Assessment = { id: string; score: number | null; createdAt: string; delta: number | null };
type Audit = { id: string; status: keyof typeof runLabels; createdAt: string; completedAt: string | null;
  performanceScore: number | null; accessibilityScore: number | null; bestPracticesScore: number | null; seoScore: number | null;
  lcpMs: number | null; fcpMs: number | null; tbtMs: number | null; cls: number | null };
type Data<T> = { value: T | null; error: string; loading: boolean };
const pending = <T,>(): Data<T> => ({ value: null, error: '', loading: true });

export function Score({ value, label }: { value: number | null; label: string }) {
  return <div className={`quality-score-ring${value === null ? ' quality-score-ring--empty' : ''}`} role="img" aria-label={`${label}: ${value === null ? 'sin evaluación' : `${value} de 100`}`}
    style={{ '--quality-progress': `${Math.max(0, Math.min(100, value ?? 0)) * 3.6}deg` } as CSSProperties}>
    <strong>{value ?? '—'}</strong><small>/ 100</small>
  </div>;
}
export function EvaluationCard({ index, title, badge, children }: { index: string; title: string; badge: string; children: ReactNode }) {
  return <section className="quality-evaluation" aria-label={title}><header><h2><span>{index} //</span> {title}</h2><span className="quality-badge">{badge}</span></header>{children}</section>;
}

export function QualityPanel({ project }: { project: Project }) {
  const header = useQualityHeader();
  const activity = useReportActivity(project.id, !!header?.active);
  const [ipa, setIpa] = useState<Data<{ ipa: Ipa; generatedAt?: string }>>(pending);
  const [icsp, setIcsp] = useState<Data<Icsp>>(pending);
  const [ipaHistory, setIpaHistory] = useState<Data<Assessment[]>>(pending);
  const [icspHistory, setIcspHistory] = useState<Data<Assessment[]>>(pending);
  const [audits, setAudits] = useState<Data<Audit[]>>(pending);
  const [refresh, setRefresh] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [gapOpen, setGapOpen] = useState<IcspGapKind | null>(null);
  const [lighthouseOpen, setLighthouseOpen] = useState<LighthouseCategory | null>(null);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const insights = useScenarioInsights(project.id, !!header?.active, refresh);

  useEffect(() => {
    if (!header?.active) return;
    const controller = new AbortController();
    setIpa(pending()); setIcsp(pending()); setIpaHistory(pending()); setIcspHistory(pending()); setAudits(pending());
    async function read(path: string) {
      const response = await fetch(`/api/projects/${project.id}${path}`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
      if (!response.ok) throw new Error(response.status === 403 ? 'Consulta no autorizada o no incluida en el plan.' : 'No se pudo consultar esta evaluación.');
      const value = await response.json();
      const score = (number: unknown) => typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 100;
      const valid = path === '/ipa' ? score(value?.ipa?.score) && ['ASSESSED', 'BLOCKED'].includes(value.ipa.status) && Array.isArray(value.ipa.signals)
        : path === '/icsp' ? score(value?.score) && Array.isArray(value.dimensions) && typeof value.counts?.results === 'number'
          && typeof value.window?.days === 'number' && ['requirementsWithoutScenario', 'scenariosNotExecuted', 'unstableScenarios'].every(key => Array.isArray(value.gaps?.[key]))
        : Array.isArray(value);
      if (!valid) throw new Error('La API no devolvió una evaluación válida.');
      return value;
    }
    Promise.allSettled([read('/ipa'), read('/icsp'), read('/ipa/history'), read('/icsp/history'), read('/audits')]).then(results => {
      if (controller.signal.aborted) return;
      const state = <T,>(index: number): Data<T> => {
        const result = results[index];
        return result.status === 'fulfilled' ? { value: result.value as T, error: '', loading: false }
          : { value: null, error: result.reason instanceof Error ? result.reason.message : 'Consulta no disponible.', loading: false };
      };
      setIpa(state(0)); setIcsp(state(1)); setIpaHistory(state(2)); setIcspHistory(state(3)); setAudits(state(4));
    });
    return () => controller.abort();
  }, [project.id, header?.active, refresh, activity.waiting, activity.historyVersion]);

  useEffect(() => {
    if (!header?.active) return;

    function closeOnOutside(event: PointerEvent) {
      const menu = exportMenu.current;
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false;
    }

    function closeOnEscape(event: KeyboardEvent) {
      const menu = exportMenu.current;
      if (event.key !== 'Escape' || !menu?.open) return;
      const restoreFocus = menu.contains(document.activeElement);
      menu.open = false;
      if (restoreFocus) menu.querySelector('summary')?.focus();
    }

    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
      if (exportMenu.current) exportMenu.current.open = false;
    };
  }, [header?.active]);

  async function exportJson() {
    if (exporting || !canGenerate) return;
    setExporting(true); setExportError('');
    try {
      const response = await fetch(`/api/projects/${project.id}/report/export`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        const reason = response.status === 409 ? await response.json().catch(() => null) : null;
        throw new Error(typeof reason?.message === 'string' ? reason.message : 'No se pudo exportar el informe de calidad.');
      }
      const report = await response.json();
      if (report?.project?.id !== project.id || !report.ipa || !report.icsp) throw new Error('El servidor no devolvió un informe válido de este proyecto.');
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'autoqa-informe-calidad.json'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setExportError(reason instanceof Error ? reason.message : 'No se pudo exportar.'); }
    finally { setExporting(false); }
  }

  const preparation = ipa.value?.ipa;
  const level = preparation ? levelFor(preparation.score, preparation.status) : null;
  const health = icsp.value;
  const hasResults = !!health && health.counts.results > 0;
  const loading = ipa.loading || icsp.loading;
  const hasRuns = !!health?.counts.runs;
  const canGenerate = activity.verified && !activity.waiting && !loading && !!preparation && hasRuns;
  const exportNotice = activity.waiting ? REPORT_WHILE_RUNNING
    : activity.statusMessage || (!loading && health && !hasRuns ? REPORT_WITHOUT_RUNS : '');
  const completedAudit = audits.value?.find(audit => audit.status === 'COMPLETED');
  const lastAudit = audits.value?.[0];

  async function printReport() {
    if (!canGenerate || exporting) return;
    setExporting(true);
    setExportError('');
    try {
      if (hasRunActivity(await readRunActivity(project.id))) {
        setExportError(REPORT_WHILE_RUNNING);
        return;
      }
      window.print();
    } catch {
      setExportError('No se pudo confirmar el estado de las ejecuciones.');
    } finally {
      setExporting(false);
    }
  }

  return <section className="quality-panel" aria-label="Calidad del proyecto">
    {header?.element && createPortal(<ProjectHeading project={project}
      summary="Evaluación de preparación (IPA), salud del producto (ICSP) y auditorías registradas. Consulta las fuentes y los datos pendientes antes de interpretar los indicadores."
      actions={<><details ref={exportMenu} className="quality-export"><summary><Download size={14} />Exportar informe</summary><div>
        <button type="button" disabled={exporting || !canGenerate} onClick={() => void exportJson()}>{exporting ? 'Exportando…' : 'Descargar informe JSON'}</button>
        <button type="button" disabled={exporting || !canGenerate} onClick={() => void printReport()}>Imprimir / Guardar como PDF</button>
        {canGenerate && <Link href={`/projects/${project.id}/report`}>Abrir informe consolidado</Link>}
        {exportNotice && <small>{exportNotice}</small>}</div></details>
        <Link className="button-like" href={`/projects/${project.id}/performance`}>Configurar auditoría <ArrowRight size={14} /></Link></>} />, header.element)}
    {exportError && <p className="quality-message error" role="alert">{exportError}</p>}
    <div className="quality-update"><p>Los índices se consultan con la información registrada. Actualizar no inicia pruebas ni auditorías externas.</p>
      <button type="button" className="secondary" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={13} />Actualizar evaluación</button></div>
    <div className="quality-grid">
      <EvaluationCard index="01" title="Índice de Preparación para Automatización (IPA)" badge={level ? `Nivel: ${level.label} (${preparation?.score}/100)` : ipa.loading ? 'Consultando' : 'Sin evaluación'}>
        {ipa.loading ? <p className="quality-message" role="status">Consultando IPA…</p> : ipa.error ? <div className="quality-message" role="alert"><p className="error">{ipa.error}</p><button type="button" className="secondary" onClick={() => setRefresh(value => value + 1)}>Reintentar IPA</button></div>
          : preparation && <div className="quality-evaluation__body"><div className="quality-score-summary"><Score label="IPA" value={preparation.score} /><div><h3>{level?.headline}</h3>
            {typeof preparation.verifiable === 'number' && <p>{preparation.verifiable} requisitos verificables · {preparation.ambiguous ?? 'Sin dato'} ambiguos o pendientes.</p>}
            {ipa.value?.generatedAt && <small>Evaluado: {dateText(ipa.value.generatedAt)}</small>}
            {preparation.blockers?.length ? <p className="quality-blocked">{preparation.blockers.length} bloqueos registrados.</p> : preparation.status === 'BLOCKED' && <p className="quality-blocked">La evaluación informa un bloqueo.</p>}
          </div></div><ol className="quality-dimensions">{preparation.signals.map((signal, i) => <li key={i}>
            <div><strong>{i + 1}. {signal.criterion}</strong><span>{signal.weight > 0 ? `${Math.round(100 * signal.points / signal.weight)}%` : 'No aplica'} <small>({signal.points}/{signal.weight})</small></span></div>
            {signal.weight > 0 && <div className="quality-progress"><span style={{ width: `${Math.max(0, Math.min(100, 100 * signal.points / signal.weight))}%` }} /></div>}
          </li>)}</ol>
          {preparation.documents && <dl className="quality-document-counts">{Object.entries(preparation.documents).map(([key, count]) => <div key={key}><dt>{({ declared: 'Declarados', uploaded: 'Cargados', processed: 'Procesados', validated: 'Validados' } as Record<string, string>)[key]}</dt><dd>{count}</dd></div>)}</dl>}
          {preparation.blockers?.length ? <div className="quality-attention"><strong>Bloqueos</strong><ul>{preparation.blockers.map((item, i) => <li key={i}>{item}</li>)}</ul></div> : null}
          <Link className="quality-detail-link" href={`/projects/${project.id}/ipa`}>Ver evaluación IPA y sus fuentes →</Link></div>}
      </EvaluationCard>
      <EvaluationCard index="02" title="Índice Compuesto de Salud del Producto (ICSP)" badge={health ? hasResults ? `Evaluado (${health.score}/100)` : 'Sin resultados de ejecución' : icsp.loading ? 'Consultando' : 'Sin evaluación'}>
        {icsp.loading ? <p className="quality-message" role="status">Consultando ICSP…</p> : icsp.error ? <div className="quality-message" role="alert"><p className="error">{icsp.error}</p><button type="button" className="secondary" onClick={() => setRefresh(value => value + 1)}>Reintentar ICSP</button></div>
          : health && <div className="quality-evaluation__body"><div className="quality-score-summary"><Score label="ICSP" value={hasResults ? health.score : null} /><div>
            <h3>{hasResults ? 'Evaluación calculada con los resultados registrados.' : 'Aún no hay resultados para evaluar la salud del producto.'}</h3>
            <p>{health.counts.runs} ejecuciones · {health.counts.results} resultados · ventana de {health.window.days} días.</p>
            <small>{health.counts.passed} aprobados · {health.counts.failed} fallidos</small>
            {health.generatedAt && <small>Calculado: {dateText(health.generatedAt)}</small>}
          </div></div><ol className="quality-dimensions">{health.dimensions.map((dimension, i) => <li key={dimension.code}>
            <div><strong>{i + 1}. {dimension.label}</strong><span>{dimension.denominator > 0 ? `${Math.round(100 * dimension.value)}%` : 'Sin datos'} <small>({dimension.numerator}/{dimension.denominator})</small></span></div>
            <div className="quality-progress"><span style={{ width: `${dimension.denominator > 0 ? Math.max(0, Math.min(100, dimension.value * 100)) : 0}%` }} /></div>
          </li>)}</ol>
          <dl className="quality-document-counts quality-gap-counts">{([
            ['requirementsWithoutScenario', 'Requisitos sin escenario'],
            ['scenariosNotExecuted', 'Escenarios sin ejecución'],
            ['unstableScenarios', 'Escenarios inestables'],
          ] as const).map(([key, title]) => <button key={key} type="button"
            className="quality-gap-count" onClick={() => setGapOpen(key)}
            aria-label={`Abrir detalle de ${title}`}>
            <dt>{title}</dt><dd>{health.gaps[key].length}</dd>
          </button>)}</dl>
          <Link className="quality-detail-link" href={`/projects/${project.id}/icsp`}>Ver dimensiones e histórico de ICSP →</Link></div>}
      </EvaluationCard>
    </div>
    {(() => {
      // Tarjeta 03: patrones de pasos que aparecen ≥ 3 veces son candidatos
      // reales a extraer como page object compartido. El score mide cuántos
      // candidatos quedan pendientes: menos = mejor (ya consolidados o pocos
      // flujos). Más = oportunidad fuerte de refactor para evitar tener que
      // tocar múltiples specs cuando cambia un selector.
      const data = insights.data;
      const candidates = data ? data.groups.filter(group => group.occurrences.length >= 3) : [];
      const candidateOccurrences = candidates.reduce((sum, group) => sum + group.occurrences.length, 0);
      const score = !data ? null
        : candidates.length === 0 ? 100
        : candidates.length <= 2 ? 85
        : candidates.length <= 6 ? 65
        : Math.max(30, 65 - (candidates.length - 6) * 3);
      const level = score === null ? null
        : score >= 95 ? 'ÓPTIMO'
        : score >= 80 ? 'ACEPTABLE'
        : score >= 55 ? 'ALTO POTENCIAL'
        : 'CRÍTICO';
      const badge = insights.loading ? 'Consultando' : level ? `${level} · ${candidates.length} candidato${candidates.length === 1 ? '' : 's'}` : 'Sin evaluación';
      const headline = !data ? 'Sin pasos registrados aún.'
        : candidates.length === 0 ? 'Sin patrones repetidos: nada que extraer a helpers hoy.'
        : candidates.length <= 2 ? 'Pocos patrones reutilizables. Consolidarlos es un refactor opcional.'
        : candidates.length <= 6 ? 'Hay varios patrones listos para extraer a page objects — evitas tocar múltiples specs si cambia un selector.'
        : 'Muchos patrones repetidos sin consolidar. Un cambio de selector hoy obligaría a editar muchos archivos.';
      const topCandidates = candidates.slice(0, 4);
      return <EvaluationCard index="03" title="Candidatos a Page Object" badge={badge}>
        {insights.loading ? <p className="quality-message" role="status">Analizando pasos…</p>
          : insights.error ? <p className="quality-message muted">{insights.error}</p>
          : !data ? null
          : <div className="quality-evaluation__body">
            <div className="quality-score-summary"><Score label="Consolidación" value={score} /><div>
              <h3>{headline}</h3>
              <p>{data.steps} pasos registrados · {candidates.length} patrones aparecen 3+ veces · {candidateOccurrences} ocurrencias en total.</p>
              <small>Un patrón candidato es un paso idéntico (o casi) en 3 o más escenarios: extraerlo a un helper reduce el blast-radius de un cambio en la página.</small>
            </div></div>
            {topCandidates.length > 0 && <ol className="quality-dimensions">{topCandidates.map((group, i) => {
              const pct = candidateOccurrences > 0 ? Math.round(100 * group.occurrences.length / candidateOccurrences) : 0;
              return <li key={group.normalized}>
                <div><strong>{i + 1}. «{group.canonicalText}»</strong>
                  <span>{group.occurrences.length}× <small>({group.scenarioCount} escenarios)</small></span></div>
                <div className="quality-progress"><span style={{ width: `${Math.max(4, pct)}%` }} /></div>
              </li>;
            })}</ol>}
            {candidates.length === 0 && data.groups.length > 0 && <p className="muted">Hay {data.groups.length} grupo{data.groups.length === 1 ? '' : 's'} con 2 repeticiones — bajo el umbral de 3, no cuentan como candidato.</p>}
            {candidates.length === 0 && data.groups.length === 0 && <p className="muted">Sin grupos duplicados. Buen trabajo.</p>}
            {data.groups.length > 0 && <details className="quality-detail-reveal"><summary>Ver todos los candidatos y sus escenarios →</summary>
              <ol className="quality-duplicates">{data.groups.map(group => <li key={group.normalized}>
                <div className="quality-duplicate-head"><strong>«{group.canonicalText}»</strong>
                  <span>{group.occurrences.length}× · {group.scenarioCount} escenarios {group.occurrences.length >= 3 && <em className="muted">· candidato a page object</em>}</span></div>
                <ul>{group.occurrences.map(occurrence => <li key={`${occurrence.scenarioId}-${occurrence.ordinal}`}>
                  <Link href={`/projects/${project.id}/scenarios/${occurrence.scenarioId}`}>{occurrence.scenarioTitle}</Link>
                  <small>paso {occurrence.ordinal}: {occurrence.text}</small></li>)}</ul>
              </li>)}</ol>
            </details>}
          </div>}
      </EvaluationCard>;
    })()}
    {(() => {
      // Tarjeta 04 con el mismo patrón visual que IPA/ICSP: anillo con score
      // consolidado (promedio ponderado), headline con el nivel, badge en el
      // header, barras por dimensión (las 4 tarjetas de Lighthouse se
      // mantienen clicables para ver la explicación por categoría) y el
      // enlace a la página standalone al final.
      const scores = completedAudit ? [completedAudit.performanceScore, completedAudit.accessibilityScore, completedAudit.bestPracticesScore, completedAudit.seoScore].filter((n): n is number => typeof n === 'number') : [];
      const lhScore = scores.length ? Math.round(scores.reduce((sum, n) => sum + n, 0) / scores.length) : null;
      const lhLevel = lhScore === null ? null
        : lhScore >= 90 ? 'ÓPTIMO'
        : lhScore >= 70 ? 'ACEPTABLE'
        : lhScore >= 50 ? 'MEJORABLE'
        : 'CRÍTICO';
      const lhBadge = audits.loading ? 'Consultando' : completedAudit ? `${lhLevel} · ${lhScore}/100` : 'Sin evaluación';
      const lhHeadline = !completedAudit ? 'No hay auditorías Lighthouse completadas.'
        : lhScore === null ? 'Sin puntajes registrados aún.'
        : lhScore >= 90 ? 'Performance y calidad frontend óptimas.'
        : lhScore >= 70 ? 'Buen nivel con margen de mejora en alguna dimensión.'
        : lhScore >= 50 ? 'Varias dimensiones requieren atención.'
        : 'Alta deuda frontend: prioriza las dimensiones con score bajo.';
      return <EvaluationCard index="04" title="Auditorías Lighthouse" badge={lhBadge}>
        {audits.loading ? <p className="quality-message" role="status">Consultando auditorías…</p>
          : audits.error ? <p className="quality-message muted">{audits.error}</p>
          : !completedAudit ? <p className="quality-message muted">No hay auditorías Lighthouse completadas. Puedes configurar una auditoría con su entorno y alcance autorizados.</p>
          : <div className="quality-evaluation__body">
            <div className="quality-score-summary"><Score label="Lighthouse" value={lhScore} /><div>
              <h3>{lhHeadline}</h3>
              <p>{lastAudit && <>Última solicitud: {runLabels[lastAudit.status]} · {dateText(lastAudit.createdAt)}. </>}
                LCP: {durationText(completedAudit.lcpMs)} · TBT: {durationText(completedAudit.tbtMs)} · CLS: {completedAudit.cls ?? 'No disponible'}.</p>
              <small>Completada: {dateText(completedAudit.completedAt)}</small>
            </div></div>
            <div className="quality-audit-values">{([
              ['performance', 'performanceScore', 'Performance'],
              ['accessibility', 'accessibilityScore', 'Accesibilidad'],
              ['bestPractices', 'bestPracticesScore', 'Buenas prácticas'],
              ['seo', 'seoScore', 'SEO'],
            ] as const).map(([cat, key, label]) => <button key={key} type="button"
              className="quality-audit-card" onClick={() => setLighthouseOpen(cat)}
              aria-label={`Abrir explicación de ${label}`}>
              <span>{label}</span><strong>{completedAudit[key] ?? '—'}<small>/100</small></strong>
            </button>)}</div>
            <Link className="quality-detail-link" href={`/projects/${project.id}/performance`}>Ver auditorías y configuración →</Link>
          </div>}
      </EvaluationCard>;
    })()}
    <CodeHealthCard active={!!header?.active} />
    <div className="quality-history-grid">{([{ title: 'Histórico IPA', data: ipaHistory }, { title: 'Histórico ICSP', data: icspHistory }]).map(({ title, data }) => <section className="quality-history" key={title} aria-label={title}>
      <h2>{title}</h2>{data.loading ? <p>Consultando histórico…</p> : data.error ? <p className="muted">{data.error}</p> : !data.value?.length ? <p>Sin evaluaciones guardadas.</p>
        : <ol>{data.value.slice(0, 3).map(item => <li key={item.id}><strong>{item.score ?? '—'}</strong><span>{dateText(item.createdAt)}</span><small>Variación: {item.delta === null ? 'Sin comparación' : item.delta > 0 ? `+${item.delta}` : item.delta}</small></li>)}</ol>}</section>)}</div>
    <nav className="quality-tools" aria-label="Otras herramientas de calidad"><Link href={`/projects/${project.id}/report`}>Reporte consolidado</Link><Link href={`/projects/${project.id}/performance`}>Performance · Lighthouse</Link>
      <Link href={`/projects/${project.id}/load`}>Carga controlada</Link><Link href={`/projects/${project.id}/monitors`}>Monitores</Link></nav>
    {gapOpen && health && <IcspGapModal projectId={project.id}
      kind={gapOpen}
      title={({ requirementsWithoutScenario: 'Requisitos sin escenario', scenariosNotExecuted: 'Escenarios sin ejecución', unstableScenarios: 'Escenarios inestables' } as Record<string, string>)[gapOpen]}
      items={health.gaps[gapOpen]} onClose={() => setGapOpen(null)} />}
    {lighthouseOpen && completedAudit && <LighthouseDetailModal projectId={project.id}
      category={lighthouseOpen} audit={completedAudit} onClose={() => setLighthouseOpen(null)} />}
  </section>;
}
