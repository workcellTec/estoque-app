package br.com.workcell.central;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** Atalhos 4×1 na tela inicial: cada botão abre o app direto na tela pedida. Não depende de dados do app. */
public class DocumentosWidget extends AppWidgetProvider {
    private static final String[] ACOES = {"doc-garantia", "doc-contrato", "doc-orcamento"};

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, CtwWidgetUi.botoes(ctx, R.layout.ctw_w_documentos, 133, ACOES));
    }
}
