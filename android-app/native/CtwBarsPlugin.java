package br.com.workcell.central;

import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.Window;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Pinta a barra de navegação do Android (a de baixo) com a cor do tema do app (a barra de status usa o plugin oficial)
 * e abre links de fora (WhatsApp, telefone, e-mail, mapas) no app certo. O plugin App do Capacitor 6 não tem openUrl.
 */
@CapacitorPlugin(name = "CtwBars")
public class CtwBarsPlugin extends Plugin {

    @PluginMethod
    public void navegacao(final PluginCall call) {
        final String cor = call.getString("cor");
        final boolean fundoClaro = !Boolean.FALSE.equals(call.getBoolean("fundoClaro", true));
        if (cor == null) {
            call.reject("cor ausente");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                Window janela = getActivity().getWindow();
                janela.setNavigationBarColor(Color.parseColor(cor));
                WindowInsetsControllerCompat ctl = WindowCompat.getInsetsController(janela, janela.getDecorView());
                ctl.setAppearanceLightNavigationBars(fundoClaro);
                call.resolve();
            } catch (Exception e) {
                call.reject("cor invalida: " + cor);
            }
        });
    }

    @PluginMethod
    public void abrirUrl(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("url ausente");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url.trim())));
                call.resolve();
            } catch (ActivityNotFoundException e) {
                call.reject("nenhum app abre este link");
            } catch (Exception e) {
                call.reject("nao consegui abrir: " + e.getMessage());
            }
        });
    }

    /**
     * Abre o WhatsApp direto na conversa do cliente, com o arquivo anexado (atalho não documentado da Meta: EXTRA_JID).
     * Se o WhatsApp ignorar o JID, ele abre a lista de contatos já com o arquivo. Sem WhatsApp, rejeita e o app usa o compartilhamento normal.
     */
    @PluginMethod
    public void enviarWhatsApp(final PluginCall call) {
        final String arquivo = call.getString("arquivo");
        final String numero = call.getString("numero");
        final String texto = call.getString("texto", "");
        if (arquivo == null || numero == null || !numero.matches("\\d{12,13}")) {
            call.reject("dados invalidos");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                Uri conteudo = uriParaOutroApp(arquivo);
                String[] pacotes = {"com.whatsapp", "com.whatsapp.w4b"};
                for (String pacote : pacotes) {
                    Intent it = new Intent(Intent.ACTION_SEND);
                    it.setType("application/pdf");
                    it.putExtra(Intent.EXTRA_STREAM, conteudo);
                    if (texto != null && !texto.isEmpty()) it.putExtra(Intent.EXTRA_TEXT, texto);
                    it.putExtra("jid", numero + "@s.whatsapp.net");
                    it.setPackage(pacote);
                    it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try {
                        getActivity().startActivity(it);
                        call.resolve();
                        return;
                    } catch (ActivityNotFoundException e) {
                        // tenta o próximo (WhatsApp Business)
                    }
                }
                call.reject("whatsapp nao instalado");
            } catch (Exception e) {
                call.reject("nao consegui abrir o whatsapp: " + e.getMessage());
            }
        });
    }

    /** Arquivo do cache do app (file://...) vira uma URI que outro app pode ler (FileProvider que o Capacitor já declara). */
    private Uri uriParaOutroApp(String arquivo) {
        File f = new File(Uri.parse(arquivo).getPath());
        return FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
    }

    /**
     * Abre o Gmail já com o PDF anexado, o e-mail do cliente em "Para", o assunto e o texto.
     * Sem Gmail instalado, rejeita e o app usa o compartilhamento normal.
     */
    @PluginMethod
    public void enviarEmail(final PluginCall call) {
        final String arquivo = call.getString("arquivo");
        final String para = call.getString("para", "");
        final String assunto = call.getString("assunto", "");
        final String texto = call.getString("texto", "");
        if (arquivo == null) {
            call.reject("arquivo ausente");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                Intent it = new Intent(Intent.ACTION_SEND);
                it.setType("application/pdf");
                it.setPackage("com.google.android.gm");
                it.putExtra(Intent.EXTRA_STREAM, uriParaOutroApp(arquivo));
                if (para != null && !para.trim().isEmpty()) it.putExtra(Intent.EXTRA_EMAIL, new String[]{para.trim()});
                it.putExtra(Intent.EXTRA_SUBJECT, assunto);
                it.putExtra(Intent.EXTRA_TEXT, texto);
                it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().startActivity(it);
                call.resolve();
            } catch (ActivityNotFoundException e) {
                call.reject("gmail nao instalado");
            } catch (Exception e) {
                call.reject("nao consegui abrir o gmail: " + e.getMessage());
            }
        });
    }

    /** Salva o arquivo na pasta Downloads do celular, sem abrir nada (Android 10+; antes disso o app usa o compartilhamento). */
    @PluginMethod
    public void salvarDownload(final PluginCall call) {
        final String arquivo = call.getString("arquivo");
        String nomeBruto = call.getString("nome", "arquivo");
        if (arquivo == null) {
            call.reject("arquivo ausente");
            return;
        }
        if (Build.VERSION.SDK_INT < 29) {
            call.reject("android antigo");
            return;
        }
        final String nome = nomeBruto.replaceAll("[\\\\/:*?\"<>|]", "_");
        new Thread(() -> {
            try {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.MediaColumns.DISPLAY_NAME, nome);
                cv.put(MediaStore.MediaColumns.MIME_TYPE, nome.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
                cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                Uri destino = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (destino == null) throw new Exception("o Android recusou criar o arquivo");
                try (InputStream in = new FileInputStream(new File(Uri.parse(arquivo).getPath()));
                     OutputStream out = getContext().getContentResolver().openOutputStream(destino)) {
                    if (out == null) throw new Exception("nao consegui gravar");
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("nao consegui salvar: " + e.getMessage());
            }
        }).start();
    }
}
