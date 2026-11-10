package br.com.workcell.central;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** Widget 2×2 do CreditoScan: a análise mais relevante, em destaque. */
public class CreditoScanQuadro extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, CtwWidgetUi.quadro(ctx));
    }
}
