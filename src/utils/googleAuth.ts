import { google } from "googleapis";
import fs from "fs";
import readline from "readline";
import path from "path";

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const TOKEN_PATH = path.join(__dirname, "token.json");

export async function authenticate() {
    const credentials = JSON.parse(fs.readFileSync("credentials.json", "utf-8"));
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    // Check if we have a previously stored token
    if (fs.existsSync(TOKEN_PATH)) {
        const token = fs.readFileSync(TOKEN_PATH, "utf-8");
        oAuth2Client.setCredentials(JSON.parse(token));
        return oAuth2Client;
    }

    // Generate a new token if not available
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: "offline",
        scope: SCOPES,
    });

    console.log("Authorize this app by visiting this URL:", authUrl);

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
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenResponse.tokens));
    console.log("Token stored to", TOKEN_PATH);

    return oAuth2Client;
}
