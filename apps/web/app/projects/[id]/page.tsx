import { accountFetch } from '../../autoqa-server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { type Project } from '../onboarding';
import { ProjectForm } from '../project-form';

export const dynamic = 'force-dynamic';

export default async function ProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let response: Response | undefined;
  try {
    response = await accountFetch('/projects/' + encodeURIComponent(id));
  } catch {
    // The error view also covers a non-404 response from an unavailable API.
  }
  if (response?.status === 404 || response?.status === 400) notFound();
  if (!response?.ok) {
    return (
      <section className="panel">
        <p><Link href="/projects">Volver a proyectos</Link></p>
        <p className="error" role="alert">No se pudo cargar el proyecto. Comprueba que la API esté ejecutándose.</p>
      </section>
    );
  }
  const project: Project = await response.json();
  return <ProjectForm initial={project} />;
}
