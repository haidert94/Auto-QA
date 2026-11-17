import { projectProxy } from '../../../autoqa-server';

export async function GET(request: Request) {
  return projectProxy(request, '/ai/budget');
}
