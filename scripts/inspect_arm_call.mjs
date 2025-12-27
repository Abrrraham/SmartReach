import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5173/workbench', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const result = await page.evaluate(() => {
  const appEl = document.querySelector('#app');
  const app = appEl && appEl.__vue_app__;
  if (!app) return { ok: false };
  const provides = app._context && app._context.provides;
  const symbols = provides ? Object.getOwnPropertySymbols(provides) : [];
  const piniaSym = symbols.find((sym) => {
    const val = provides[sym];
    return val && typeof val === 'object' && val._s && val._p;
  });
  const pinia = piniaSym ? provides[piniaSym] : null;
  const store = pinia && pinia._s && pinia._s.get('app');
  if (!store) return { ok: false };
  store.armBboxPick();
  return { ok: true, bboxPickArmed: store.ui.bboxPickArmed, mapHint: store.ui.mapHint };
});
console.log(result);
await browser.close();
