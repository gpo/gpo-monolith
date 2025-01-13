# Green Party of Ontario

### Adding access to Google Drive
1. Go to the Google Cloud Console. https://console.cloud.google.com/
1. Create a new project or select an existing project.
1. Navigate to APIs & Services > Library.
1. Search for Google Drive API and click Enable.
1. Go to APIs & Services > Credentials. https://console.cloud.google.com/apis/credentials
1. Click Create Credentials and select OAuth 2.0 Client ID.
1. Configure the consent screen (if required).
1. Choose Desktop App as the application type.
1. Download the JSON file for the credentials and save it as `credentials.json` in your project root folder.

### Running locally
`npx tsc && node dist/index.js`