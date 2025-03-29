import {Module} from '@nestjs/common';
import {TasksModule} from './modules/tasks/tasks.module';
import {DatabaseModule} from './modules/database/database.module';
import {ConfigModule} from "@nestjs/config";
import { SlackModule } from './modules/slack/slack.module';

@Module({
    imports: [ConfigModule.forRoot({
        isGlobal: true, // Makes the config available globally
    }), TasksModule, DatabaseModule, SlackModule,],
})
export class AppModule {
}
