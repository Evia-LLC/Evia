import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./e2e',timeout:30000,workers:1,retries:0,
  reporter:[['list']],
  use:{baseURL:process.env.EVIA_TEST_BASE_URL??'http://127.0.0.1:5195',headless:true,viewport:{width:1280,height:900},launchOptions:{args:['--no-sandbox','--enable-unsafe-swiftshader']},screenshot:'only-on-failure',trace:'retain-on-failure'},
  webServer:process.env.EVIA_TEST_BASE_URL?undefined:{command:'npm run dev:web -- --host 127.0.0.1',url:'http://127.0.0.1:5195',reuseExistingServer:!process.env.CI,timeout:30000},
});
