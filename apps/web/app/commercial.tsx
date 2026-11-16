import Link from 'next/link';
import { ArrowDown, ArrowRight, ChevronDown, FileText, Link2, ScanLine } from 'lucide-react';
import { listPlans, setting, type Plan } from './autoqa-server';
import { PlanCards, PlanComparison } from './plan-comparison';
import MobileNavigation from './mobile-navigation';

const navigation = [
  ['Producto', '/producto'],
  ['Cómo funciona', '/como-funciona'],
  ['Precios', '/precios'],
] as const;

const steps = [
  { label: 'Alcance', title: 'Registra tu aplicación',
    description: 'Declara qué entornos, dominios y rutas se pueden probar, y cuáles quedan fuera del alcance.' },
  { label: 'Documentación', title: 'Adjunta requisitos y configura roles',
    description: 'Sube historias de usuario, criterios o especificaciones y define los permisos de cada rol.' },
  { label: 'Preparación', title: 'Revisa los hallazgos y el IPA',
    description: 'Consulta la fuente de cada hallazgo y prioriza lo que falta para que tus requisitos se puedan verificar.' },
];

const faqs = [
  ['¿Qué documentos puedo analizar?', 'Puedes adjuntar PDF con texto, Word, Excel, CSV, TXT, Markdown, JSON y YAML. AutoQA también reconoce operaciones de OpenAPI como candidatas pendientes de revisión.'],
  ['¿Cómo se calcula el IPA?', 'El Índice de Preparación para Automatización evalúa la autorización, la documentación, los accesos, los datos de prueba y el alcance registrados. El informe indica qué evidencia está disponible y qué información falta.'],
  ['¿Qué puedo usar hoy y qué viene después?', 'Ya puedes registrar aplicaciones, analizar documentación mediante reglas y revisar el IPA. La comparativa identifica las funciones previstas, como los monitores de disponibilidad y las pruebas de performance.'],
  ['¿Cómo funciona la contratación de prueba?', 'Puedes elegir un plan al crear tu cuenta. En el entorno de evaluación, la activación y la cancelación se gestionan en Facturación mediante un pago simulado.'],
];

export function Brand() {
  return <Link className="brand" href="/" aria-label="AutoQA, inicio"><span><ScanLine size={19}/></span>Auto<span className="brand-qa">QA</span></Link>;
}

function InspectorDemo() {
  return (
    <figure className="inspector" aria-labelledby="inspector-caption">
      <figcaption id="inspector-caption" className="inspector-bar">
        <span className="inspector-dots" aria-hidden="true"><i/><i/><i/></span>
        <span>AutoQA Inspector</span><span>Ejemplo de análisis</span>
      </figcaption>
      <div className="inspector-body">
        <section className="inspector-source" aria-labelledby="inspector-source">
          <p className="inspector-meta"><FileText size={14} aria-hidden="true"/> Documento de origen</p>
          <h2 id="inspector-source">Requisitos de acceso.pdf</h2>
          <p className="inspector-subhead">Página 4 · Acceso a la aplicación</p>
          <div className="inspector-excerpt">
            <blockquote><mark>El acceso debe ser rápido.</mark></blockquote>
            <p><Link2 size={13} aria-hidden="true"/> Fuente de RF-014</p>
          </div>
        </section>
        <section className="inspector-finding" aria-labelledby="inspector-finding">
          <div className="finding-title">
            <p className="inspector-meta">RF-014</p>
            <span className="finding-status">Ambiguo</span>
          </div>
          <h2 id="inspector-finding">Tiempo de acceso</h2>
          <div className="finding-note">
            <p className="inspector-meta">Hallazgo</p>
            <p>Falta definir un tiempo máximo de acceso.</p>
          </div>
          <p className="finding-source"><Link2 size={14} aria-hidden="true"/> Fuente vinculada · Página 4</p>
        </section>
      </div>
    </figure>
  );
}

