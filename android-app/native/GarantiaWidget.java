package br.com.workcell.central;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** Atalho na tela inicial: toque abre o app direto em "garantia". Não depende de dados do app. */
public class GarantiaWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, CtwWidgetUi.atalho(ctx, R.layout.ctw_w_garantia, R.id.w_a_raiz, 130, "garantia"));
    }
}
