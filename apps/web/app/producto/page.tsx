import type { Metadata } from 'next';
import { CommercialShell, HeroSection, WorkflowSection } from '../commercial';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Producto · AutoQA',
  description: 'Registra tu aplicación, define el alcance y revisa qué requisitos son verificables antes de automatizar.',
};

export default function ProductoPage() {
  return <CommercialShell>
    <HeroSection pricingHref="/precios"/>
    <WorkflowSection/>
  </CommercialShell>;
}
