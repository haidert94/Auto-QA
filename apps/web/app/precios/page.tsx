import type { Metadata } from 'next';
import { CommercialShell, PricingSection } from '../commercial';
import { listPlans, setting } from '../autoqa-server';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Precios · AutoQA',
  description: 'Planes en pesos colombianos según las pruebas que necesitas, con comparativa técnica de capacidades y límites.',
};

export default async function PreciosPage() {
  const plans = await listPlans();
  const accountOrigin = setting('AUTOQA_PUBLIC_WORKSPACE_ORIGIN') ?? '';
  return <CommercialShell>
    <PricingSection plans={plans} accountOrigin={accountOrigin}/>
  </CommercialShell>;
}
