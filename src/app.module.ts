import {Module} from '@nestjs/common';
import {TasksModule} from './modules/tasks/tasks.module';
import {DatabaseModule} from './modules/database/database.module';
import {ConfigModule} from "@nestjs/config";

@Module({
    imports: [awConfigModule.forRoot({
        isGlobal: true, // Makes the config available globally
    }), TasksModule, DatabaseModule,],
})
export class AppModule {
}