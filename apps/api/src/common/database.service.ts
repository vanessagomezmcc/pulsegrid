import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';

/** Thin PostgreSQL wrapper. Every query is parameterized. */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgres://pulsegrid:pulsegrid@localhost:5432/pulsegrid?sslmode=disable',
    max: 10,
  });

  async query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query<T>(text, params);
    return res.rows;
  }

  async healthy(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
