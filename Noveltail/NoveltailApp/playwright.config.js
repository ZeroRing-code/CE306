const { defineConfig } = require("@playwright/test");

const port = Number(process.env.E2E_PORT || 3101);

module.exports = defineConfig({
    testDir: "./tests/e2e",
    testMatch: "**/*.spec.js",
    timeout: 45_000,
    expect: { timeout: 8_000 },
    use: {
        baseURL: `http://127.0.0.1:${port}`,
        headless: true,
        browserName: "chromium"
    },
    webServer: {
        command: "node server.js",
        url: `http://127.0.0.1:${port}/api/test-db`,
        reuseExistingServer: false,
        timeout: 60_000,
        env: {
            ...process.env,
            PORT: String(port),
            TRUST_PROXY_HOPS: "1"
        }
    }
});
