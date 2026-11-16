import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AccountForm, BillingForm, Logout } from '../account-forms';
import { accountFetch, activeStatuses, listPlans, requireAccount } from '../autoqa-server';
import { CommercialShell } from '../commercial';
import { UsageSummary } from '../usage-summary';

const flows = {
  registro: ['Crear cuenta', 'register'], login: ['Iniciar sesión', 'login'], verificar: ['Verificar correo', 'verify'],
  recuperar: ['Recuperar acceso', 'forgot'], restablecer: ['Restablecer contraseña', 'reset'], reenviar: ['Reenviar verificación', 'resend'],
} as const;
const legal = {
  terminos: ['Condiciones de evaluación local', 'Esta versión permite evaluar AutoQA en un entorno local con aplicaciones autorizadas y datos sintéticos. Los planes y precios son propuestas y la contratación es simulada. Las condiciones comerciales, impuestos aplicables y límites definitivos se comunicarán antes del lanzamiento.'],
  privacidad: ['Privacidad y tratamiento de datos', 'La evaluación local guarda el nombre, correo, organización, registros de aceptación y datos de uso en la instalación. La contraseña se guarda como un valor derivado. Los archivos permanecen en almacenamiento privado. Usa datos sintéticos durante esta evaluación. La política del servicio comercial se publicará antes del lanzamiento.'],
  contacto: ['Contacto', 'El canal de atención comercial se publicará cuando AutoQA abra la contratación del servicio.'],
} as const;

export async function generateMetadata({ params }: { params: Promise<{ flow: string }> }): Promise<Metadata> {
  const { flow } = await params;
  const title = flows[flow as keyof typeof flows]?.[0] ?? legal[flow as keyof typeof legal]?.[0] ?? 'AutoQA';
  const index = Object.hasOwn(legal, flow) || flow === 'estado';
  return { title: title + ' · AutoQA', robots: { index, follow: true } };
}

function Shell({ children }: { children: React.ReactNode }) {
  return <CommercialShell>
    <div className="wrap commercial-auth-wrap"><section className="commercial-auth">{children}</section></div>
  </CommercialShell>;
}

export default async function Page({ params, searchParams }: {
  params: Promise<{ flow: string }>; searchParams: Promise<{ plan?: string }>;
}) {
  const { flow } = await params;
  if (Object.hasOwn(flows, flow)) {
    const [title, mode] = flows[flow as keyof typeof flows];
    const { plan } = await searchParams;
    return <Shell><h1>{title}</h1>
      {mode === 'register' && <p>Elige un plan y verifica tu correo para continuar con la contratación de prueba.</p>}
      <AccountForm mode={mode} plan={plan} plans={mode === 'register' ? await listPlans() : []}/></Shell>;
  }
  if (Object.hasOwn(legal, flow)) {
    const [title, body] = legal[flow as keyof typeof legal];
    return <Shell><h1 id="datos">{title}</h1><p>{body}</p></Shell>;
  }
  if (flow === 'estado') {
    let status = false;
    try { status = (await accountFetch('/commerce/plans', {}, { public: true })).ok; } catch {}
    return <Shell><h1>Estado del servicio</h1>
      <p>{status ? 'El catálogo de esta instalación responde.' : 'El catálogo de esta instalación no responde en este momento.'}</p></Shell>;
  }
  if (['dashboard', 'billing', 'settings'].includes(flow)) {
    const account = await requireAccount();
    if (flow === 'dashboard' && !activeStatuses.includes(account.subscription.status)) redirect('/billing');
    return <Shell>
      {flow === 'billing' ? <><h1>Facturación</h1><p>{account.organization.name}</p><BillingForm account={account} plans={await listPlans()}/><UsageSummary/></> :
        flow === 'settings' ? <><h1>Mi cuenta</h1><p>{account.name} · {account.email}</p><p>Organización · {account.organization.name}</p></> :
          <><h1>Dashboard</h1><p>{account.organization.name} · Plan {account.subscription.plan?.name}</p>
            <p>Registra y administra tus proyectos, entornos y documentación.</p>
            <div className="actions"><Link className="button primary" href="/projects">Ver proyectos</Link>
              <Link className="button outline" href="/projects/new">Registrar aplicación</Link></div></>}
      <p><Link href="/billing">Facturación</Link> · <Link href="/settings">Mi cuenta</Link></p><Logout/>
    </Shell>;
  }
  notFound();
}
