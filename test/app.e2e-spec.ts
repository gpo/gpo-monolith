import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseModule } from '../src/modules/database/database.module';
import { HistoricalContributionsReportTask } from '../src/modules/tasks/historical-contributions-report-task.service';
import { TasksModule } from '../src/modules/tasks/tasks.module';

describe('AppController (e2e)', () => {
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
    const testingModule: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              SQL_FILES_PATH: 'src/sql-queries',
              sqlFilesPath: 'src/sql-queries',
            }),
          ],
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          cache: false,
        }),
        TasksModule,
        DatabaseModule,
      ],
    }).compile();

    const configService = testingModule.get(ConfigService);
    const sqlFilesPath = configService.get<string>('sqlFilesPath');
    expect(sqlFilesPath).toBe('src/sql-queries');

    const task = testingModule.get(HistoricalContributionsReportTask);
    return await task.execute();
  });
});
