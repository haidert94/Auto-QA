// Configuración S3 compartida entre API (lee capturas) y worker (las escribe).
// El worker importa desde aquí igual que hace con url-guard, para que solo
// exista una fuente de verdad de la configuración.
//
// Variables de entorno que consume:
//   AUTOQA_EXPLORATIONS_BACKEND   "local" (default) | "s3"
//   AUTOQA_S3_ENDPOINT            URL completa, p. ej. https://s3.eu-central-1.wasabisys.com
//   AUTOQA_S3_REGION              región, p. ej. auto / us-east-1 / eu-central-1
//   AUTOQA_S3_BUCKET              nombre del bucket
//   AUTOQA_S3_ACCESS_KEY          access key ID
//   AUTOQA_S3_SECRET_KEY          secret access key
//   AUTOQA_S3_PREFIX              opcional, p. ej. "prod/" para segregar por entorno
//   AUTOQA_S3_FORCE_PATH_STYLE    "true" para R2 / B2 / MinIO / Hostinger Object Storage

import { S3Client } from '@aws-sdk/client-s3';

const KEY_PATTERN = /^[0-9a-f]{32}$/;

export function isS3Enabled(): boolean {
  return (process.env.AUTOQA_EXPLORATIONS_BACKEND ?? 'local').toLowerCase() === 's3';
}

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
  forcePathStyle: boolean;
}

export function readS3Config(): S3Config {
  const endpoint = process.env.AUTOQA_S3_ENDPOINT?.trim();
  const region = process.env.AUTOQA_S3_REGION?.trim();
  const bucket = process.env.AUTOQA_S3_BUCKET?.trim();
  const accessKeyId = process.env.AUTOQA_S3_ACCESS_KEY?.trim();
  const secretAccessKey = process.env.AUTOQA_S3_SECRET_KEY?.trim();
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Backend S3 seleccionado pero falta configuración. Requeridas: ' +
      'AUTOQA_S3_ENDPOINT, AUTOQA_S3_REGION, AUTOQA_S3_BUCKET, ' +
      'AUTOQA_S3_ACCESS_KEY, AUTOQA_S3_SECRET_KEY.',
    );
  }
  try { new URL(endpoint); }
  catch { throw new Error('AUTOQA_S3_ENDPOINT no es una URL válida.'); }
  // Un prefix sano no empieza con '/'. Permitimos que termine (o no) en '/'.
  const rawPrefix = (process.env.AUTOQA_S3_PREFIX ?? '').trim();
  if (rawPrefix.startsWith('/')) throw new Error('AUTOQA_S3_PREFIX no debe empezar con "/".');
  const prefix = rawPrefix.length === 0 || rawPrefix.endsWith('/') ? rawPrefix : rawPrefix + '/';
  return {
    endpoint, region, bucket, accessKeyId, secretAccessKey, prefix,
    forcePathStyle: (process.env.AUTOQA_S3_FORCE_PATH_STYLE ?? 'false').toLowerCase() === 'true',
  };
}

export function createS3ClientFromConfig(config: S3Config): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: config.forcePathStyle,
    requestHandler: { requestTimeout: 5000, connectionTimeout: 5000 },
  });
}

// Devuelve el object key completo (con prefix) sólo si la clave de captura
// es válida. Las claves vienen de randomBytes(16).toString('hex'); cualquier
// otra entrada se rechaza para evitar que un cliente malicioso lea objetos
// arbitrarios del bucket.
export function resolveObjectKey(config: Pick<S3Config, 'prefix'>, key: string): string | null {
  if (!KEY_PATTERN.test(key)) return null;
  return config.prefix + key;
}

export { KEY_PATTERN };
