import {Module} from '@nestjs/common';
import {DatabaseModule} from '../database/database.module';
import {HistoricalContributionsReportTask} from "./historical-contributions-report-task.service";
import {GoogleApiModule} from "../googleApi/googleApi.module";
import {FilesystemModule} from "../filesystem/filesystem.module";
import {CsvModule} from "../csv/csv.module";
import { SlackModule } from '../slack/slack.module';

@Module({
    imports: [GoogleApiModule, DatabaseModule, FilesystemModule, CsvModule, SlackModule],
    providers: [HistoricalContributionsReportTask],
    exports: [HistoricalContributionsReportTask]
})
export class TasksModule {
}
