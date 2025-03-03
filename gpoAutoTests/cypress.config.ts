import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    baseUrl: 'https://staging.gpo.ca/',
    'testIsolation': false,
    'watchForFileChanges': false,
      setupNodeEvents(on, config) {
        // e2e testing node events setup code
    },
    specPattern: 'cypress/e2e/**/*tests.ts'
  },
})