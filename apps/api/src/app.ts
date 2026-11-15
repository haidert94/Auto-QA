import 'reflect-metadata';
import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './module';

function validationMessages(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap(error => {
    const unknown = error.constraints?.whitelistValidation || error.constraints?.unknownValue;
    if (unknown) return [`${parent || 'Solicitud'} · contiene datos no admitidos`];
    const path = parent ? `${parent}.${error.property}` : error.property;
    return [
      ...Object.values(error.constraints ?? {}).map(message => `${path} · ${message}`),
      ...validationMessages(error.children ?? [], path),
    ];
  });
}

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: ['error', 'warn'],
  });
  app.setGlobalPrefix('api');
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });
  app.useBodyParser('json', { limit: '100kb' });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: true,
    validationError: { target: false, value: false },
    exceptionFactory: errors => new BadRequestException([...new Set(validationMessages(errors))]),
  }));
  return app;
}
