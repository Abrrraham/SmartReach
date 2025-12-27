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
const btn = page.locator('button', { hasText: '¿òÑ¡·¶Î§' });
console.log('count', await btn.count());
if (await btn.count()) {
  await btn.first().click({ force: true });
}
await page.waitForTimeout(500);
const state = await page.evaluate(() => {
  const appEl = document.querySelector('#app');
  const app = appEl && appEl.__vue_app__;
  if (!app) return null;
  const provides = app._context && app._context.provides;
  const symbols = provides ? Object.getOwnPropertySymbols(provides) : [];
  const piniaSym = symbols.find((sym) => {
    const val = provides[sym];
    return val && typeof val === 'object' && val._s && val._p;
  });
  const pinia = piniaSym ? provides[piniaSym] : null;
  const store = pinia && pinia._s && pinia._s.get('app');
  return { bboxPickArmed: store?.ui?.bboxPickArmed, mapHint: store?.ui?.mapHint };
});
console.log(state);
await browser.close();
