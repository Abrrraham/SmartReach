import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('console', (msg) => {
  console.log(`[console.${msg.type()}] ${msg.text()}`);
});

page.on('pageerror', (error) => {
  console.log(`[pageerror] ${error.stack || error.message}`);
});

await page.goto('http://127.0.0.1:5173/workbench', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

await page.evaluate(() => {
  const appEl = document.querySelector('#app');
  const app = appEl && appEl.__vue_app__;
  if (!app) return;
  const provides = app._context && app._context.provides;
  const symbols = provides ? Object.getOwnPropertySymbols(provides) : [];
  const piniaSym = symbols.find((sym) => {
    const val = provides[sym];
    return val && typeof val === 'object' && val._s && val._p;
  });
  const pinia = piniaSym ? provides[piniaSym] : null;
  const store = pinia && pinia._s && pinia._s.get('app');
  if (!store) return;
  store.setSiteTargetGroup('food');
  store.setSiteBbox([118.75, 32.05, 118.78, 32.07]);
  console.log('[debug] set bbox + target');
});

await page.waitForFunction(() => {
  const appEl = document.querySelector('#app');
  const app = appEl && appEl.__vue_app__;
  if (!app) return false;
  const provides = app._context && app._context.provides;
  const symbols = provides ? Object.getOwnPropertySymbols(provides) : [];
  const piniaSym = symbols.find((sym) => {
    const val = provides[sym];
    return val && typeof val === 'object' && val._s && val._p;
  });
  const pinia = piniaSym ? provides[piniaSym] : null;
  const store = pinia && pinia._s && pinia._s.get('app');
  return Boolean(store && store.siteEngine && store.siteEngine.bboxStats);
}, { timeout: 20000 });

await page.evaluate(() => {
  const appEl = document.querySelector('#app');
  const app = appEl && appEl.__vue_app__;
  if (!app) return;
  const provides = app._context && app._context.provides;
  const symbols = provides ? Object.getOwnPropertySymbols(provides) : [];
  const piniaSym = symbols.find((sym) => {
    const val = provides[sym];
    return val && typeof val === 'object' && val._s && val._p;
  });
  const pinia = piniaSym ? provides[piniaSym] : null;
  const store = pinia && pinia._s && pinia._s.get('app');
  if (!store) return;
  console.log('[debug] before runSiteSelection', {
    siteRunning: store.siteEngine?.running,
    siteBbox: store.siteEngine?.bbox,
    siteStats: store.siteEngine?.bboxStats,
    poiBuilding: store.poiEngine?.buildingIndex,
    selectedGroups: store.poiEngine?.selectedGroups,
    overlay: store.ui?.overlay
  });
  store.runSiteSelectionTopN();
});

await page.waitForTimeout(6000);

await page.evaluate(() => {
  const appEl = document.querySelector('#app');
  const app = appEl && appEl.__vue_app__;
  if (!app) return;
  const provides = app._context && app._context.provides;
  const symbols = provides ? Object.getOwnPropertySymbols(provides) : [];
  const piniaSym = symbols.find((sym) => {
    const val = provides[sym];
    return val && typeof val === 'object' && val._s && val._p;
  });
  const pinia = piniaSym ? provides[piniaSym] : null;
  const store = pinia && pinia._s && pinia._s.get('app');
  if (!store) return;
  console.log('[debug] after runSiteSelection', {
    siteRunning: store.siteEngine?.running,
    siteResults: store.siteEngine?.results?.length,
    poiError: store.poiEngine?.error,
    siteError: store.siteEngine?.error,
    overlay: store.ui?.overlay
  });
});

await browser.close();
