import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });

  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  app.enableCors({
    origin: webOrigin.split(','),
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'x-pulsegrid-session'],
  });
  app.useWebSocketAdapter(new WsAdapter(app));

  const doc = new DocumentBuilder()
    .setTitle('PulseGrid Control Plane API')
    .setDescription(
      'Read APIs for telemetry-derived state (services, traces, alerts, incidents, dead letters) ' +
        'and write APIs for demo sessions, simulation scenarios, alert acknowledgement, and DLQ actions. ' +
        'All demo state is scoped by the x-pulsegrid-session header.',
    )
    .setVersion('1.0')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`pulsegrid-api listening on :${port} (docs at /docs)`);
}
void bootstrap();
