export function QualityResultsLink({ projectId }: { projectId: string }) {
  return <a href={`/projects/${projectId}?resultados=calidad#reporte`}>Ver resultados en Reportes →</a>;
}
