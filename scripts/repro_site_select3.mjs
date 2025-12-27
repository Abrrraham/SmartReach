import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('console', (msg) => {
  console.log(`[console.${msg.type()}] ${msg.text()}`);
});

page.on('pageerror', (error) => {
  console.log(`[pageerror] ${error.stack || error.message}`);
});

await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
const content = await page.content();
console.log(content.slice(0, 500));
await browser.close();
