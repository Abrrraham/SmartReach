import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5173/workbench', { waitUntil: 'networkidle' });
const info = await page.evaluate(() => {
  const el = document.querySelector('#app');
  const app = el && el.__vue_app__;
  if (!app) return { hasApp: false };
  const provides = app._context && app._context.provides;
  if (!provides) return { hasApp: true, hasProvides: false };
  const symbols = Object.getOwnPropertySymbols(provides);
  const piniaEntry = symbols.find((sym) => {
    const val = provides[sym];
    return val && typeof val === 'object' && val._s && val._p;
  });
  const pinia = piniaEntry ? provides[piniaEntry] : null;
  return {
    hasApp: true,
    providesSymbolCount: symbols.length,
    hasPinia: Boolean(pinia),
    storeIds: pinia ? Array.from(pinia._s.keys()) : []
  };
});
console.log(info);
await browser.close();
