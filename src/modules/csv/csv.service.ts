import {Injectable} from '@nestjs/common';
import {writeToStream} from "fast-csv";
import console from "node:console";

@Injectable()
export class CsvService {

    constructor() {
    }

    public async exportQueryToCsv(rows: object[], writeStream: NodeJS.WritableStream): Promise<void> {
        try {
            // Use fast-csv to write data to the stream
            writeToStream(writeStream, rows, {headers: true})

        } catch (error) {
            console.error("Error exporting data to CSV:", error);
            throw error;
        }
    }
}
