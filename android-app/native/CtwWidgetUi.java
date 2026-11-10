package br.com.workcell.central;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;

import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Desenha os widgets do CreditoScan a partir do resumo que o app guardou (ver CtwWidgetPlugin). */
final class CtwWidgetUi {
    private CtwWidgetUi() {}

    /** Dado de análise em andamento mais velho que isso: o app provavelmente foi pausado pelo Android. */
    private static final long VELHO_MS = 10L * 60L * 1000L;
    static final String ACAO_TOQUE = "br.com.workcell.central.WIDGET";

    static final class Item {
        String id = "", nome = "", est = "", txt = "", faixa = "";
        int pct = 0, nota = 0;
        boolean andamento() { return "andamento".equals(est); }
    }

    static final class Dados {
        boolean ok = false;
        long ts = 0;
        int emAnalise = 0;
        List<Item> itens = new ArrayList<>();
        boolean velho() {
            if (!ok) return false;
            boolean rodando = false;
            for (Item i : itens) if (i.andamento()) rodando = true;
            return rodando && System.currentTimeMillis() - ts > VELHO_MS;
        }
    }

    static Dados ler(Context ctx) {
        Dados d = new Dados();
        String json = CtwWidgetPlugin.lerDados(ctx);
        if (json == null) return d;
        try {
            JSONObject o = new JSONObject(json);
            d.ts = o.optLong("ts", 0);
            d.emAnalise = o.optInt("emAnalise", 0);
            JSONArray a = o.optJSONArray("itens");
            for (int i = 0; a != null && i < a.length() && i < 3; i++) {
                JSONObject j = a.getJSONObject(i);
                Item it = new Item();
                it.id = j.optString("id", "");
                it.nome = j.optString("nome", "Cliente");
                it.est = j.optString("est", "");
                it.txt = j.optString("txt", "");
                it.faixa = j.optString("faixa", "");
                it.pct = j.optInt("pct", 0);
                it.nota = j.optInt("nota", 0);
                d.itens.add(it);
            }
            d.ok = true;
            // dado de ontem não vale: "prontas de hoje" velhas e análises que já acabaram não ficam no widget
            if (System.currentTimeMillis() - d.ts > 12L * 60L * 60L * 1000L) {
                d.itens.clear();
                d.emAnalise = 0;
            }
        } catch (JSONException e) {
            d.ok = false;
        }
        return d;
    }

