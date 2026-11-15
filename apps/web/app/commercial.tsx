import Link from 'next/link';
import { ArrowRight, BarChart3, BookOpen, CalendarDays, ChevronDown, CircleCheck, Code2, FileText,
  GitCompareArrows, Layers, LockKeyhole, Menu, Play, Repeat2, ScanLine, ShieldCheck, Sparkles, Target, Users } from 'lucide-react';
import { listPlans, setting } from './autoqa-server';
import { PlanCards, PlanComparison } from './plan-comparison';

const navigation = [
  ['Producto', '#producto'], ['Cómo funciona', '#como-funciona'], ['Funcionalidades', '#funcionalidades'],
  ['Precios', '#precios'], ['Preguntas frecuentes', '#faq'],
];

const steps = [
  ['Registra tu aplicación', 'Indica la URL y declara el alcance autorizado.', Target],
  ['Adjunta documentación', 'Sube requisitos, historias, criterios y reglas de negocio.', FileText],
  ['Configura roles y entornos', 'Declara permisos, datos de prueba y restricciones.', Users],
  ['Explora la aplicación', 'El explorador recorrerá flujos dentro del alcance permitido.', ScanLine],
  ['Genera y ejecuta pruebas', 'A partir de escenarios, AutoQA preparará pruebas Playwright con TypeScript.', Code2],
  ['Consulta resultados', 'Revisa la preparación con el IPA. Los resultados de ejecución y las evidencias llegarán después.', BarChart3],
] as const;

const features = [
  ['Exploración con Playwright', 'Descubre flujos de la aplicación dentro de un alcance autorizado.', ScanLine, false],
  ['Generación de escenarios', 'Convierte requisitos y criterios verificables en escenarios de prueba.', Sparkles, false],
  ['Análisis de historias y requisitos', 'Extrae hallazgos, localiza su fuente y detecta ambigüedades.', FileText, true],
  ['Preparación documental · IPA', 'Identifica qué información está disponible y qué falta para automatizar.', Target, true],
  ['Calidad de pruebas · ICSP', 'Evalúa la suite con evidencias, trazabilidad y ejecuciones.', BarChart3, false],
  ['Pruebas por rol', 'Configura la matriz de permisos hoy. La ejecución por rol está prevista.', Users, false],
  ['Ejecución programada', 'Programa verificaciones según la capacidad de tu plan.', CalendarDays, false],
  ['Evidencias y reportes', 'Consulta evidencias de ejecución y resultados relacionados con sus requisitos.', BookOpen, false],
  ['Detección de cambios', 'Identifica cambios de flujos para actualizar las pruebas afectadas.', GitCompareArrows, false],
  ['Reutilización de pruebas', 'Ejecuta de nuevo las pruebas guardadas en tu suite.', Repeat2, false],
  ['Exportación Playwright', 'Lleva pruebas escritas en TypeScript a tu repositorio.', Code2, false],
  ['IA híbrida optimizada', 'Combina reglas y modelos para análisis y generación según el caso.', Layers, false],
] as const;

const faqs = [
  ['¿Necesito saber programar?', 'Puedes registrar una aplicación, cargar documentos y revisar el IPA desde el navegador. Para integrar pruebas Playwright en un repositorio será útil contar con experiencia en TypeScript.'],
  ['¿AutoQA funciona con aplicaciones privadas?', 'Ya puedes declarar acceso privado o SSO, roles y permisos. La exploración autenticada depende de los controles y accesos de prueba, y está en desarrollo.'],
  ['¿Qué documentación debo proporcionar?', 'Los requisitos, historias de usuario, criterios de aceptación y reglas de negocio ayudan a identificar qué se puede verificar. Puedes adjuntar PDF, Word, Excel o archivos de texto y datos admitidos.'],
  ['¿Puedo utilizar AutoQA sin historias de usuario?', 'Sí. Registra la aplicación como borrador y carga lo que tengas. El IPA te mostrará los puntos que falta aclarar.'],
  ['¿Qué significa no tener créditos de IA?', 'Cada plan combina tipos de prueba, minutos de navegador, monitores y ejecuciones simultáneas. La capacidad y las reglas de uso se detallarán antes de la contratación real.'],
  ['¿Puedo cancelar mi suscripción?', 'Puedes cancelar la suscripción de prueba desde Facturación. Las condiciones de cancelación de suscripciones pagadas se definirán antes del lanzamiento.'],
  ['¿Qué sucede si una prueba falla?', 'La ejecución y los reportes están en desarrollo. El flujo previsto conservará la evidencia y distinguirá fallos de la prueba, del entorno y posibles defectos.'],
  ['¿AutoQA garantiza encontrar todos los errores?', 'La automatización comprueba comportamientos específicos. Los resultados dependen del alcance, la documentación y los escenarios cubiertos.'],
  ['¿Cómo se protegen mis credenciales y documentos?', 'El acceso se limita a la organización y los documentos se guardan fuera de las rutas públicas. Configura referencias a cuentas de prueba y evita adjuntar credenciales.'],
];

