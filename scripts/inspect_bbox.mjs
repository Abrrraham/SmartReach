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

const tabs = page.locator('button.tab-list__item');
await tabs.first().waitFor({ state: 'visible', timeout: 10000 });
if (await tabs.count() >= 2) {
  await tabs.nth(1).click();
}

const select = page.locator('#site-group-select');
await select.waitFor({ state: 'visible', timeout: 10000 });
const options = await select.locator('option').all();
if (options.length > 1) {
  const value = await options[1].getAttribute('value');
  if (value) {
    await select.selectOption(value);
  }
}

const bboxButton = page.locator('button.button--ghost', { hasText: '¿òÑ¡·¶Î§' });
if (await bboxButton.count()) {
  await bboxButton.first().click();
}

await page.waitForTimeout(500);

await page.evaluate(() => {
  const appEl = document.querySelector('#app');
  const app = appEl && appEl.__vue_app__;
  if (!app) {
    console.log('[debug] store not found');
    return;
  }
  const provides = app._context && app._context.provides;
  if (!provides) {
    console.log('[debug] store not found');
    return;
  }
  const symbols = Object.getOwnPropertySymbols(provides);
  const piniaSym = symbols.find((sym) => {
    const val = provides[sym];
    return val && typeof val === 'object' && val._s && val._p;
  });
  const pinia = piniaSym ? provides[piniaSym] : null;
  const store = pinia && pinia._s && pinia._s.get('app');
  console.log('[debug] after arm bbox', {
    bboxPickArmed: store?.ui?.bboxPickArmed,
    mapHint: store?.ui?.mapHint
  });
});

const map = page.locator('.map-canvas');
await map.waitFor({ state: 'visible', timeout: 10000 });
const box = await map.boundingBox();
if (box) {
  const start = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.25 };
  const end = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.55 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

await page.waitForTimeout(4000);

await page.evaluate(() => {
  const appEl = document.querySelector('#app');
  const app = appEl && appEl.__vue_app__;
  if (!app) {
    console.log('[debug] store not found');
    return;
  }
  const provides = app._context && app._context.provides;
  if (!provides) {
    console.log('[debug] store not found');
    return;
  }
  const symbols = Object.getOwnPropertySymbols(provides);
  const piniaSym = symbols.find((sym) => {
    const val = provides[sym];
    return val && typeof val === 'object' && val._s && val._p;
  });
  const pinia = piniaSym ? provides[piniaSym] : null;
  const store = pinia && pinia._s && pinia._s.get('app');
  console.log('[debug] after drag', {
    siteBbox: store?.siteEngine?.bbox,
    siteStats: store?.siteEngine?.bboxStats,
    bboxPickArmed: store?.ui?.bboxPickArmed
  });
});

await browser.close();
