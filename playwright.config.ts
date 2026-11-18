import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

// Đọc .env.local (Supabase URL + key) giống Next.js
loadEnvConfig(process.cwd());

const PORT = Number(process.env.TEST_PORT ?? 3100);
export const BASE_URL = process.env.TEST_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  // CI: thử lại 1 lần cho test e2e chập chờn do mạng; không cho lọt test.only
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "unit", testMatch: /unit\/.*\.spec\.ts/ },
    { name: "security", testMatch: /security\/.*\.spec\.ts/ },
    {
      name: "e2e",
      testMatch: /e2e\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: process.env.TEST_BASE_URL
    ? undefined
    : {
        command: `npx next build && npx next start -p ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
