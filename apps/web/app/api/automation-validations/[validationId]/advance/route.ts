import { accountFetch, failure, responseCopy } from '../../../../autoqa-server';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ validationId: string }> }) {
  const { validationId } = await params;
  if (!uuid.test(validationId)) return failure('Validación no encontrada.', 404);
  const authorization = request.headers.get('authorization');
  const runId = request.headers.get('x-autoqa-github-run');
  if (!authorization || !runId) return failure('Validación no autorizada.', 403);
  try {
    return responseCopy(await accountFetch(`/automation-validations/${validationId}/advance`, {
      method: 'POST', headers: { Authorization: authorization, 'X-AutoQA-GitHub-Run': runId },
    }, { public: true, timeoutMs: 15000 }));
  } catch {
    return failure('No se pudo consultar el estado de la validación.', 502);
  }
}
