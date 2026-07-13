const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { marked } = require('marked');

const DIR = path.join(__dirname, '..', 'comercial');
const OUT_DIR = path.join(DIR, 'pdf');

const ARQUIVOS = [
  'briefing-captacao-leads.md',
  'roteiro-prospeccao-telefone.md',
  'roteiro-reuniao-vendas.md',
];

const CSS = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: 'Segoe UI', Roboto, Arial, sans-serif;
    font-size: 11.5pt;
    line-height: 1.55;
    color: #1c1d26;
    background: #ffffff;
  }
  .doc { padding: 4mm 2mm 8mm 2mm; }

  h1 {
    font-size: 22pt;
    font-weight: 700;
    margin: 0 0 4mm 0;
    padding-bottom: 4mm;
    border-bottom: 3px solid #8b5cf6;
    color: #0f1020;
  }
  h1::before {
    content: 'BK SOLUTIONS · COMERCIAL';
    display: block;
    font-size: 8.5pt;
    font-weight: 700;
    letter-spacing: 1.5px;
    color: #8b5cf6;
    margin-bottom: 2mm;
  }

  h2 {
    font-size: 13.5pt;
    font-weight: 700;
    color: #ffffff;
    background: linear-gradient(90deg, #6d28d9, #0891b2);
    padding: 2.5mm 4mm;
    border-radius: 3px;
    margin: 7mm 0 3.5mm 0;
    page-break-after: avoid;
  }

  h3 {
    font-size: 11.5pt;
    font-weight: 700;
    color: #6d28d9;
    margin: 5mm 0 2mm 0;
    page-break-after: avoid;
  }

  p { margin: 0 0 3mm 0; }

  blockquote {
    margin: 3mm 0;
    padding: 3mm 4mm;
    background: #f6f3ff;
    border-left: 4px solid #8b5cf6;
    border-radius: 0 4px 4px 0;
    font-style: italic;
    color: #2a1e4d;
    page-break-inside: avoid;
  }
  blockquote p { margin: 0; }
  blockquote p + p { margin-top: 2mm; }

  ul, ol { margin: 0 0 3mm 0; padding-left: 5mm; }
  li { margin-bottom: 1.5mm; }

  hr {
    border: none;
    border-top: 1px solid #e2dcf5;
    margin: 5mm 0;
  }

  strong { color: #5b21b6; font-weight: 700; }

  code {
    font-family: 'Consolas', monospace;
    font-size: 9.5pt;
    background: #f1eefb;
    color: #4c1d95;
    padding: 0.5mm 1.2mm;
    border-radius: 3px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 3mm 0 5mm 0;
    font-size: 10pt;
    page-break-inside: auto;
  }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th {
    background: #6d28d9;
    color: #ffffff;
    text-align: left;
    padding: 2.2mm 3mm;
    font-weight: 700;
  }
  td {
    padding: 2.2mm 3mm;
    border-bottom: 1px solid #e9e4f7;
    vertical-align: top;
  }
  tr:nth-child(even) td { background: #faf9fd; }
`;

function wrapHtml(bodyHtml) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>${CSS}</style>
</head>
<body><div class="doc">${bodyHtml}</div></body>
</html>`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (const nomeArquivo of ARQUIVOS) {
    const mdPath = path.join(DIR, nomeArquivo);
    const md = fs.readFileSync(mdPath, 'utf-8');
    const bodyHtml = marked.parse(md, { gfm: true });
    const html = wrapHtml(bodyHtml);

    await page.setContent(html, { waitUntil: 'load' });

    const pdfPath = path.join(OUT_DIR, nomeArquivo.replace(/\.md$/, '.pdf'));
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '15mm', right: '15mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `
        <div style="font-family: Arial, sans-serif; font-size: 7.5pt; color: #9a9db3; width: 100%; text-align: center;">
          <span class="pageNumber"></span> / <span class="totalPages"></span>
        </div>`,
    });
    console.log('Gerado:', pdfPath);
  }

  await browser.close();
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
