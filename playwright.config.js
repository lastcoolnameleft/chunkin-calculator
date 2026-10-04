const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://127.0.0.1:3088', browserName: 'chromium' },
  webServer: {
    command: 'node e2e/server.js',
    url: 'http://127.0.0.1:3088',
    reuseExistingServer: false
  }
});
