import {Injectable, Logger} from "@nestjs/common";
import {GoogleDriveService} from "../googleApi/googleDrive.service";
import {DatabaseService} from "../database/database.service";
import {FilesystemService} from "../filesystem/filesystem.service";
import {CsvService} from "../csv/csv.service";
import { SlackService } from "../slack/slack.service";

@Injectable()
export class HistoricalContributionsReportTask {
    private readonly logger = new Logger(HistoricalContributionsReportTask.name);


    constructor(
        private readonly googleDrive: GoogleDriveService,
        private readonly db: DatabaseService,
        private readonly filesystem: FilesystemService,
        private readonly csvService: CsvService,
        private readonly slackService: SlackService,
    ) {}

    private readonly SQL_QUERY_FILENAME = "historical-contributions.sql";

    public async execute(): Promise<void> {
        this.logger.debug("Executing the Job...");
        const filePath = "testfile.csv";
        const folderId = "1wWN4940ZG0lUTCK2nCDIzNhn7xZ5N5RP"; // Replace with Google Drive folder ID

        const sqlQuery = await this.filesystem.readSqlFile(this.SQL_QUERY_FILENAME);
        const rows = await this.db.query(sqlQuery);
        const writeStream = this.filesystem.createTempWriteStream(filePath);
        await this.csvService.exportQueryToCsv((<object[]>rows), writeStream);
        await this.googleDrive.uploadFile(filePath, folderId);
        // TODO: #data-notifications needs to be switched out between staging and prod
        await this.slackService.sendMessage('#data-notifications', 'The Historical Contributions data has been updated. You can find the updated file here: ');
    }

}
