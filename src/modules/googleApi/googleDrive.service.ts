import {google} from "googleapis";
import {GoogleAuthService} from "./googleAuth.service";
import * as fs from "fs";
import {Injectable, Logger} from "@nestjs/common";

@Injectable()
export class GoogleDriveService {
    private readonly logger = new Logger(GoogleDriveService.name);

    constructor(private readonly googleAuth: GoogleAuthService) {
    }


    public async uploadFile(filePath: string, folderId?: string) {
        const auth = await this.googleAuth.authenticate();
        const drive = google.drive({version: "v3", auth});

        const fileMetadata = {
            name: filePath.split("/").pop(),
            parents: folderId ? [folderId] : undefined, // Optional folder ID
        };

        const media = {
            mimeType: "application/octet-stream",
            body: fs.createReadStream(filePath),
        };

        const response = await drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: "id",
        });

        this.logger.debug("File uploaded successfully! File ID: " + response.data.id);
        return response.data.id;
    }
}