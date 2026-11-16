import type { Metadata } from 'next';
import { CommercialShell, FaqSection, WorkflowSection } from '../commercial';
import { setting } from '../autoqa-server';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Cómo funciona · AutoQA',
  description: 'Alcance, documentación y preparación: los tres pasos para que tus requisitos puedan verificarse.',
};

export default function ComoFuncionaPage() {
  const accountOrigin = setting('AUTOQA_PUBLIC_WORKSPACE_ORIGIN') ?? '';
  return <CommercialShell>
    <WorkflowSection/>
    <FaqSection accountOrigin={accountOrigin}/>
  </CommercialShell>;
}
