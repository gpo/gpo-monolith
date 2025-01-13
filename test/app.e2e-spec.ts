import {Test, TestingModule} from '@nestjs/testing';
import {INestApplication} from '@nestjs/common';
import {AppModule} from '../src/app.module';
import {HistoricalContributionsReportTask} from "../src/modules/tasks/historical-contributions-report-task.service";
import {ConfigModule, ConfigService} from "@nestjs/config";

describe('AppController (e2e)', () => {
    let app: INestApplication;

    beforeEach(async () => {
        // const mockConfigService = {
        //     get: jest.fn((key: string) => {
        //         switch (key) {
        //             case `SQL_FILES_PATH`:
        //                 return 'src/sql-queries';
        //         }
        //     }),
        // };
        // const moduleFixture: TestingModule = await Test.createTestingModule({
        //     imports: [AppModule],
        // })
        //     .overrideModule(ConfigModule)
        //     .useModule(ConfigModule.forRoot({
        //         isGlobal: true,
        //         load: [() => ({
        //             SQL_FILES_PATH: 'src/sql-queries',
        //         })],
        //     }))
        //     .compile();
        //
        // app = moduleFixture.createNestApplication();
        // await app.init();
    });

    it('Should run task', async () => {

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideModule(ConfigModule)
            .useModule(await ConfigModule.forRoot({
                isGlobal: true,
                load: [() => ({
                    SQL_FILES_PATH: 'src/sql-queries',
                    sqlFilesPath: 'src/sql-queries'
                })],
                ignoreEnvFile: true,
                ignoreEnvVars:  true,
                cache: false
            }))
            .compile();

        app = moduleFixture.createNestApplication();
        await app.init();

        const configService = app.get(ConfigService);
        // const configService = await app.resolve(ConfigService);

        // const sqlFilesPath = configService.get<string>('SQL_FILES_PATH');
        // expect(sqlFilesPath).toBe('src/sql-queries');

        const sqlFilesPath = configService.get<string>('sqlFilesPath');
        expect(sqlFilesPath).toBe('src/sql-queries');

        const task = app.get(HistoricalContributionsReportTask);
        return await task.execute();
    });
});
