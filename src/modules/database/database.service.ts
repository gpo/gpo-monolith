import {Inject, Injectable} from '@nestjs/common';
import {Pool, QueryResult} from 'mysql2/promise';

@Injectable()
export class DatabaseService {
    constructor(@Inject('POOL') private readonly pool: Pool) {
    }

    // Execute a raw query
    async query(queryString: string, params?: any[]): Promise<QueryResult> {
        const [results] = await this.pool.query(queryString, params);
        return results;
    }
}
