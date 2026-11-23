import Link from 'next/link';
import { notFound } from 'next/navigation';
import { accountFetch } from '../../../autoqa-server';
import { AppPageHeading } from '../../../app-page-heading';

import type { ScenarioInsights } from '../scenario-insights';

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
        crumbs={[{ href: `/projects/${id}#calidad`, label: 'Calidad' }, { label: 'Patrón de diseño' }]}
        title="Patrón de diseño del código"
        summary="No se pudo cargar el análisis de pasos duplicados."
      />
      <section className="app-section"><p className="error" role="alert">No se pudieron consultar las desviaciones.</p></section>
    </>;
  }
  const data: ScenarioInsights = await response.json();
  const candidates = data.groups.filter(g => g.scenarioCount >= 3);
  const deviations = data.deviationGroups ?? candidates.length;
  const borderline = data.groups.filter(g => g.scenarioCount < 3);

  return <>
    <AppPageHeading
      back={{ href: `/projects/${id}#calidad` }}
      crumbs={[{ href: `/projects/${id}#calidad`, label: 'Calidad' }, { label: 'Patrón de diseño' }]}
      title="Patrón de diseño del código"
      badge={{ label: `${deviations} desviación${deviations === 1 ? '' : 'es'}`, tone: deviations > 6 ? 'draft' : 'ready' }}
      summary={`${data.steps} pasos registrados en ${data.scenarios} escenarios · ${data.duplicatedSteps} pasos repetidos pendientes de compartir.`}
    />

    <section className="app-section">
      <header><h2><span>01 //</span> DESVIACIONES PRIORITARIAS ({deviations})</h2></header>
      {candidates.length === 0
        ? <p className="muted">No hay grupos pendientes con pasos en tres o más escenarios.</p>
        : <ol className="quality-duplicates">{candidates.map(group => <li key={group.normalized}>
          <div className="quality-duplicate-head"><strong>«{group.canonicalText}»</strong>
            <span>{group.occurrences.length} pendientes · {group.scenarioCount} escenarios en total</span></div>
          <ul>{group.occurrences.map(occurrence => <li key={`${occurrence.scenarioId}-${occurrence.ordinal}`}>
            <Link href={`/projects/${id}/scenarios/${occurrence.scenarioId}`}>{occurrence.scenarioTitle}</Link>
            <small>paso {occurrence.ordinal}: {occurrence.text}</small></li>)}</ul>
        </li>)}</ol>}
    </section>

    {borderline.length > 0 && <section className="app-section">
      <header><h2><span>02 //</span> BAJO EL UMBRAL ({borderline.length})</h2></header>
      <p className="muted">Grupos de pasos repetidos que aparecen en menos de tres escenarios.</p>
      <ol className="quality-duplicates">{borderline.map(group => <li key={group.normalized}>
        <div className="quality-duplicate-head"><strong>«{group.canonicalText}»</strong>
          <span>{group.occurrences.length} pendientes · {group.scenarioCount} escenarios en total</span></div>
        <ul>{group.occurrences.map(occurrence => <li key={`${occurrence.scenarioId}-${occurrence.ordinal}`}>
          <Link href={`/projects/${id}/scenarios/${occurrence.scenarioId}`}>{occurrence.scenarioTitle}</Link>
          <small>paso {occurrence.ordinal}: {occurrence.text}</small></li>)}</ul>
      </li>)}</ol>
    </section>}
  </>;
}