export function Brand() {
  return <Link className="brand" href="/" aria-label="AutoQA, inicio"><span><ScanLine size={19}/></span>Auto<span className="brand-qa">QA</span></Link>;
}

function DashboardDemo() {
  return (
    <figure className="demo" aria-label="Dashboard ilustrativo de AutoQA">
      <div className="demo-top"><span className="demo-dots"><i/><i/><i/></span><span>AutoQA / Resumen del proyecto</span></div>
      <div className="demo-body">
        <div className="demo-header"><div><small>Proyecto de ejemplo</small><h2>Portal de clientes</h2></div><span className="demo-label">Datos de ejemplo</span></div>
        <div className="demo-metrics">
          <div><span>Preparación documental</span><strong>78<small>/100</small></strong><i aria-hidden="true"/></div>
          <div><span>Pruebas aprobadas</span><strong>24<small>/28</small></strong><small>Vista ilustrativa</small></div>
          <div><span>Cobertura de requisitos</span><strong>64<small>%</small></strong><small>Vista ilustrativa</small></div>
        </div>
        <div className="demo-bottom">
          <div className="demo-activity"><b>Ejecuciones de ejemplo</b><div className="demo-chart" aria-hidden="true">
            {[36, 52, 43, 61, 52, 73, 88, 71, 94, 82, 100, 92].map((height, index) => <i key={index} style={{ height: height + '%' }}/>)}
          </div></div>
          <div className="demo-advice"><Sparkles size={17}/><b>Recomendación</b><p>Define el resultado esperado para los flujos de recuperación de acceso.</p></div>
        </div>
      </div>
    </figure>
  );
}

