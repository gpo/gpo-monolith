import { Injectable } from '@nestjs/common';
import { createPool, Pool } from 'mysql2/promise';
import {ConfigService} from "@nestjs/config";

@Injectable()
export class DatabaseService {
    private pool: Pool;

    constructor(private configService: ConfigService) {
        this.pool = createPool({
            host: this.configService.get<string>('DB_HOST'),
            port: this.configService.get<number>('DB_PORT'),
            user: this.configService.get<string>('DB_USER'),
            password: this.configService.get<string>('DB_PASSWORD'),
            database: this.configService.get<string>('DB_NAME'),
        });
    }

    // Execute a raw query
    async query(queryString: string, params?: any[]): Promise<any> {
        const [results] = await this.pool.query(queryString, params);
        return results;
    }

    // Close the pool connection
    async close() {
        await this.pool.end();
    }
}
