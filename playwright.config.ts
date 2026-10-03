import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:'./test/browser',testMatch:'*.spec.ts',workers:1,fullyParallel:false,
  forbidOnly:!!process.env.CI,retries:0,timeout:30_000,
  reporter:[['list'],['json',{outputFile:'test-results/browser-report.json'}]],
  outputDir:'test-results/browser',
  // Room credentials must never enter a network trace or video artifact.
  use:{browserName:'chromium',headless:true,viewport:{width:1280,height:900},trace:'off',video:'off',screenshot:'only-on-failure'},
});
