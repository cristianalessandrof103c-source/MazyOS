const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

async function main() {
  const dir = __dirname;
  const outDir = path.join(dir, 'instagram');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
  await page.goto(`file://${path.join(dir, 'carrossel.html')}`);
  await page.waitForTimeout(300);

  const slides = await page.$$('.slide');
  for (let i = 0; i < slides.length; i++) {
    const filePath = path.join(outDir, `slide-${String(i + 1).padStart(2, '0')}.png`);
    await slides[i].screenshot({ path: filePath });
    console.log('Gerado:', filePath);
  }

  await browser.close();
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
