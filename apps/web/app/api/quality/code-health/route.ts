import { projectProxy } from '../../../autoqa-server';

// Proxy al endpoint global del API. No lleva projectId porque la salud del
// repositorio es común al producto.
export async function GET(request: Request) {
  return projectProxy(request, '/quality/code-health');
}
