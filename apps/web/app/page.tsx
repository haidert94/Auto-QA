import type { Metadata } from 'next';
import Commercial from './commercial';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'AutoQA · Análisis de requisitos y preparación de pruebas',
  description: 'Registra aplicaciones, define el alcance y revisa qué requisitos pueden verificarse antes de automatizar tus pruebas.',
  openGraph: {
    title: 'AutoQA · Análisis de requisitos y preparación de pruebas',
    description: 'Análisis documental con fuentes e Índice de Preparación para Automatización.',
    type: 'website',
    locale: 'es_CO',
  },
};

export default function Home() {
  return <Commercial/>;
}
