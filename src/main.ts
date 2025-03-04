import {NestFactory} from '@nestjs/core';
import {AppModule} from './app.module';
import {ConfigService} from "@nestjs/config";

async function bootstrap() {


// await CommandFactory.run(AppModule, new ConsoleLogger());
    try {
        const app = await NestFactory.create(AppModule);

        const configService = app.get(ConfigService);
        const taskName = configService.get<string>('TASK_NAME'); // Retrieves TASK_NAME
        console.log('Task Name:', taskName);

        const task = app.get(taskName);
        await task.execute();
        await app.close()
    } catch (error) {
        console.trace('Application failed to start:', error);
        process.exit(1);
    }
    process.exit(0);
}

bootstrap().catch(err => {
    console.trace('Bootstrap error:', err);
    process.exit(1);
});
