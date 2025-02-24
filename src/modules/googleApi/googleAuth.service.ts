import {google} from "googleapis";
import {Injectable, Logger} from "@nestjs/common";
import * as readline from "node:readline";
import * as process from "node:process";
import {FilesystemService} from "../filesystem/filesystem.service";


@Injectable()
export class GoogleAuthService {
    private readonly logger = new Logger(GoogleAuthService.name);

    private readonly SCOPES = ["https://www.googleapis.com/auth/drive.file"];

    constructor(private readonly filesystem: FilesystemService) {
    }

    public async authenticate() {
        const keyFile = await this.filesystem.readWorkdirFile("credentials.json");
        const auth = new google.auth.GoogleAuth({
            keyFile,
            scopes: this.SCOPES,
        });

        const authClient = await auth.getClient();
        this.logger.debug("Authenticated using service account");

        return authClient;
    }
}
