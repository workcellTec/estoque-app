// ============================================================================
//  enviar-email  —  Edge Function do Supabase: manda o PDF do app pelo Gmail
//  (SMTP com SSL, porta 465; o Supabase bloqueia 25 e 587).
//
//  Rotas (todas exigem o cabeçalho  x-app-token = APP_TOKEN, a mesma senha do CreditoScan):
//    GET   /            -> { ok: true, configurado: true|false }   (o app pergunta antes de oferecer o envio direto)
//    POST  /            -> { para, assunto, texto, nomeArquivo, pdfBase64 }  -> { ok: true }
//
//  Segredos (Edge Functions > Secrets):
//    APP_TOKEN            (já existe, do CreditoScan)
//    GMAIL_USER           e-mail que envia (ex.: workcell@gmail.com)
//    GMAIL_APP_PASSWORD   "senha de app" do Google (conta > Segurança > Verificação em 2 etapas > Senhas de app)
//
//  Segurança: só responde com a senha do servidor; 1 destinatário por envio; anexo limitado;
//  quebras de linha são tiradas de tudo que vai em cabeçalho (sem injeção de cabeçalho).
// ============================================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-app-token, apikey, authorization, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 465;
const MAX_PDF_B64 = 14_000_000;        // ~10 MB de PDF (o Gmail aceita até 25 MB por e-mail)
const MAX_CORPO = 14_500_000;          // tamanho máximo do pedido inteiro
const TEMPO_MAX_MS = 40_000;           // tempo máximo de uma conversa SMTP

const enc = new TextEncoder();
const dec = new TextDecoder();

export type Conexao = {
  read(p: Uint8Array): Promise<number | null>;
  write(p: Uint8Array): Promise<number>;
  close(): void;
};

export class ErroSmtp extends Error {
  codigo: number;
  constructor(codigo: number, texto: string) {
    super(texto.trim().replace(/\s+/g, ' ').slice(0, 300));
    this.codigo = codigo;
  }
}

function resp(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
}

