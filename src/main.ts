import {NestFactory} from '@nestjs/core';
import {AppModule} from './app.module';
import {HistoricalContributionsReportTask} from "./modules/tasks/historical-contributions-report-task.service";

async function bootstrap() {
    // await CommandFactory.run(AppModule, new ConsoleLogger());
    try {
        const app = await NestFactory.create(AppModule);
        const exampleJob = app.get(HistoricalContributionsReportTask);
        await exampleJob.execute();
        await app.close()
    } catch (error) {
        console.trace('Application failed to start:', error);
        process.exit(1);
    }
}

bootstrap().catch(err => {
    console.trace('Bootstrap error:', err);
    process.exit(1);
});
