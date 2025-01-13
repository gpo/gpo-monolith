import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {HistoricalContributionsReportTask} from "./modules/tasks/historical-contributions-report-task.service";
import {CommandFactory} from "nest-commander";
import {ConsoleLogger, LoggerService} from "@nestjs/common";


async function bootstrap() {
    // await CommandFactory.run(AppModule, new ConsoleLogger());

    const app = await NestFactory.create(AppModule);
    const exampleJob = app.get(HistoricalContributionsReportTask);
    await exampleJob.execute();
    await app.close()
}
bootstrap();
