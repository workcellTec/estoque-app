#!/bin/sh
# Gera a versão de produção (arquivos compactados na raiz) a partir do código legível.
# Uso: sh build.sh <pasta-do-codigo-legivel> <pasta-de-saida>
set -e
SRC="$1"; OUT="$2"
JS="ctw-ui.js app.js notifications.js Bookip.js fecharVenda.js repairs.js reposicao.js creditoscan.js StockCount.js"
rm -rf "$OUT"; mkdir -p "$OUT/src"
# tudo que não é código compactável vai igual
for f in "$SRC"/*; do b=$(basename "$f"); [ -f "$f" ] && cp "$f" "$OUT/$b"; done
# pastas de apoio (fontes e ferramentas) vão iguais
for d in fonts tools; do [ -d "$SRC/$d" ] && cp -r "$SRC/$d" "$OUT/$d"; done
# código legível guardado em src/ (é nele que se edita)
for f in $JS style.css; do cp "$SRC/$f" "$OUT/src/$f"; done
cp "$0" "$OUT/build.sh"
for f in $JS; do npx --yes esbuild "$SRC/$f" --minify --format=esm --outfile="$OUT/$f" --log-level=error; done
npx --yes esbuild "$SRC/style.css" --minify --outfile="$OUT/style.css" --log-level=error
cat > "$OUT/LEIA-ME-BUILD.md" <<'EOT'
# Como este projeto está organizado

- Os arquivos .js e style.css da RAIZ são a versão compactada (rápida no celular). É o que vai para o ar.
- O código legível está em `src/`. **Toda edição é feita em `src/`.**
- Depois de editar, rode `sh build.sh src .` para regenerar a raiz (precisa de Node; usa o esbuild via npx).

## Arquivos que não dependem de internet (tudo é do próprio app)
- `bootstrap-lite.css`: Bootstrap só com as classes que o app usa. Se passar a usar uma classe nova do Bootstrap
  (ex.: `col-lg-3`, `badge`), rode `node tools/gerar-bootstrap-lite.js . <pasta do pacote bootstrap>` e suba o arquivo novo.
- `bootstrap-icons-lite.css` + `fonts/bootstrap-icons.woff2`: só os ícones usados. Ícone novo? rode
  `python3 tools/gerar-icones.py . <pasta do pacote bootstrap-icons>`.
- `ctw-ui.js`: accordions, abas, painel de alertas e menu (no lugar do JavaScript do Bootstrap).
- `fonts/poppins-*.woff2` e `fuse.min.js`: fonte e busca hospedadas aqui.
EOT
echo "ok: $OUT"
