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
await page.waitForTimeout(500);
const panelText = await page.locator('.panel-section').first().innerText();
console.log(panelText.slice(0, 500));
await browser.close();
