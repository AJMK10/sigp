import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

export async function createApp() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api');
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true });
  app.enableShutdownHooks();
  return app;
}

if (require.main === module) {
  createApp().then(async (app) => {
    const port = Number(process.env.PORT ?? 3000);
    await app.listen(port);
    console.log(`API SIGP prête sur http://localhost:${port}/api`);
  });
}
