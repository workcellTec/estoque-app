#!/usr/bin/env python3
"""Gera a fonte de ícones enxuta do app (só os ícones usados).

Uso:  python3 tools/gerar-icones.py <pasta-do-app> <pasta-do-pacote-bootstrap-icons>
  ex: npm i bootstrap-icons && python3 tools/gerar-icones.py . node_modules/bootstrap-icons

Lê os arquivos .js/.html/.css do app, junta todos os nomes "bi-xxx" encontrados (mais os
de EXTRAS, que são montados em código sem o prefixo) e escreve:
  fonts/bootstrap-icons.woff2   e   bootstrap-icons-lite.css
Rode de novo sempre que usar um ícone novo.
Requer: pip install fonttools brotli
"""
import re, sys, glob, os
from fontTools import subset

EXTRAS = ['bi-graph-down-arrow']  # fecharVenda.js monta "bi-" + ('graph-up-arrow'|'graph-down-arrow')

app, pkg = sys.argv[1], sys.argv[2]
css = open(os.path.join(pkg, 'font', 'bootstrap-icons.min.css'), encoding='utf-8').read()
mapa = dict((n, c) for n, c in re.findall(r'\.(bi-[a-z0-9-]+)::before\{content:"\\([0-9a-f]+)"\}', css))

usados = set(EXTRAS)
for f in glob.glob(os.path.join(app, '*.js')) + glob.glob(os.path.join(app, '*.html')) + [os.path.join(app, 'style.css')]:
    if os.path.basename(f) in ('sw.js',): continue
    usados |= set(re.findall(r'\bbi-[a-z0-9]+(?:-[a-z0-9]+)*', open(f, encoding='utf-8', errors='ignore').read()))
usados = sorted(n for n in usados if n in mapa)  # ignora falsos positivos ("bi-" solto etc.)

os.makedirs(os.path.join(app, 'fonts'), exist_ok=True)
opts = subset.Options(); opts.flavor = 'woff2'; opts.layout_features = []; opts.name_IDs = []; opts.notdef_outline = False
font = subset.load_font(os.path.join(pkg, 'font', 'fonts', 'bootstrap-icons.woff2'), opts)
sub = subset.Subsetter(opts); sub.populate(unicodes=[int(mapa[n], 16) for n in usados]); sub.subset(font)
subset.save_font(font, os.path.join(app, 'fonts', 'bootstrap-icons.woff2'), opts)

base = ('@font-face{font-display:block;font-family:bootstrap-icons;src:url("fonts/bootstrap-icons.woff2") format("woff2")}'
        '.bi::before,[class*=" bi-"]::before,[class^=bi-]::before{display:inline-block;font-family:bootstrap-icons!important;'
        'font-style:normal;font-weight:400!important;font-variant:normal;text-transform:none;line-height:1;vertical-align:-.125em;'
        '-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}')
regras = ''.join('.%s::before{content:"\\%s"}' % (n, mapa[n]) for n in usados)
open(os.path.join(app, 'bootstrap-icons-lite.css'), 'w', encoding='utf-8').write('/* Bootstrap Icons v1.11.3 (MIT) - só os ícones usados; gerado por tools/gerar-icones.py */' + base + regras)
print(len(usados), 'ícones;', os.path.getsize(os.path.join(app, 'fonts', 'bootstrap-icons.woff2')), 'bytes de fonte')
