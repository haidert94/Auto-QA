import Link from 'next/link';
import { notFound } from 'next/navigation';
import { accountFetch } from '../../../autoqa-server';
import { AppPageHeading } from '../../../app-page-heading';

type StepOccurrence = { scenarioId: string; scenarioTitle: string; ordinal: number; text: string };
type DuplicateGroup = { normalized: string; canonicalText: string; occurrences: StepOccurrence[]; scenarioCount: number };
type ScenarioInsights = {
  scenarios: number; steps: number; duplicateGroups: number; duplicatedSteps: number; groups: DuplicateGroup[];
};

export const dynamic = 'force-dynamic';

export default async function PageObjectsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let response: Response | undefined;
  try { response = await accountFetch(`/projects/${id}/scenarios/insights`); } catch {}
  if (response?.status === 404) notFound();
  if (!response?.ok) {
    return <>
      <AppPageHeading
        back={{ href: `/projects/${id}#calidad` }}
        crumbs={[{ href: `/projects/${id}#calidad`, label: 'Calidad' }, { label: 'Candidatos a Page Object' }]}
        title="Candidatos a Page Object"
        summary="No se pudo cargar el análisis de pasos duplicados."
      />
      <section className="app-section"><p className="error" role="alert">No se pudieron consultar los candidatos.</p></section>
    </>;
  }
  const data: ScenarioInsights = await response.json();
  const candidates = data.groups.filter(g => g.occurrences.length >= 3);
  const borderline = data.groups.filter(g => g.occurrences.length < 3);

  return <>
    <AppPageHeading
      back={{ href: `/projects/${id}#calidad` }}
      crumbs={[{ href: `/projects/${id}#calidad`, label: 'Calidad' }, { label: 'Candidatos a Page Object' }]}
      title="Candidatos a Page Object"
      badge={{ label: `${candidates.length} con 3+ repeticiones`, tone: candidates.length > 6 ? 'draft' : 'ready' }}
      summary={`${data.steps} pasos registrados en ${data.scenarios} escenarios · ${data.duplicatedSteps} ocurrencias en grupos repetidos. Los grupos con 3+ repeticiones son candidatos a extraer como helper compartido para que un cambio de selector afecte un solo archivo.`}
    />

    <section className="app-section">
      <header><h2><span>01 //</span> CANDIDATOS PRIORITARIOS ({candidates.length})</h2></header>
      {candidates.length === 0
        ? <p className="muted">Sin patrones con 3 o más repeticiones. No hay refactor urgente que proponer.</p>
        : <ol className="quality-duplicates">{candidates.map(group => <li key={group.normalized}>
          <div className="quality-duplicate-head"><strong>«{group.canonicalText}»</strong>
            <span>{group.occurrences.length}× · {group.scenarioCount} escenarios</span></div>
          <ul>{group.occurrences.map(occurrence => <li key={`${occurrence.scenarioId}-${occurrence.ordinal}`}>
            <Link href={`/projects/${id}/scenarios/${occurrence.scenarioId}`}>{occurrence.scenarioTitle}</Link>
            <small>paso {occurrence.ordinal}: {occurrence.text}</small></li>)}</ul>
        </li>)}</ol>}
    </section>

    {borderline.length > 0 && <section className="app-section">
      <header><h2><span>02 //</span> BAJO EL UMBRAL ({borderline.length})</h2></header>
      <p className="muted">Grupos con 2 repeticiones. Hoy no cuentan como candidato, pero conviene revisarlos si el escenario crece.</p>
      <ol className="quality-duplicates">{borderline.map(group => <li key={group.normalized}>
        <div className="quality-duplicate-head"><strong>«{group.canonicalText}»</strong>
          <span>{group.occurrences.length}× · {group.scenarioCount} escenarios</span></div>
        <ul>{group.occurrences.map(occurrence => <li key={`${occurrence.scenarioId}-${occurrence.ordinal}`}>
          <Link href={`/projects/${id}/scenarios/${occurrence.scenarioId}`}>{occurrence.scenarioTitle}</Link>
          <small>paso {occurrence.ordinal}: {occurrence.text}</small></li>)}</ul>
      </li>)}</ol>
    </section>}
  </>;
}
