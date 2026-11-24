import { notFound, redirect } from 'next/navigation';
import { AppPageHeading } from '../../app-page-heading';
import { AppShell } from '../../app-shell';
import { accountFetch, requireAccount } from '../../autoqa-server';
import type { CodeHealthResult } from '../../../../api/src/quality/code-health.service';
import { CodeHealthDetail, CodeHealthOverview } from './code-health';

export const dynamic = 'force-dynamic';

export default async function CodeHealthPage() {
  const account = await requireAccount();
  if (account.canViewCodeHealth !== true) notFound();

  const response = await accountFetch('/quality/code-health', {}, { timeoutMs: 15000 }).catch(() => null);
  if (response?.status === 401) redirect('/login');
  if (response?.status === 403 || response?.status === 404) notFound();
  const data: CodeHealthResult | null = response?.ok ? await response.json().catch(() => null) : null;

  return <AppShell account={account}>
    <AppPageHeading
      title="Salud del código"
      summary="Ejecuciones de GitHub Actions y alertas de CodeQL y Dependabot."
    />
    {data?.configured ? <>
      <CodeHealthOverview data={data} />
      <section className="app-section" id="detalle">
        <header><h2><span>02 //</span> CI, CODEQL Y DEPENDABOT</h2></header>
        <CodeHealthDetail data={data} />
      </section>
    </> : <section className="app-section">
      <p className="muted">{data?.message ?? 'No se pudo consultar la salud del código.'}</p>
    </section>}
  </AppShell>;
}