    static void atualizarTodos(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, CreditoScanLista.class));
        if (ids != null && ids.length > 0) mgr.updateAppWidget(ids, lista(ctx));
        int[] ids2 = mgr.getAppWidgetIds(new ComponentName(ctx, CreditoScanQuadro.class));
        if (ids2 != null && ids2.length > 0) mgr.updateAppWidget(ids2, quadro(ctx));
    }

    // ── toque: abre o app e entrega a ação ao JavaScript (ver MainActivity) ──
    private static PendingIntent toque(Context ctx, int codigo, String acao, String id) {
        Intent it = new Intent(ctx, MainActivity.class);
        it.setAction(ACAO_TOQUE);
        it.putExtra("ctw_acao", acao);
        it.putExtra("ctw_id", id == null ? "" : id);
        it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(ctx, codigo, it, flags);   // código diferente = PendingIntent diferente
    }

    private static int cor(Context ctx, int res) { return ContextCompat.getColor(ctx, res); }

    private static final int[] L_BOX = {R.id.w_r1, R.id.w_r2, R.id.w_r3};
    private static final int[] L_CIRC = {R.id.w_r1_c, R.id.w_r2_c, R.id.w_r3_c};
    private static final int[] L_NOME = {R.id.w_r1_n, R.id.w_r2_n, R.id.w_r3_n};
    private static final int[] L_SUB = {R.id.w_r1_s, R.id.w_r2_s, R.id.w_r3_s};
    private static final int[] L_VAL = {R.id.w_r1_v, R.id.w_r2_v, R.id.w_r3_v};

    /** Texto de apoio do estado (segunda linha). */
    private static String sub(Item it) {
        switch (it.est) {
            case "andamento": return it.txt.isEmpty() ? "Analisando" : it.txt;
            case "aprovada": return "Aprovado" + (it.faixa.isEmpty() ? "" : " · " + it.faixa);
            case "reprovada": return "Reprovado";
            case "aguarda": return "Precisa de resposta";
            default: return "Falhou · toque para ver";
        }
    }

    /** Cor do estado: verde (andamento/aprovada), vermelho (reprovada/erro), âmbar (aguarda). */
    private static int corEstado(Context ctx, Item it) {
        switch (it.est) {
            case "reprovada":
            case "erro": return cor(ctx, R.color.ctw_w_bad);
            case "aguarda": return cor(ctx, R.color.ctw_w_warn);
            default: return cor(ctx, R.color.ctw_w_ok);
        }
    }

    private static int fundoCirculo(Item it) {
        switch (it.est) {
            case "andamento": return R.drawable.ctw_w_circ_run;
            case "aprovada": return R.drawable.ctw_w_circ_ok;
            case "aguarda": return R.drawable.ctw_w_circ_warn;
            default: return R.drawable.ctw_w_circ_bad;
        }
    }

    private static String glifo(Item it) {
        switch (it.est) {
            case "andamento": return String.valueOf(it.pct);
            case "aprovada": return "✓";
            case "reprovada": return "✕";
            case "aguarda": return "?";
            default: return "!";
        }
    }

    /** Widget de atalho: um toque em qualquer parte abre o app na ação pedida (garantia, calcular). */
    static RemoteViews atalho(Context ctx, int layout, int raiz, int codigo, String acao) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), layout);
        v.setOnClickPendingIntent(raiz, toque(ctx, codigo, acao, ""));
        return v;
    }

    static RemoteViews lista(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.ctw_w_lista);
        Dados d = ler(ctx);
        boolean velho = d.velho();
        String resumo = !d.ok ? "" : velho ? "· Abra o app para atualizar" : d.emAnalise > 0 ? "· " + d.emAnalise + " em análise" : "· hoje";
        v.setTextViewText(R.id.w_resumo, resumo);
        v.setOnClickPendingIntent(R.id.w_topo, toque(ctx, 100, "lista", ""));
        v.setOnClickPendingIntent(R.id.w_mais, toque(ctx, 101, "nova", ""));
        boolean vazio = d.itens.isEmpty();
        v.setViewVisibility(R.id.w_vazio, vazio ? View.VISIBLE : View.GONE);
        v.setTextViewText(R.id.w_vazio, d.ok ? "Nenhuma análise por aqui hoje.\nToque no + para começar." : "Abra o app uma vez para ativar.");
        v.setOnClickPendingIntent(R.id.w_vazio, toque(ctx, 102, "lista", ""));
        for (int n = 0; n < 3; n++) {
            if (n >= d.itens.size()) {
                v.setViewVisibility(L_BOX[n], View.GONE);
                continue;
            }
            Item it = d.itens.get(n);
            int destaque = corEstado(ctx, it);
            v.setViewVisibility(L_BOX[n], View.VISIBLE);
            v.setInt(L_CIRC[n], "setBackgroundResource", fundoCirculo(it));
            v.setTextViewText(L_CIRC[n], glifo(it));
            v.setTextColor(L_CIRC[n], it.andamento() ? destaque : cor(ctx, R.color.ctw_w_sobre));
            v.setTextViewText(L_NOME[n], it.nome);
            v.setTextViewText(L_SUB[n], sub(it));
            boolean temNota = "aprovada".equals(it.est) || "reprovada".equals(it.est);
            v.setViewVisibility(L_VAL[n], temNota ? View.VISIBLE : View.GONE);
            if (temNota) {
                v.setTextViewText(L_VAL[n], String.valueOf(it.nota));
                v.setTextColor(L_VAL[n], destaque);
            }
            v.setOnClickPendingIntent(L_BOX[n], toque(ctx, 110 + n, "abrir", it.id));
        }
        return v;
    }

    static RemoteViews quadro(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.ctw_w_quadro);
        Dados d = ler(ctx);
        boolean vazio = d.itens.isEmpty();
        v.setViewVisibility(R.id.w_q_val, vazio ? View.GONE : View.VISIBLE);
        v.setViewVisibility(R.id.w_q_nome, vazio ? View.GONE : View.VISIBLE);
        if (vazio) {
            v.setTextViewText(R.id.w_q_status, d.ok ? "Nova análise" : "Abra o app");
            v.setTextColor(R.id.w_q_status, cor(ctx, R.color.ctw_w_ok));
            v.setTextViewText(R.id.w_q_sub, d.ok ? "Nenhuma em andamento" : "para ativar o widget");
            v.setOnClickPendingIntent(R.id.w_q_raiz, toque(ctx, 120, d.ok ? "nova" : "lista", ""));
            return v;
        }
        Item it = d.itens.get(0);
        int destaque = corEstado(ctx, it);
        boolean temNota = "aprovada".equals(it.est) || "reprovada".equals(it.est);
        String status;
        String valor;
        switch (it.est) {
            case "andamento": status = "Em análise"; valor = it.pct + "%"; break;
            case "aprovada": status = "Aprovado"; valor = String.valueOf(it.nota); break;
            case "reprovada": status = "Reprovado"; valor = String.valueOf(it.nota); break;
            case "aguarda": status = "Responder"; valor = "?"; break;
            default: status = "Erro"; valor = "!"; break;
        }
        v.setTextViewText(R.id.w_q_val, valor);
        v.setTextColor(R.id.w_q_val, destaque);
        v.setTextViewText(R.id.w_q_status, status);
        v.setTextColor(R.id.w_q_status, destaque);
        v.setTextViewText(R.id.w_q_nome, it.nome);
        String apoio = d.velho() && it.andamento() ? "Abra o app para atualizar"
                : "reprovada".equals(it.est) ? "Veja o motivo no app"
                : temNota && !it.faixa.isEmpty() ? "Faixa " + it.faixa
                : sub(it);
        v.setTextViewText(R.id.w_q_sub, apoio);
        v.setOnClickPendingIntent(R.id.w_q_raiz, toque(ctx, 121, "abrir", it.id));
        return v;
    }
}
