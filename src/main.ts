import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Increase JSON body limit for base64 image uploads (OCR test endpoint).
  // A 5 MB image → ~7 MB base64; 15 MB gives comfortable headroom.
  app.use(require('express').json({ limit: '15mb' }));

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );

  app.enableCors({
    origin: '*',
  });

  const port = process.env.PORT ?? 8080;
  await app.listen(port);
  console.log(`Vibe House API running on http://localhost:${port}`);
}
bootstrap();
