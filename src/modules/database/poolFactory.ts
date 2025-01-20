import {ConfigService} from "@nestjs/config";
import {createPool} from "mysql2/promise";

export const poolFactory = {
    provide: 'POOL',
    inject: [ConfigService],
    useFactory: (configService: ConfigService) => {
        return createPool({
            host: configService.get<string>('DB_HOST'),
            port: configService.get<number>('DB_PORT'),
            user: configService.get<string>('DB_USER'),
            password: configService.get<string>('DB_PASSWORD'),
            database: configService.get<string>('DB_NAME'),
        });
    },
}