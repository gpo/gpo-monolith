import {Test, TestingModule} from '@nestjs/testing';
import {INestApplication} from '@nestjs/common';
import {AppModule} from '../src/app.module';
import {HistoricalContributionsReportTask} from "../src/modules/tasks/historical-contributions-report-task.service";
import {Pool, QueryResult} from "mysql2/promise";
import {drive_v3, google} from "googleapis";
import {OAuth2Client} from "google-auth-library/build/src/auth/oauth2client";
import * as fs from "node:fs";
import * as readline from "node:readline";
import {Interface} from "readline";


describe('App (e2e)', () => {
    let app: INestApplication;
    let pool: Pool;
    let drive: drive_v3.Drive;

    const credentialsJson = JSON.stringify({
        installed: {
            client_secret: '',
            client_id: '',
            redirect_uris: ''
        }
    });

    beforeEach(async () => {
        //Given
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],

        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();
        pool = moduleFixture.get('POOL');

        const mockQueryResult = [{id: 1, name: 'test1'}];

        jest.spyOn(pool, 'query').mockResolvedValue([(<QueryResult>mockQueryResult), null]);

        drive = {
            files: {
                create: jest.fn().mockResolvedValue({data: {id: 'mockFileId'}})
            } as Partial<drive_v3.Resource$Files> as drive_v3.Resource$Files
        } as drive_v3.Drive;
        jest.spyOn(google, 'drive').mockImplementation(() => drive);

        const googleOAuth2 = {
            setCredentials: jest.fn(),
            generateAuthUrl: jest.fn().mockReturnValue('mockAuthUrl'),
            getToken: jest.fn().mockResolvedValue({tokens: {}})
        } as Partial<OAuth2Client> as OAuth2Client;
        jest.spyOn(google.auth, 'OAuth2').mockImplementation(() => googleOAuth2);

        jest.spyOn(readline, 'createInterface').mockReturnValue({
            question: (_query: string, callback: (answer: string) => void) => {
                callback('mock-auth-code');
                return this;
            },
            close: jest.fn()
        } as Partial<Interface> as Interface);
    });

    it('Should run task when there is token file', async () => {
        //Given
        jest.spyOn(fs.promises, 'readFile').mockImplementation((path: string) => {
            const fileContents = {
                'credentials.json': credentialsJson,
                'token.json': {},
                'src/sql-queries/historical-contributions.sql': 'SELECT * FROM users'
            };
            return Promise.resolve(JSON.stringify(fileContents[path] ?? Promise.reject(new Error('File not found'))));
        });
        //When
        await app.get(HistoricalContributionsReportTask).execute();

        //Then
        expect(pool.query).toHaveBeenCalled();
        expect(drive.files.create).toHaveBeenCalled();
    });

    it('Should authenticate and run task when there is no token file', async () => {
        //Given
        jest.spyOn(fs.promises, 'readFile').mockImplementation((path: string) => {
            const fileContents = {
                'credentials.json': credentialsJson,
                'src/sql-queries/historical-contributions.sql': 'SELECT * FROM users'
            };
            return Promise.resolve(fileContents[path]) ?? Promise.reject(new Error('File not found'));
        });
        //When
        await app.get(HistoricalContributionsReportTask).execute();

        //Then
        expect(pool.query).toHaveBeenCalled();
        expect(drive.files.create).toHaveBeenCalled();
    });

    afterEach(async () => {
        await app.close();
        jest.clearAllMocks();
    });
});
