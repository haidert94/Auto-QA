import { AppPageHeading } from '../../../app-page-heading';
import { CodeHealthDetail } from './code-health-detail';

export const dynamic = 'force-dynamic';

export default async function CodeHealthPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <>
    <AppPageHeading
      back={{ href: `/projects/${id}#calidad` }}
      crumbs={[{ href: `/projects/${id}#calidad`, label: 'Calidad' }, { label: 'Salud del código' }]}
      title="Salud del código del repositorio"
      summary="CI del workflow de GitHub Actions, alertas abiertas de CodeQL y Dependabot."
    />
    <section className="app-section">
      <header><h2><span>01 //</span> DETALLE</h2></header>
      <CodeHealthDetail />
    </section>
  </>;
}
