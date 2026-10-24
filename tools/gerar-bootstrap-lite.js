#!/usr/bin/env node
/* Gera bootstrap-lite.css: o Bootstrap só com as classes que o app usa.
   Uso: npm i purgecss bootstrap && node tools/gerar-bootstrap-lite.js <pasta-do-app> <pasta-do-pacote-bootstrap>
   Lê index.html e os .js do app (sem comentários HTML) e escreve <pasta-do-app>/bootstrap-lite.css.
   Rode de novo sempre que usar uma classe do Bootstrap que ainda não estava em uso. */
const fs = require('fs'), os = require('os'), path = require('path');
const { PurgeCSS } = require('purgecss');
const app = process.argv[2], pkg = process.argv[3];
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctw-purge-')), files = [];
  for (const f of fs.readdirSync(app).filter(f => /\.(js|html)$/.test(f) && f !== 'sw.js')) {
    let t = fs.readFileSync(path.join(app, f), 'utf8');
    if (f.endsWith('.html')) t = t.replace(/<!--[\s\S]*?-->/g, '');
    fs.writeFileSync(path.join(tmp, f), t); files.push(path.join(tmp, f));
  }
  const r = await new PurgeCSS().purge({
    content: files,
    css: [path.join(pkg, 'dist/css/bootstrap.min.css')],
    // classes que o ctw-ui.js liga e desliga em tempo de execução
    safelist: { standard: ['collapsing', 'collapse', 'show', 'showing', 'hiding', 'fade', 'active', 'disabled', 'collapsed', 'offcanvas-backdrop'], greedy: [/data-bs-popper/] },
    variables: false, keyframes: true, fontFace: false
  });
  fs.writeFileSync(path.join(app, 'bootstrap-lite.css'), r[0].css);
  console.log('bootstrap-lite.css:', r[0].css.length, 'bytes');
})();
