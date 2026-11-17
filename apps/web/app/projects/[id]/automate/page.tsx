import Link from 'next/link';
import { notFound } from 'next/navigation';
import { accountFetch } from '../../../autoqa-server';
import { AutomateWizard } from './automate-wizard';

export const dynamic = 'force-dynamic';

export default async function AutomatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let project: Response | undefined;
  try { project = await accountFetch(`/projects/${id}`); } catch {}
  if (project?.status === 404) notFound();
  if (!project?.ok) {
    return <section className="panel">
      <p><Link href={`/projects/${id}`}>← Volver al proyecto</Link></p>
      <p className="error" role="alert">No se pudo cargar el proyecto.</p>
    </section>;
  }
  const data = await project.json();
  const suggestedUrl = data.environments?.[0]?.baseUrl ?? '';

  return <section className="panel">
    <p><Link href={`/projects/${id}`}>← Volver al proyecto</Link></p>
    <h1>Automatizar proyecto</h1>
    <AutomateWizard projectId={id} projectName={data.name} suggestedUrl={suggestedUrl}/>
  </section>;
}
