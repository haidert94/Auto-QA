import { projectProxy } from '../../autoqa-server';

export function GET(request: Request) { return projectProxy(request, '/projects'); }
export function POST(request: Request) { return projectProxy(request, '/projects'); }
