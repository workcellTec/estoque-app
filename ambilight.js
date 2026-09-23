// ambilight.js — DESATIVADO a pedido do usuário.
//
// Este módulo aplicava um glow (box-shadow/drop-shadow) pulsante contínuo
// no sino de notificações e no avatar, recalculado a cada frame via
// requestAnimationFrame — rodando para sempre, mesmo parado na mesma tela.
// Isso criava exatamente o efeito "neon/brilho forte" que o app deveria
// deixar de ter, além de consumir CPU/bateria sem necessidade.
//
// Arquivo mantido vazio (em vez de excluído) para não quebrar o import
// dinâmico em index.html caso ele não seja removido em algum ambiente
// de deploy mais antigo. Não faz nada.
