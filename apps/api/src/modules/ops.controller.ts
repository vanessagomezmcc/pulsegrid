import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { DatabaseService } from '../common/database.service';
import { RedisService } from '../common/redis.service';

@ApiTags('ops')
@Controller()
export class OpsController {
  private started = Date.now();
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  @Get('healthz')
  healthz() {
    return { status: 'ok', uptimeSeconds: Math.floor((Date.now() - this.started) / 1000) };
  }

  @Get('readyz')
  async readyz(@Res() res: Response) {
    const [pg, rd] = await Promise.all([this.db.healthy(), this.redis.healthy()]);
    res.status(pg && rd ? 200 : 503).json({ postgres: pg, redis: rd });
  }

  @ApiExcludeEndpoint()
  @Get('metrics')
  async metrics(@Res() res: Response) {
    const sessions = await this.redis.client.sCard('pulsegrid:sessions').catch(() => 0);
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(
      `# HELP pulsegrid_api_active_sessions Active demo sessions\n# TYPE pulsegrid_api_active_sessions gauge\npulsegrid_api_active_sessions ${sessions}\n` +
        `# HELP pulsegrid_api_uptime_seconds API uptime\n# TYPE pulsegrid_api_uptime_seconds gauge\npulsegrid_api_uptime_seconds ${Math.floor((Date.now() - this.started) / 1000)}\n`,
    );
  }
}
