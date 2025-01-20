import {Module} from '@nestjs/common';
import {DatabaseService} from "./database.service";
import {poolFactory} from "./poolFactory";

@Module({
    providers: [DatabaseService, poolFactory],
    exports: [DatabaseService],
})
export class DatabaseModule {
}
