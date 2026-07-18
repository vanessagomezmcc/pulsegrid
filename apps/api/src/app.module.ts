import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DatabaseService } from './common/database.service';
import { RedisService } from './common/redis.service';
import { KafkaService } from './common/kafka.service';
import { SessionService } from './common/session.service';
import { OpsController } from './modules/ops.controller';
import { DemoSessionsController } from './modules/demo-sessions.controller';
import { ServicesController } from './modules/services.controller';
import { TracesController } from './modules/traces.controller';
import { AlertsController } from './modules/alerts.controller';
import { IncidentsController } from './modules/incidents.controller';
import { EventsController } from './modules/events.controller';
import { DeadLetterController } from './modules/dead-letter.controller';
import { SimulationController } from './modules/simulation.controller';
import { LiveGateway } from './modules/live.gateway';

@Module({
  imports: [
    // Global abuse guard: 120 requests/min/IP on top of per-session action limits.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
  ],
  controllers: [
    OpsController,
    DemoSessionsController,
    ServicesController,
    TracesController,
    AlertsController,
    IncidentsController,
    EventsController,
    DeadLetterController,
    SimulationController,
  ],
  providers: [
    DatabaseService,
    RedisService,
    KafkaService,
    SessionService,
    LiveGateway,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