export function CommercialHeader({ accountOrigin = '' }: { accountOrigin?: string }) {
  return <header className="commercial-header">
    <div className="wrap nav-wrap">
      <Link className="wordmark" href="/" aria-label="AutoQA, inicio">Auto<span>QA</span></Link>
      <nav className="desktop-nav" aria-label="Navegación principal">
        {navigation.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
      </nav>
      <div className="desktop-actions">
        <Link href={accountOrigin + '/login'}>Iniciar sesión</Link>
        <Link className="button primary" href={accountOrigin + '/registro'}>Crear cuenta</Link>
      </div>
      <MobileNavigation links={navigation} loginHref={accountOrigin + '/login'}/>
    </div>
  </header>;
}

export function CommercialFooter() {
  return <footer className="commerce-footer">
    <div className="wrap footer-grid">
      <Link className="wordmark" href="/" aria-label="AutoQA, inicio">Auto<span>QA</span></Link>
      <nav aria-label="Pie de página">
        {navigation.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
        <Link href="/contacto">Contacto</Link>
        <Link href="/terminos">Términos</Link>
        <Link href="/privacidad">Privacidad</Link>
        <Link href="/estado">Estado del servicio</Link>
      </nav>
    </div>
  </footer>;
}

export function CommercialShell({ children }: { children: React.ReactNode }) {
  const accountOrigin = setting('AUTOQA_PUBLIC_WORKSPACE_ORIGIN') ?? '';
  return <div className="commercial">
    <CommercialHeader accountOrigin={accountOrigin}/>
    {children}
    <CommercialFooter/>
  </div>;
}

export function HeroSection({ pricingHref = '#precios', workflowHref = '#como-funciona' }: {
  pricingHref?: string; workflowHref?: string;
} = {}) {
  return <section className="hero" aria-labelledby="hero-title">
    <div className="wrap hero-grid">
      <div className="hero-copy">
        <p className="section-label">Análisis documental de requisitos</p>
        <h1 id="hero-title">Detecta qué le falta a un requisito para poder probarlo</h1>
        <p className="hero-lead">Registra tu aplicación, define el alcance autorizado y revisa qué requisitos son verificables antes de automatizar.</p>
        <div className="hero-actions">
          <Link href={pricingHref} className="button primary">Ver planes <ArrowRight size={16} aria-hidden="true"/></Link>
          <Link href={workflowHref} className="button outline">Cómo funciona <ArrowDown size={15} aria-hidden="true"/></Link>
        </div>
        <Link className="hero-ipa" href={workflowHref}>
          <span><span className="section-label">Evaluación del proyecto</span>Índice de Preparación para Automatización</span>
          <span className="hero-ipa-code">IPA <ArrowRight size={14} aria-hidden="true"/></span>
        </Link>
      </div>
      <InspectorDemo/>
    </div>
  </section>;
}

export function WorkflowSection() {
  return <section className="workflow" id="como-funciona" aria-label="Cómo funciona AutoQA">
    <ol className="wrap steps">
      {steps.map(({ label, title, description }) => (
        <li key={label}>
          <p className="section-label">{label}</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </li>
      ))}
    </ol>
  </section>;
}

export function PricingSection({ plans, accountOrigin }: { plans: Plan[]; accountOrigin: string }) {
  return <section className="wrap landing-pricing" id="precios" aria-labelledby="pricing-title">
    <div className="section-intro pricing-intro">
      <h2 id="pricing-title">Planes según las pruebas que necesitas</h2>
      <p>Precios en pesos colombianos. Tarifas y límites preliminares sujetos a validación.</p>
    </div>
    {plans.length > 0
      ? <PlanCards plans={plans} accountOrigin={accountOrigin}/>
      : <p role="status">El catálogo de planes no está disponible en este momento.</p>}
    {plans.length > 0 && (
      <section className="landing-comparison" aria-labelledby="comparison-title">
        <div className="section-intro">
          <h2 id="comparison-title">Comparativa técnica</h2>
          <p>Consulta las capacidades operativas, las previstas y los límites de cada plan.</p>
        </div>
        <PlanComparison plans={plans}/>
      </section>
    )}
  </section>;
}

export function FaqSection({ accountOrigin }: { accountOrigin: string }) {
  return <section className="landing-faq" aria-labelledby="faq-title">
    <div className="wrap faq-grid">
      <div>
        <div className="section-intro"><h2 id="faq-title">Preguntas sobre análisis y ejecución</h2></div>
        <div className="questions">
          {faqs.map(([question, answer]) => (
            <details key={question}>
              <summary>{question}<ChevronDown size={17} aria-hidden="true"/></summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </div>
      <section className="landing-cta" aria-labelledby="cta-title">
        <h2 id="cta-title">Revisa tus requisitos con AutoQA</h2>
        <p>Crea una cuenta para registrar tu primera aplicación y consultar qué falta para automatizar sus pruebas.</p>
        <div>
          <Link href={accountOrigin + '/registro'} className="button primary">Crear mi cuenta <ArrowRight size={16} aria-hidden="true"/></Link>
          <Link href={accountOrigin + '/login'} className="button outline">Iniciar sesión</Link>
        </div>
      </section>
    </div>
  </section>;
}

export default async function Commercial() {
  const plans = await listPlans();
  const accountOrigin = setting('AUTOQA_PUBLIC_WORKSPACE_ORIGIN') ?? '';
  return <CommercialShell>
    <HeroSection/>
    <WorkflowSection/>
    <PricingSection plans={plans} accountOrigin={accountOrigin}/>
    <FaqSection accountOrigin={accountOrigin}/>
  </CommercialShell>;
}
