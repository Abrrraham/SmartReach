import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5173/workbench', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const tabs = page.locator('button.tab-list__item');
await tabs.first().waitFor({ state: 'visible', timeout: 10000 });
if (await tabs.count() >= 2) {
  await tabs.nth(1).click();
}
const buttons = await page.locator('.panel-section button').all();
for (let i = 0; i < buttons.length; i++) {
  const text = await buttons[i].innerText();
  console.log(`[button ${i}] ${text}`);
}
await browser.close();
