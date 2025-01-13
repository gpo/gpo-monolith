import {google} from "googleapis";
import fs from "fs";
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
        const credentials = JSON.parse(fs.readFileSync("credentials.json", "utf-8"));
        const {client_secret, client_id, redirect_uris} = credentials.installed;
        const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

        // Check if we have a previously stored token
        const token = await this.filesystem.tryReadingTokenFile();
        if (token) {
            this.logger.debug("Reusing existing token");
            oAuth2Client.setCredentials(JSON.parse(token));
            return oAuth2Client;
        }

        // Generate a new token if not available
        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: "offline",
            scope: this.SCOPES,
        });
        this.logger.warn("Authorize this app by visiting this URL:", authUrl);

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        const getAccessToken = () =>
            new Promise<string>((resolve) =>
                rl.question("Enter the code from that page here: ", (code) => {
                    rl.close();
                    resolve(code);
                })
            );

        const code = await getAccessToken();
        const tokenResponse = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokenResponse.tokens);

        // Save the token for future use
        await this.filesystem.writeTokenFile(JSON.stringify(tokenResponse.tokens));

        return oAuth2Client;
    }
}
