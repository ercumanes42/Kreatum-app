import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: process.env.KREATUM_E2E_PREBUILT === 'true'
      ? 'npm run preview -- --host 127.0.0.1 --port 4173'
      : 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      VITE_FIREBASE_API_KEY: 'demo-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'demo-kreatum.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'demo-kreatum',
      VITE_FIREBASE_STORAGE_BUCKET: process.env.VITE_FIREBASE_STORAGE_BUCKET || 'demo-kreatum.appspot.com',
      VITE_KREATUM_DATA_MODEL: 'v2',
      VITE_DEFAULT_ORGANIZATION_ID: 'org-e2e',
      VITE_FIREBASE_FUNCTIONS_REGION: 'europe-west1',
      VITE_FIREBASE_USE_EMULATORS: process.env.VITE_FIREBASE_USE_EMULATORS || 'false',
      VITE_PRIVACY_POLICY_URL: process.env.VITE_PRIVACY_POLICY_URL || 'http://127.0.0.1:4173/privacidad',
      VITE_TERMS_URL: process.env.VITE_TERMS_URL || 'http://127.0.0.1:4173/condiciones',
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});