package br.com.workcell.central;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Ponte entre o app (JavaScript) e os widgets do CreditoScan.
 * atualizar: o app entrega o resumo das análises (JSON) e os widgets se redesenham.
 * acaoPendente: o que o toque no widget pediu (abrir uma análise, nova análise...), lido uma vez.
 */
@CapacitorPlugin(name = "CtwWidget")
public class CtwWidgetPlugin extends Plugin {
    static final String PREFS = "ctw_widget";
    static final String CHAVE_DADOS = "dados";

    // Toque no widget: MainActivity guarda aqui até o JavaScript buscar. Vale só na sessão do processo.
    private static String acaoAcao = null;
    private static String acaoId = null;

    static synchronized void guardarAcao(String acao, String id) {
        acaoAcao = acao;
        acaoId = id;
    }

    static String lerDados(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(CHAVE_DADOS, null);
    }

    @PluginMethod
    public void atualizar(PluginCall call) {
        String json = call.getString("json");
        if (json == null) {
            call.reject("json ausente");
            return;
        }
        Context ctx = getContext();
        SharedPreferences.Editor ed = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        ed.putString(CHAVE_DADOS, json);
        ed.apply();
        CtwWidgetUi.atualizarTodos(ctx);
        call.resolve();
    }

    @PluginMethod
    public synchronized void acaoPendente(PluginCall call) {
        JSObject r = new JSObject();
        if (acaoAcao != null) {
            r.put("acao", acaoAcao);
            r.put("id", acaoId == null ? "" : acaoId);
        }
        acaoAcao = null;
        acaoId = null;
        call.resolve(r);
    }
}
