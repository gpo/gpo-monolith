import {Injectable, Logger} from '@nestjs/common';
import {ConfigService} from "@nestjs/config";

import * as fs from "fs";
import {promises} from "fs";
import * as path from 'path';

@Injectable()
export class FilesystemService {
    private readonly logger = new Logger(FilesystemService.name);

    private readonly sqlFilesPath: string;
    private readonly tokenPath: string;
    private readonly defaultFilesEncoding = 'utf8';

    constructor(configService: ConfigService) {
        this.sqlFilesPath = configService.get<string>('SQL_FILES_PATH');
        this.tokenPath = configService.get<string>('GOOGLE_AUTH_TOKEN_PATH');
    }

    public async readSqlFile(fileName: string) {
        this.logger.debug(`Reading ${fileName}`);
        const sqlFilePath = path.join(this.sqlFilesPath, fileName);
        return await promises.readFile(sqlFilePath, 'utf8');
    }

    public async readWorkdirFile(fileName: string) {
        this.logger.debug(`Reading ${fileName}`);
        return await promises.readFile(fileName, 'utf8');
    }

    public createTempWriteStream(filePath: string) {
        this.logger.debug(`Creating temp write stream for ${filePath}`);
        return fs.createWriteStream(filePath);
    }

    public async tryReadingTokenFile() {
        try {
            return await promises.readFile(this.tokenPath, this.defaultFilesEncoding);
        } catch (e) {
            this.logger.warn(`No token file found at ${this.tokenPath}, please authenticate with Google first`);
        }
    }

    public async writeTokenFile(token: string) {
        this.logger.log(`Saving token to ${this.tokenPath}`);
        return promises.writeFile(this.tokenPath, token, this.defaultFilesEncoding);
    }
}
