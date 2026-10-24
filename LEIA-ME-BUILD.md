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
