package br.com.workcell.central;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.view.Window;

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
}
