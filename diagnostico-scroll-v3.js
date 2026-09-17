// ============================================================
// DIAGNÓSTICO DE SCROLL v3 — Central Workcell
// Rode isso ENQUANTO estiver na tela de Garantia (Bookip) travada.
// ============================================================
(function () {
  const out = [];
  const log = (s) => out.push(s);

  log('=== DIAGNÓSTICO DE SCROLL v3 (foco: estilo inline) ===');
  log('Data: ' + new Date());
  log('URL: ' + location.href);
  log('');

  const el = document.getElementById('areaBookipWrapper');
  if (!el) {
    log('areaBookipWrapper NÃO ENCONTRADO no DOM! (a tela nem existe ainda?)');
    console.log(out.join('\n'));
    return;
  }

  log('--- areaBookipWrapper ---');
  log('ESTILO INLINE (attribute "style" bruto, sem CSS de arquivo): ' + JSON.stringify(el.getAttribute('style')));
  log('classList: ' + el.className);
  log('scrollHeight: ' + el.scrollHeight + 'px | clientHeight: ' + el.clientHeight + 'px');
  log('PRECISA rolar? ' + (el.scrollHeight > el.clientHeight ? 'SIM' : 'NÃO'));
  log('');

  log('--- CADEIA COMPLETA (elemento → html) ---');
  let cur = el;
  let nivel = 0;
  while (cur && cur !== document.documentElement.parentElement) {
    const cs = getComputedStyle(cur);
    const r = cur.getBoundingClientRect();
    const nomeEl = cur.tagName + (cur.id ? '#' + cur.id : '') + (cur.className && typeof cur.className === 'string' ? '.' + cur.className.trim().split(/\s+/).join('.') : '');

    log(`\n[Nível ${nivel}] ${nomeEl}`);
    log(`  ESTILO INLINE bruto: ${JSON.stringify(cur.getAttribute('style'))}`);
    log(`  rect: ${r.width.toFixed(0)}x${r.height.toFixed(0)} (top=${r.top.toFixed(0)})`);
    log(`  overflow-y: ${cs.overflowY} | overflow-x: ${cs.overflowX}`);
    log(`  height: ${cs.height} | min-height: ${cs.minHeight} | max-height: ${cs.maxHeight}`);
    log(`  display: ${cs.display} | position: ${cs.position}`);
    log(`  transform: ${cs.transform !== 'none' ? cs.transform : 'none'}`);
    log(`  scrollHeight: ${cur.scrollHeight} | clientHeight: ${cur.clientHeight}`);

    if (cur === document.body || cur === document.documentElement) break;
    cur = cur.parentElement;
    nivel++;
  }

  // Compara com documentsHome (que funciona) pra diferença lado a lado
  log('\n\n--- COMPARAÇÃO: #documentsHome (tela que FUNCIONA) ---');
  const docHome = document.getElementById('documentsHome');
  if (docHome) {
    const cs2 = getComputedStyle(docHome);
    log('ESTILO INLINE bruto: ' + JSON.stringify(docHome.getAttribute('style')));
    log('display: ' + cs2.display + ' | position: ' + cs2.position);
    log('overflow-y: ' + cs2.overflowY);
    log('scrollHeight: ' + docHome.scrollHeight + ' | clientHeight: ' + docHome.clientHeight);
  } else {
    log('(documentsHome não está no DOM agora — normal se você não passou por lá nesta sessão)');
  }

  // Lista TODOS os filhos diretos de areaBookipWrapper com suas alturas,
  // pra achar se algum filho específico tem altura absurda ou 0
  log('\n\n--- FILHOS DIRETOS de areaBookipWrapper (procurando altura estranha) ---');
  Array.from(el.children).forEach((child, i) => {
    const r = child.getBoundingClientRect();
    const nomeEl = child.tagName + (child.id ? '#' + child.id : '');
    log(`[${i}] ${nomeEl} — height: ${r.height.toFixed(0)}px | display: ${getComputedStyle(child).display}`);
  });

  log('\n--- VIEWPORT ---');
  log('window.innerHeight: ' + window.innerHeight);
  log('document.body.scrollHeight: ' + document.body.scrollHeight);

  const resultado = out.join('\n');
  console.log(resultado);
  try {
    navigator.clipboard.writeText(resultado);
    console.log('%c✅ Copiado para a área de transferência!', 'color: lime; font-weight: bold;');
  } catch (e) {}
})();
