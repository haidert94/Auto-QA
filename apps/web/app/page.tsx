import type { Metadata } from 'next';
import localFont from 'next/font/local';
import Commercial from './commercial';

const geist = localFont({
  src: './fonts/geist.woff2',
  variable: '--landing-geist',
  weight: '400 800',
  display: 'swap',
});
const jetBrainsMono = localFont({
  src: './fonts/jetbrains-mono.woff2',
  variable: '--landing-mono',
  weight: '400 600',
  display: 'swap',
});

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
  return <Commercial fontClasses={geist.variable + ' ' + jetBrainsMono.variable}/>;
}
