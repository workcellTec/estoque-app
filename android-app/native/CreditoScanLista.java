package br.com.workcell.central;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** Widget 4×2 do CreditoScan: até 3 análises do perfil ativo. */
public class CreditoScanLista extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, CtwWidgetUi.lista(ctx));
    }
}
