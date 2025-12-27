import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
const body = await page.innerHTML('body');
console.log(body.slice(0, 500));
await browser.close();
