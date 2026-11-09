package br.com.workcell.central;

import android.graphics.Color;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Pinta a barra de navegação do Android (a de baixo) com a cor do tema do app. A barra de status usa o plugin oficial. */
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
}
