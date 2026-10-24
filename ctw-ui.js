/* Componentes de interface próprios (substituem o JavaScript do Bootstrap).
   Cobrem só o que o app usa: Collapse (accordions), Tab, Offcanvas (painel de notificações) e Dropdown.
   Expõem window.bootstrap com a mesma API mínima (getOrCreateInstance, getInstance, show, hide, toggle)
   e os mesmos eventos (show.bs.collapse, shown.bs.collapse, show.bs.offcanvas, hidden.bs.offcanvas...). */
(function () {
  'use strict';
  var DUR = 350;
  var store = new WeakMap();

  function emit(el, name) {
    return el.dispatchEvent(new CustomEvent(name, { bubbles: true, cancelable: true }));
  }
  function reflow(el) { return el.offsetHeight; }
  function afterTransition(el, fn) {
    var done = false;
    function finish() { if (done) return; done = true; el.removeEventListener('transitionend', onEnd); clearTimeout(timer); fn(); }
    function onEnd(e) { if (e.target === el) finish(); }
    el.addEventListener('transitionend', onEnd);
    var timer = setTimeout(finish, DUR + 50);
  }
  function resolve(trigger) {
    var sel = trigger.getAttribute('data-bs-target') || trigger.getAttribute('href');
    if (!sel || sel.charAt(0) !== '#' || sel.length < 2) return null;
    try { return document.querySelector(sel); } catch (e) { return null; }
  }
  // Cada componente guarda uma instância por elemento e oferece getInstance / getOrCreateInstance
  function component(Ctor, name) {
    Ctor.getInstance = function (el) { var m = store.get(el); return (m && m[name]) || null; };
    Ctor.getOrCreateInstance = function (el, cfg) { return Ctor.getInstance(el) || new Ctor(el, cfg); };
    return Ctor;
  }
  function register(el, name, inst) { var m = store.get(el) || {}; m[name] = inst; store.set(el, m); }

  /* ---------- Collapse ---------- */
  var Collapse = component(function Collapse(el, cfg) {
    this.el = el; this.busy = false;
    register(el, 'collapse', this);
    if (cfg && cfg.toggle) this.toggle();
  }, 'collapse');
  function setTriggers(el, open) {
    if (!el.id) return;
    var list = document.querySelectorAll('[data-bs-toggle="collapse"][data-bs-target="#' + el.id + '"], [data-bs-toggle="collapse"][href="#' + el.id + '"]');
    for (var i = 0; i < list.length; i++) {
      list[i].classList.toggle('collapsed', !open);
      list[i].setAttribute('aria-expanded', open ? 'true' : 'false');
    }
  }
  Collapse.prototype.toggle = function () { this[this.el.classList.contains('show') ? 'hide' : 'show'](); };
  Collapse.prototype.show = function () {
    var el = this.el, self = this;
    if (this.busy || el.classList.contains('show')) return;
    if (!emit(el, 'show.bs.collapse')) return;
    var parentSel = el.getAttribute('data-bs-parent'), parent = parentSel && document.querySelector(parentSel);
    if (parent) { // accordion: fecha os irmãos abertos
      var abertos = parent.querySelectorAll('.collapse.show');
      for (var i = 0; i < abertos.length; i++) {
        if (abertos[i] !== el && abertos[i].getAttribute('data-bs-parent') === parentSel) Collapse.getOrCreateInstance(abertos[i], { toggle: false }).hide();
      }
    }
    this.busy = true;
    el.classList.remove('collapse'); el.classList.add('collapsing'); el.style.height = '0px';
    setTriggers(el, true);
    var h = el.scrollHeight; reflow(el); el.style.height = h + 'px';
    afterTransition(el, function () {
      el.classList.remove('collapsing'); el.classList.add('collapse', 'show'); el.style.height = '';
      self.busy = false; emit(el, 'shown.bs.collapse');
    });
  };
  Collapse.prototype.hide = function () {
    var el = this.el, self = this;
    if (this.busy || !el.classList.contains('show')) return;
    if (!emit(el, 'hide.bs.collapse')) return;
    this.busy = true;
    el.style.height = el.getBoundingClientRect().height + 'px'; reflow(el);
    el.classList.add('collapsing'); el.classList.remove('collapse', 'show'); el.style.height = '';
    setTriggers(el, false);
    afterTransition(el, function () {
      el.classList.remove('collapsing'); el.classList.add('collapse');
      self.busy = false; emit(el, 'hidden.bs.collapse');
    });
  };

  /* ---------- Tab ---------- */
  var Tab = component(function Tab(el) { this.el = el; register(el, 'tab', this); }, 'tab');
  function activatePane(pane, on) {
    if (!pane) return;
    if (on) {
      pane.classList.add('active');
      if (pane.classList.contains('fade')) { reflow(pane); pane.classList.add('show'); }
    } else {
      pane.classList.remove('show', 'active');
    }
  }
  Tab.prototype.show = function () {
    var t = this.el;
    if (t.classList.contains('active')) return;
    var nav = t.closest('.nav, .list-group'), prev = nav && nav.querySelector('.active[data-bs-toggle="tab"]');
    if (!emit(t, 'show.bs.tab')) return;
    var pane = resolve(t);
    if (prev) {
      prev.classList.remove('active'); prev.setAttribute('aria-selected', 'false');
      activatePane(resolve(prev), false);
    }
    t.classList.add('active'); t.setAttribute('aria-selected', 'true');
    activatePane(pane, true);
    emit(t, 'shown.bs.tab');
  };

  /* ---------- Offcanvas ---------- */
  var Offcanvas = component(function Offcanvas(el) { this.el = el; this.busy = false; this.backdrop = null; register(el, 'offcanvas', this); }, 'offcanvas');
  Offcanvas.prototype.toggle = function () { this[this.el.classList.contains('show') ? 'hide' : 'show'](); };
  Offcanvas.prototype.show = function () {
    var el = this.el, self = this;
    if (this.busy || el.classList.contains('show')) return;
    if (!emit(el, 'show.bs.offcanvas')) return;
    this.busy = true;
    var bd = this.backdrop = document.createElement('div');
    bd.className = 'offcanvas-backdrop fade';
    bd.addEventListener('click', function () { self.hide(); });
    document.body.appendChild(bd); reflow(bd); bd.classList.add('show');
    this.prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    el.style.visibility = 'visible'; el.removeAttribute('aria-hidden');
    el.setAttribute('aria-modal', 'true'); el.setAttribute('role', 'dialog');
    el.classList.add('show', 'showing');
    afterTransition(el, function () { el.classList.remove('showing'); self.busy = false; emit(el, 'shown.bs.offcanvas'); try { el.focus(); } catch (e) {} });
  };
  Offcanvas.prototype.hide = function () {
    var el = this.el, self = this;
    if (this.busy || !el.classList.contains('show')) return;
    if (!emit(el, 'hide.bs.offcanvas')) return;
    this.busy = true;
    el.classList.add('hiding');
    var bd = this.backdrop; this.backdrop = null;
    if (bd) { bd.classList.remove('show'); setTimeout(function () { bd.remove(); }, 160); }
    afterTransition(el, function () {
      el.classList.remove('show', 'hiding');
      el.setAttribute('aria-hidden', 'true'); el.removeAttribute('aria-modal'); el.removeAttribute('role');
      el.style.visibility = 'hidden';
      document.body.style.overflow = self.prevOverflow || '';
      self.busy = false; emit(el, 'hidden.bs.offcanvas');
    });
  };

  /* ---------- Dropdown ---------- */
  var Dropdown = component(function Dropdown(el) { this.el = el; register(el, 'dropdown', this); }, 'dropdown');
  function menuOf(toggle) { var p = toggle.parentNode; return p && p.querySelector('.dropdown-menu'); }
  function closeDropdowns(except) {
    var abertos = document.querySelectorAll('.dropdown-menu.show');
    for (var i = 0; i < abertos.length; i++) {
      if (abertos[i] === except) continue;
      abertos[i].classList.remove('show');
      var tg = abertos[i].parentNode && abertos[i].parentNode.querySelector('[data-bs-toggle="dropdown"]');
      if (tg) { tg.classList.remove('show'); tg.setAttribute('aria-expanded', 'false'); }
    }
  }
  Dropdown.prototype.toggle = function () {
    var menu = menuOf(this.el); if (!menu) return;
    var abrir = !menu.classList.contains('show');
    closeDropdowns(abrir ? menu : null);
    menu.setAttribute('data-bs-popper', 'static');
    menu.classList.toggle('show', abrir); this.el.classList.toggle('show', abrir);
    this.el.setAttribute('aria-expanded', abrir ? 'true' : 'false');
  };
  Dropdown.prototype.show = function () { if (!this.el.classList.contains('show')) this.toggle(); };
  Dropdown.prototype.hide = function () { if (this.el.classList.contains('show')) this.toggle(); };

  /* ---------- Delegação de eventos (data-bs-*) ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-bs-toggle], [data-bs-dismiss]');
    if (!t) { closeDropdowns(null); return; } // clique fora ou dentro do menu fecha, como no Bootstrap
    var dismiss = t.getAttribute('data-bs-dismiss');
    if (dismiss === 'offcanvas') {
      var oc = t.closest('.offcanvas'); if (oc) Offcanvas.getOrCreateInstance(oc).hide();
      return;
    }
    var kind = t.getAttribute('data-bs-toggle');
    if (kind === 'collapse') {
      if (t.tagName === 'A') e.preventDefault();
      var alvo = resolve(t); if (alvo) Collapse.getOrCreateInstance(alvo, { toggle: false }).toggle();
    } else if (kind === 'tab') {
      e.preventDefault(); Tab.getOrCreateInstance(t).show();
    } else if (kind === 'dropdown') {
      e.preventDefault(); Dropdown.getOrCreateInstance(t).toggle();
    } else if (kind === 'offcanvas') {
      e.preventDefault(); var o = resolve(t); if (o) Offcanvas.getOrCreateInstance(o).toggle();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    closeDropdowns(null);
    var oc = document.querySelector('.offcanvas.show');
    if (oc) Offcanvas.getOrCreateInstance(oc).hide();
  });

  window.bootstrap = { Collapse: Collapse, Tab: Tab, Offcanvas: Offcanvas, Dropdown: Dropdown };

  /* ---------- Miniaturas de fotos (Cloudinary) ----------
     Listas mostram a foto reduzida (largura w, qualidade e formato automáticos) em vez da original de vários MB.
     Só mexe em endereços do Cloudinary sem transformação; qualquer outro endereço volta igual. */
  window.ctwThumb = function (url, w) {
    if (typeof url !== 'string') return url;
    var m = url.match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(v\d+\/.+)$/);
    return m ? m[1] + 'w_' + (w || 150) + ',c_limit,q_auto,f_auto/' + m[2] : url;
  };
})();

