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
            //conditionally create ssl object if all ssl variables are set
            ...(configService.get<string>('DB_SSL_KEY') &&
                configService.get<string>('DB_SSL_CERT') &&
                configService.get<string>('DB_SSL_CA') && {
                    ssl: {
                        key: configService.get<string>('DB_SSL_KEY'),
                        cert: configService.get<string>('DB_SSL_CERT'),
                        ca: configService.get<string>('DB_SSL_CA')
                    }
                }),
        });
    },
}