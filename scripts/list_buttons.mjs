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
const buttonTexts = await page.evaluate(() =>
  Array.from(document.querySelectorAll('button')).map((btn) => btn.textContent)
);
buttonTexts.forEach((text, index) => {
  console.log(index, JSON.stringify(text));
});
await browser.close();