/* ---------- Lista de opções própria (no lugar do popup nativo do Chrome) ----------
   O <select> continua no lugar (e é ele que guarda o valor); um botão transparente por cima abre a folha.
   Ao escolher, o select muda e dispara "change" marcado com ctwUser (os ouvintes que checam event.isTrusted
   aceitam essa marca, porque um evento criado por script nunca é "trusted"). */
(function () {
  'use strict';
  var LISTAS = [
    ['machine2', 'Maquininha'], ['machine3', 'Maquininha'], ['machine4', 'Maquininha'], ['machine5', 'Maquininha'],
    ['bookipGarantiaSelect', 'Tempo de garantia'], ['orcValidadeSelect', 'Validade do orçamento']
  ];
  var aberta = null;   // { wrap, sel }

  function fechar(agora) {
    if (!aberta) return false;
    var w = aberta.wrap; aberta = null;
    if (agora) { w.remove(); return true; }
    w.classList.remove('ui-open');
    setTimeout(function () { w.remove(); }, 260);
    return true;
  }
  window.ctwFecharListaSheet = function () { return fechar(false); };

  function escolher(sel, valor) {
    fechar(true);
    if (sel.value === valor) return;
    sel.value = valor;
    ['input', 'change'].forEach(function (nome) {
      var ev = new Event(nome, { bubbles: true });
      ev.ctwUser = true;
      sel.dispatchEvent(ev);
    });
  }

  function abrir(sel, titulo) {
    fechar(true);
    var opcoes = Array.prototype.filter.call(sel.options, function (o) { return !o.hidden && !o.disabled; });
    if (!opcoes.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'ui-sheet-wrap';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', titulo);
    var dim = document.createElement('button');
    dim.type = 'button'; dim.className = 'ui-dim'; dim.setAttribute('aria-label', 'Fechar');
    dim.addEventListener('click', function () { fechar(false); });
    var sheet = document.createElement('div');
    sheet.className = 'ui-sheet';
    var grab = document.createElement('div'); grab.className = 'ui-grab';
    var tit = document.createElement('div'); tit.className = 'ui-sheet-title'; tit.textContent = titulo;
    sheet.appendChild(grab); sheet.appendChild(tit);
    opcoes.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ui-srow ctw-opt' + (o.value === sel.value ? ' on' : '');
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', o.value === sel.value ? 'true' : 'false');
      var t = document.createElement('span'); t.className = 'ui-grow';
      var n = document.createElement('b'); n.textContent = o.textContent.trim();
      t.appendChild(n);
      var r = document.createElement('span'); r.className = 'ctw-radio';
      b.appendChild(t); b.appendChild(r);
      b.addEventListener('click', function () { escolher(sel, o.value); });
      sheet.appendChild(b);
    });
    wrap.appendChild(dim); wrap.appendChild(sheet);
    document.body.appendChild(wrap);
    aberta = { wrap: wrap, sel: sel };
    void wrap.offsetHeight;
    wrap.classList.add('ui-open');
  }

  function envolver(sel, titulo) {
    if (!sel || sel.getAttribute('data-ctw-lista')) return;
    sel.setAttribute('data-ctw-lista', '1');
    var wrap = document.createElement('div');
    wrap.className = 'ctw-selwrap';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'ctw-selbtn';
    btn.setAttribute('aria-label', titulo);
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.addEventListener('click', function () { abrir(sel, titulo); });
    wrap.appendChild(btn);
    sel.tabIndex = -1;
  }

  function iniciar() {
    LISTAS.forEach(function (l) { envolver(document.getElementById(l[0]), l[1]); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fechar(false); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
