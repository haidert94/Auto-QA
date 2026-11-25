// Fixtures sintéticas para el verbo upload del DSL. El agente de generación
// NUNCA emite un path de disco — solo elige un tipo de esta whitelist. El
// spec generado invoca autoqaFixture(kind) que devuelve { name, mimeType,
// buffer } y Playwright lo sube sin tocar el filesystem del worker.
//
// Por qué es importante: setInputFiles acepta un path string, y si el agente
// pudiera emitir uno, podría subir /etc/passwd, el .env del worker, o un
// socket. Con buffers inline esa vía queda cerrada por diseño.
//
// Los buffers se generan a partir de constantes base64 en este archivo. Son
// archivos MÍNIMOS pero válidos: el servidor del sitio los acepta como PDF /
// PNG / etc. Si un caso necesita un archivo más realista, es un follow-up
// (per-project fixtures en S3), no este mecanismo.

export const UPLOAD_FIXTURE_KINDS = ['png', 'jpg', 'pdf', 'txt', 'csv', 'json'] as const;
export type UploadFixtureKind = typeof UPLOAD_FIXTURE_KINDS[number];

export function isUploadFixtureKind(value: string): value is UploadFixtureKind {
  return (UPLOAD_FIXTURE_KINDS as readonly string[]).includes(value);
}

// Un data válido para upload es exactamente "fixture:<kind>" con kind en la
// whitelist. Cualquier otra cosa (ruta, URL, texto libre) hace que
// readGeneratorSteps descarte el paso como DSL inválido.
const FIXTURE_DATA_PATTERN = /^fixture:([a-z]+)$/;

export function parseUploadFixtureData(data: string | null | undefined): UploadFixtureKind | null {
  if (typeof data !== 'string') return null;
  const match = data.trim().match(FIXTURE_DATA_PATTERN);
  if (!match) return null;
  return isUploadFixtureKind(match[1]) ? match[1] : null;
}

// Metadatos del fixture: nombre lógico, MIME y el contenido como base64 para
// embedarlo literalmente en el spec generado. Playwright decodifica a Buffer
// en runtime.
type FixtureSpec = { filename: string; mimeType: string; base64: string };

// PNG 1×1 transparente (RFC 2083 minimal). Validado con `file`.
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
// JPEG 1×1 negro. Es la forma mínima aceptada por libjpeg.
const JPG_1X1 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/8H//2Q==';
// PDF 1.4 mínimo — un objeto, página vacía, sin texto. Es válido para
// cualquier lector porque Playwright solo pasa los bytes al servidor.
const PDF_EMPTY =
  'JVBERi0xLjQKMSAwIG9iagogIDw8IC9UeXBlIC9DYXRhbG9nIC9QYWdlcyAyIDAgUiA+PgplbmRvYmoKMiAwIG9iagogIDw8IC9UeXBlIC9QYWdlcyAvS2lkcyBbIDMgMCBSIF0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKICA8PCAvVHlwZSAvUGFnZSAvUGFyZW50IDIgMCBSIC9NZWRpYUJveCBbIDAgMCA2MSAxMCBdID4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1NiAwMDAwMCBuIAowMDAwMDAwMTExIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNCAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKMTc3CiUlRU9G';

function textFixture(filename: string, mimeType: string, content: string): FixtureSpec {
  return { filename, mimeType, base64: Buffer.from(content, 'utf8').toString('base64') };
}

const FIXTURES: Record<UploadFixtureKind, FixtureSpec> = {
  png: { filename: 'autoqa-sample.png', mimeType: 'image/png', base64: PNG_1X1 },
  jpg: { filename: 'autoqa-sample.jpg', mimeType: 'image/jpeg', base64: JPG_1X1 },
  pdf: { filename: 'autoqa-sample.pdf', mimeType: 'application/pdf', base64: PDF_EMPTY },
  txt: textFixture('autoqa-sample.txt', 'text/plain', 'Archivo sintético AutoQA para pruebas de upload.\n'),
  csv: textFixture('autoqa-sample.csv', 'text/csv', 'id,nombre,valor\n1,prueba,ok\n'),
  json: textFixture('autoqa-sample.json', 'application/json', '{"autoqa":"fixture","version":1}'),
};

export function uploadFixtureSpec(kind: UploadFixtureKind): FixtureSpec {
  return FIXTURES[kind];
}

// Emite el cuerpo de una función helper que el spec incluye UNA vez cuando
// hay al menos un paso upload. Mantener el switch exhaustivo garantiza que
// una fixture nueva requiera actualizar el helper (el type UploadFixtureKind
// no deja agregar un tipo sin manejarlo).
export function generateUploadFixtureHelper(usedKinds: ReadonlySet<UploadFixtureKind>): string {
  if (!usedKinds.size) return '';
  const cases: string[] = [];
  for (const kind of UPLOAD_FIXTURE_KINDS) {
    if (!usedKinds.has(kind)) continue;
    const spec = FIXTURES[kind];
    cases.push(
      `    case '${kind}': return { name: '${spec.filename}', mimeType: '${spec.mimeType}', `
      + `buffer: Buffer.from('${spec.base64}', 'base64') };`,
    );
  }
  return [
    'function autoqaFixture(kind) {',
    '  switch (kind) {',
    ...cases,
    "    default: throw new Error('AutoQA fixture desconocida: ' + kind);",
    '  }',
    '}',
    '',
  ].join('\n');
}
