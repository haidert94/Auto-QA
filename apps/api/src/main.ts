import { createApp } from './app';

async function bootstrap() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '127.0.0.1');
  console.log(`AutoQA API en http://127.0.0.1:${port}/api`);
}

void bootstrap();
