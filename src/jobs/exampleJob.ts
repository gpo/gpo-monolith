import {injectable} from "inversify";
import {uploadFile} from "../utils/googleDrive";
import pool from "../utils/mysql";
import * as fs from "fs";
import {writeToStream} from "fast-csv";
import {QueryResult} from "mysql2";

@injectable()
export class ExampleJob {
    public async execute(): Promise<void> {
        console.log("Executing ExampleJob...");
        const filePath = "testfile.csv";
        const folderId = "1wWN4940ZG0lUTCK2nCDIzNhn7xZ5N5RP"; // Replace with Google Drive folder ID

        let users = await this.getUsers();
        await this.exportQueryToCsv(users, filePath);

        console.log(users);
        try {
            await uploadFile(filePath, folderId);
        } catch (error) {
            console.error("Error uploading file:", error);
            throw error;
        }

    }

    private async getUsers(): Promise<QueryResult> {
        try {
            const [rows] = await pool.query(
                "SELECT id, name, email, created_at FROM users"
            );
            return rows; // Rows contain the result of the query
        } catch (error) {
            console.error("Error querying database:", error);
            throw error;
        }
    }


    private async exportQueryToCsv(rows: QueryResult, filePath: string): Promise<void> {
        try {
            // Create a write stream for the CSV file
            const writeStream = fs.createWriteStream(filePath);

            // Use fast-csv to write data to the stream
            writeToStream(writeStream, rows as object[], {headers: true})
                .on("error", (error) => {
                    console.error("Error writing to CSV:", error);
                    throw error;
                })
                .on("finish", () => {
                    console.log(`Data exported successfully to ${filePath}`);
                });
        } catch (error) {
            console.error("Error exporting data to CSV:", error);
            throw error;
        }
    }

}
