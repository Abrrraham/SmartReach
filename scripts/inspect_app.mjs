import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5173/workbench', { waitUntil: 'networkidle' });
const info = await page.evaluate(() => {
  const el = document.querySelector('#app');
  if (!el) return { exists: false };
  return {
    exists: true,
    keys: Object.keys(el),
    hasVue: '__vue_app__' in el,
    vueAppType: typeof el.__vue_app__
  };
});
console.log(info);
await browser.close();