// ---------- util ----------
function b64Texto(s: string): string {
  const b = enc.encode(s);
  let bin = '';
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(bin);
}
function quebra76(b64: string): string {
  return (b64.match(/.{1,76}/g) || []).join('\r\n');
}
function semQuebra(s: unknown): string {          // cabeçalho nunca leva CR/LF
  return String(s == null ? '' : s).replace(/[\r\n\u2028\u2029\0]+/g, ' ').trim();
}
function palavraMime(s: string): string {          // =?UTF-8?B?...?= (ASCII puro passa direto)
  return /^[\x20-\x7e]*$/.test(s) ? s.replace(/["\\]/g, '') : '=?UTF-8?B?' + b64Texto(s) + '?=';
}
function emailValido(v: string): boolean {
  return v.length <= 254 && /^[^\s@<>,;:"()\[\]\\]+@[^\s@<>,;:"()\[\]\\]+\.[^\s@<>,;:"()\[\]\\]{2,}$/.test(v);
}
function iguais(a: string, b: string): boolean {   // comparação em tempo constante
  const x = enc.encode(a), y = enc.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}

// ---------- SMTP ----------
async function escreverTudo(c: Conexao, b: Uint8Array) {
  let o = 0;
  while (o < b.length) o += await c.write(b.subarray(o));
}

class Leitor {
  buf = '';
  constructor(private c: Conexao) {}
  async linha(): Promise<string> {
    for (;;) {
      const i = this.buf.indexOf('\r\n');
      if (i >= 0) { const l = this.buf.slice(0, i); this.buf = this.buf.slice(i + 2); return l; }
      const p = new Uint8Array(4096);
      const n = await this.c.read(p);
      if (n === null) throw new Error('conexao fechada pelo servidor de e-mail');
      this.buf += dec.decode(p.subarray(0, n), { stream: true });
    }
  }
  async resposta(): Promise<{ codigo: number; texto: string }> {
    let texto = '';
    for (;;) {
      const l = await this.linha();
      texto += l + '\n';
      if (!/^\d{3}-/.test(l)) return { codigo: parseInt(l.slice(0, 3), 10) || 0, texto };
    }
  }
}

export type Mensagem = { usuario: string; senha: string; nomeDe: string; para: string; assunto: string; texto: string; nomeArquivo: string; pdfB64: string };

export function montarMensagem(m: Mensagem, agora = new Date()): string {
  const limite = '=_workcell_' + crypto.randomUUID().replace(/-/g, '');
  const L: string[] = [];
  L.push('From: ' + palavraMime(m.nomeDe) + ' <' + m.usuario + '>');
  L.push('To: <' + m.para + '>');
  L.push('Subject: ' + palavraMime(m.assunto));
  L.push('Date: ' + agora.toUTCString().replace('GMT', '+0000'));
  L.push('Message-ID: <' + crypto.randomUUID() + '@workcell.app>');
  L.push('MIME-Version: 1.0');
  L.push('Content-Type: multipart/mixed; boundary="' + limite + '"');
  L.push('');
  L.push('--' + limite);
  L.push('Content-Type: text/plain; charset=UTF-8');
  L.push('Content-Transfer-Encoding: base64');
  L.push('');
  L.push(quebra76(b64Texto(m.texto.replace(/\r?\n/g, '\r\n'))));
  L.push('--' + limite);
  L.push('Content-Type: application/pdf; name="' + m.nomeArquivo + '"');
  L.push('Content-Disposition: attachment; filename="' + m.nomeArquivo + '"');
  L.push('Content-Transfer-Encoding: base64');
  L.push('');
  L.push(quebra76(m.pdfB64));
  L.push('--' + limite + '--');
  L.push('');
  return L.join('\r\n');
}

export async function enviarSmtp(conn: Conexao, m: Mensagem): Promise<void> {
  const r = new Leitor(conn);
  const cmd = async (linha: string, esperado: number[], rotulo: string) => {
    await escreverTudo(conn, enc.encode(linha + '\r\n'));
    const x = await r.resposta();
    if (!esperado.includes(x.codigo)) throw new ErroSmtp(x.codigo, rotulo + ': ' + x.texto);
    return x;
  };
  const g = await r.resposta();
  if (g.codigo !== 220) throw new ErroSmtp(g.codigo, 'saudacao: ' + g.texto);
  await cmd('EHLO workcell.app', [250], 'EHLO');
  await cmd('AUTH PLAIN ' + b64Texto('\0' + m.usuario + '\0' + m.senha), [235], 'login');
  await cmd('MAIL FROM:<' + m.usuario + '>', [250], 'remetente');
  await cmd('RCPT TO:<' + m.para + '>', [250, 251], 'destinatario');
  await cmd('DATA', [354], 'DATA');
  const corpo = montarMensagem(m).replace(/(^|\r\n)\./g, '$1..');   // dot-stuffing
  await escreverTudo(conn, enc.encode(corpo + '\r\n.\r\n'));
  const f = await r.resposta();
  if (f.codigo !== 250) throw new ErroSmtp(f.codigo, 'envio: ' + f.texto);
  try { await cmd('QUIT', [221], 'QUIT'); } catch (_) { /* já foi aceito */ }
}

// ---------- rota ----------
export type Deps = { conectar: () => Promise<Conexao>; env: (k: string) => string };

const depsPadrao: Deps = {
  conectar: () => (Deno as any).connectTls({ hostname: SMTP_HOST, port: SMTP_PORT }) as Promise<Conexao>,
  env: (k) => Deno.env.get(k) || '',
};

export async function tratar(req: Request, deps: Deps = depsPadrao): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const esperado = deps.env('APP_TOKEN');
  if (!esperado) return resp({ erro: 'APP_TOKEN nao configurado no servidor' }, 500);
  if (!iguais(req.headers.get('x-app-token') || '', esperado)) return resp({ erro: 'nao autorizado' }, 401);

  const usuario = deps.env('GMAIL_USER').trim();
  const senha = deps.env('GMAIL_APP_PASSWORD').replace(/\s+/g, '');
  const configurado = !!usuario && !!senha;

  if (req.method === 'GET') return resp({ ok: true, configurado });
  if (req.method !== 'POST') return resp({ erro: 'metodo nao permitido' }, 405);
  if (!configurado) return resp({ erro: 'email nao configurado' }, 503);

  const tam = parseInt(req.headers.get('content-length') || '0', 10);
  if (tam > MAX_CORPO) return resp({ erro: 'pedido grande demais' }, 413);
  let txt = '';
  try { txt = await req.text(); } catch (_) { return resp({ erro: 'pedido ilegivel' }, 400); }
  if (txt.length > MAX_CORPO) return resp({ erro: 'pedido grande demais' }, 413);
  let d: any;
  try { d = JSON.parse(txt); } catch (_) { return resp({ erro: 'json invalido' }, 400); }
  if (!d || typeof d !== 'object') return resp({ erro: 'json invalido' }, 400);

  const para = semQuebra(d.para);
  if (!emailValido(para)) return resp({ erro: 'destinatario invalido' }, 400);
  const assunto = semQuebra(d.assunto).slice(0, 200) || 'Documento Workcell Tecnologia';
  const texto = String(d.texto == null ? '' : d.texto).replace(/\0/g, '').slice(0, 5000);
  let nomeArquivo = semQuebra(d.nomeArquivo).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
  if (!/\.pdf$/i.test(nomeArquivo)) nomeArquivo = (nomeArquivo.replace(/\.+$/, '') || 'Documento') + '.pdf';
  const pdfB64 = String(d.pdfBase64 || '').replace(/\s+/g, '');
  if (!pdfB64 || pdfB64.length > MAX_PDF_B64) return resp({ erro: 'anexo ausente ou grande demais' }, 400);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(pdfB64) || pdfB64.length % 4 !== 0) return resp({ erro: 'anexo invalido' }, 400);
  if (atob(pdfB64.slice(0, 8)).slice(0, 4) !== '%PDF') return resp({ erro: 'anexo nao e PDF' }, 400);

  let conn: Conexao | null = null;
  let temporizador: number | undefined;
  try {
    const tarefa = (async () => {
      conn = await deps.conectar();
      await enviarSmtp(conn, { usuario, senha, nomeDe: 'Workcell Tecnologia', para, assunto, texto, nomeArquivo, pdfB64 });
    })();
    const limite = new Promise<never>((_, rej) => { temporizador = setTimeout(() => rej(new Error('tempo esgotado falando com o Gmail')), TEMPO_MAX_MS) as unknown as number; });
    await Promise.race([tarefa, limite]);
    console.log('enviar-email: ok');
    return resp({ ok: true });
  } catch (e) {
    const msg = String((e && (e as Error).message) || e).replace(senha, '***').slice(0, 300);
    const auth = e instanceof ErroSmtp && (e.codigo === 535 || e.codigo === 534 || e.codigo === 530);
    console.log('enviar-email: falhou', msg);
    return resp({ erro: auth ? 'login do Gmail recusado (confira GMAIL_USER e a senha de app)' : 'smtp', detalhe: msg }, 502);
  } finally {
    if (temporizador !== undefined) clearTimeout(temporizador);
    try { (conn as Conexao | null)?.close(); } catch (_) { /* já fechada */ }
  }
}

if (!(globalThis as any).__TESTE__) Deno.serve((req) => tratar(req));
