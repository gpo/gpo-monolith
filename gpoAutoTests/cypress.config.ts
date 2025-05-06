import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    baseUrl: 'https://staging.gpo.ca/',
    'testIsolation': false,
    'watchForFileChanges': false,
    // eslint-disable-next-line  @typescript-eslint/no-unused-vars
      setupNodeEvents(on, config) {
        // e2e testing node events setup code
        require('@cypress/grep/src/plugin')(config);
        return config;
    },
    specPattern: 'cypress/e2e/**/*tests.ts'
  },
})