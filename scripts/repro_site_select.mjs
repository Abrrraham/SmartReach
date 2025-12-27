import { chromium } from 'playwright';

const logs = [];
const errors = [];

function pushLog(entry) {
  logs.push(entry);
  console.log(entry);
}

function toSerializable(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj;
  }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('console', (msg) => {
  const text = msg.text();
  const type = msg.type();
  pushLog(`[console.${type}] ${text}`);
});

page.on('pageerror', (error) => {
  errors.push(error);
  pushLog(`[pageerror] ${error.stack || error.message}`);
});

await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const analysisTab = page.locator('button.tab-list__item', { hasText: '分析' });
if (await analysisTab.count()) {
  await analysisTab.first().click();
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

const map = page.locator('.map-canvas');
await map.waitFor({ state: 'visible', timeout: 10000 });
const box = await map.boundingBox();
if (box) {
  const start = { x: box.x + box.width * 0.2, y: box.y + box.height * 0.2 };
  const end = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

await page.waitForTimeout(2000);

await page.evaluate(() => {
  const appEl = document.querySelector('#app');
  const app = appEl && (appEl).__vue_app__;
  const pinia = app && app._context && app._context.provides && app._context.provides.pinia;
  const store = pinia && pinia._s && pinia._s.get('app');
  if (!store) {
    console.log('[debug] store not found');
    return;
  }
  console.log('[debug] before runSiteSelection', {
    siteRunning: store.siteEngine?.running,
    siteBbox: store.siteEngine?.bbox,
    siteStats: store.siteEngine?.bboxStats,
    poiBuilding: store.poiEngine?.buildingIndex,
    selectedGroups: store.poiEngine?.selectedGroups,
    overlay: store.ui?.overlay
  });
});

const startBtn = page.locator('button.button--primary', { hasText: '开始选址' });
if (await startBtn.count()) {
  await startBtn.first().click();
}

await page.waitForTimeout(4000);

await page.evaluate(() => {
  const appEl = document.querySelector('#app');
  const app = appEl && (appEl).__vue_app__;
  const pinia = app && app._context && app._context.provides && app._context.provides.pinia;
  const store = pinia && pinia._s && pinia._s.get('app');
  if (!store) {
    console.log('[debug] store not found after');
    return;
  }
  console.log('[debug] after runSiteSelection', {
    siteRunning: store.siteEngine?.running,
    siteResults: store.siteEngine?.results?.length,
    poiError: store.poiEngine?.error,
    siteError: store.siteEngine?.error,
    overlay: store.ui?.overlay
  });
});

await browser.close();
