import type { Metadata } from 'next';
import Commercial from './commercial';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'AutoQA · Automatización de pruebas con IA',
  description: 'Registra aplicaciones, analiza requisitos y prepara pruebas de software con documentación trazable y un IPA explicable.',
  openGraph: {
    title: 'AutoQA · Automatización de pruebas con IA',
    description: 'Análisis documental y preparación para pruebas web en una plataforma de QA.',
    type: 'website',
    locale: 'es_CO',
  },
};

export default Commercial;