export default async function Commercial() {
  const plans = await listPlans();
  const accountOrigin = setting('AUTOQA_PUBLIC_WORKSPACE_ORIGIN') ?? '';
  return (
    <div className="commercial">
      <header className="commercial-header">
        <div className="wrap nav-wrap">
          <Brand/>
          <nav className="desktop-nav" aria-label="Navegación principal">{navigation.map(([label, href]) => <a key={href} href={href}>{label}</a>)}</nav>
          <div className="desktop-actions"><Link href={accountOrigin + '/login'}>Iniciar sesión</Link><a className="button accent" href="#precios">Comenzar ahora<ArrowRight size={16}/></a></div>
          <details className="mobile-nav"><summary aria-label="Abrir menú"><Menu size={22}/></summary><nav aria-label="Navegación móvil">
            {navigation.map(([label, href]) => <a key={href} href={href}>{label}</a>)}<Link href={accountOrigin + '/login'}>Iniciar sesión</Link>
            <a className="button primary" href="#precios">Comenzar ahora</a>
          </nav></details>
        </div>
      </header>
      <section className="hero" id="producto">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <h1>Automatiza tus pruebas de software con <em>inteligencia artificial.</em></h1>
            <p>Registra tu aplicación, proporciona tus requisitos y deja que AutoQA descubra funcionalidades, genere pruebas y te ayude a mejorar la calidad de tu software.</p>
            <div className="hero-actions"><a href="#precios" className="button accent">Comenzar ahora <ArrowRight size={18}/></a>
              <a href="#como-funciona" className="button dark-outline"><Play size={17}/>Ver cómo funciona</a></div>
          </div>
          <DashboardDemo/>
        </div>
        <div className="wrap hero-current"><CircleCheck size={17}/><span><strong>Disponible hoy</strong> · Registro de aplicaciones, análisis documental e IPA</span></div>
      </section>
      <section className="wrap section" id="como-funciona">
        <div className="section-intro"><h2>Cómo funciona AutoQA</h2><p>De la documentación a los resultados de prueba, con el alcance y las fuentes a la vista.</p></div>
        <div className="steps">{steps.map(([title, description, Icon], index) => <article className="step" key={title}>
          <span className="step-icon"><Icon size={23}/></span><span className="step-num">0{index + 1}</span>
          <h3>{title}</h3><p>{description}</p>
        </article>)}</div>
      </section>
      <section className="quiet section" id="funcionalidades"><div className="wrap">
        <div className="section-intro"><h2>Funcionalidades</h2><p>Consulta qué puedes usar hoy y qué sigue en el roadmap.</p></div>
        <div className="feature-grid">{features.map(([title, description, Icon, available]) => <article className="feature" key={title}>
          <div><Icon size={23}/><span className={available ? 'available' : 'roadmap'}>{available ? 'Disponible' : 'En desarrollo'}</span></div>
          <h3>{title}</h3><p>{description}</p>
        </article>)}</div>
      </div></section>
      <section className="benefits section"><div className="wrap">
        <div className="section-intro"><h2>Qué aporta AutoQA a tu equipo</h2></div>
        <div className="benefit-grid">
          {[
            ['Sin créditos ni tokens visibles', 'Elige un plan con capacidad y límites definidos.', ShieldCheck],
            ['Pruebas reutilizables', 'La suite prevista conservará los escenarios para volver a ejecutarlos.', Repeat2],
            ['Calidad basada en requisitos', 'Identifica los criterios verificables y las preguntas pendientes.', Target],
            ['Automatización con trazabilidad', 'Los escenarios y resultados podrán vincularse a sus requisitos y evidencias.', GitCompareArrows],
          ].map(([title, description, Icon]) => {
            const BenefitIcon = Icon as typeof Target;
            return <article key={String(title)}><BenefitIcon size={23}/><h3>{String(title)}</h3><p>{String(description)}</p></article>;
          })}
        </div>
      </div></section>
      <section className="wrap section" id="precios">
        <div className="section-intro"><h2>Planes según las pruebas que necesitas</h2><p>Precios y capacidades preliminares sujetos a validación. «Más popular» señala nuestra recomendación comercial.</p></div>
        {plans.length ? <PlanCards plans={plans} accountOrigin={accountOrigin}/> : <p role="status">El catálogo de planes no está disponible en este momento.</p>}
        <p className="plan-note"><LockKeyhole size={16}/>Contratación de prueba. La comparación distingue capacidades operativas, beta y próximas.</p>
        {plans.length > 0 && <PlanComparison plans={plans}/>}
      </section>
      <section className="quiet section" id="faq"><div className="wrap faq-grid">
        <div className="section-intro"><h2>Preguntas frecuentes</h2><p>Conoce el alcance del producto y la contratación de prueba.</p></div>
        <div className="questions">{faqs.map(([question, answer]) => <details key={question}><summary>{question}<ChevronDown size={18}/></summary><p>{answer}</p></details>)}</div>
      </div></section>
      <section className="final-cta"><div className="wrap"><h2>Mejora la calidad de tu software con automatización inteligente.</h2>
        <Link href={accountOrigin + '/registro'} className="button accent">Crear mi cuenta<ArrowRight size={18}/></Link>
      </div></section>
      <footer className="commerce-footer" id="contacto"><div className="wrap footer-grid"><div><Brand/><p>Automatización de pruebas web para equipos de software.</p></div>
        <nav aria-label="Pie de página"><a href="#producto">Producto</a><a href="#precios">Precios</a><Link href="/contacto">Contacto</Link>
          <Link href="/terminos">Términos y condiciones</Link><Link href="/privacidad">Política de privacidad</Link><Link href="/privacidad#datos">Tratamiento de datos personales</Link><Link href="/estado">Estado del servicio</Link></nav>
      </div></footer>
    </div>
  );
}
