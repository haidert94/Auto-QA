import { ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';

@Catch()
export class DocumentErrorsFilter implements ExceptionFilter {
  private readonly logger = new Logger(DocumentErrorsFilter.name);

  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<{
      status(code: number): { json(body: unknown): void };
    }>();
    if (error instanceof HttpException) {
      const statusCode = error.getStatus();
      const body = error.getResponse();
      response.status(statusCode).json(typeof body === 'string' ? { statusCode, message: body } : body);
      return;
    }
    this.logger.error('Error interno en una operación documental.');
    response.status(500).json({ statusCode: 500, message: 'No se pudo completar la operación documental.' });
  }
}
