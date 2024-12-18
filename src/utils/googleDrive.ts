import { google } from "googleapis";
import { authenticate } from "./googleAuth";
import fs from "fs";

export async function uploadFile(filePath: string, folderId?: string) {
    const auth = await authenticate();
    const drive = google.drive({ version: "v3", auth });

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

    console.log("File uploaded successfully! File ID:", response.data.id);
    return response.data.id;
}
