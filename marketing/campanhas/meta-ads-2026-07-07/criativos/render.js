const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
  await page.goto('file://' + path.resolve(__dirname, 'criativos.html'));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);

  const slides = await page.$$('.slide');
  for (let i = 0; i < slides.length; i++) {
    const file = path.resolve(__dirname, `criativo-${i + 1}.png`);
    await slides[i].screenshot({ path: file });
    console.log('salvo:', file);
  }

  await browser.close();
})();
