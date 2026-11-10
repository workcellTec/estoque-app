package br.com.workcell.central;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private Atualizador atualizador;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Qualquer erro não tratado daqui pra frente é gravado antes de o Android derrubar o app.
        RelatorioErro.instalar(this);
        registerPlugin(CtwBarsPlugin.class);
        super.onCreate(savedInstanceState);

        // Se o app caiu na vez anterior, mostra o motivo (com botão Copiar) antes de seguir; a consulta de atualização vem depois.
        final boolean abertura = savedInstanceState == null;
        String relatorio = RelatorioErro.lerEApagar(this);
        if (relatorio != null) RelatorioErro.mostrar(this, relatorio, () -> iniciarAtualizador(abertura));
        else iniciarAtualizador(abertura);
    }

    /** Atualização do próprio APK (sem Play Store): consulta ao abrir e, ao voltar do segundo plano, a cada 30 min no máximo. */
    private void iniciarAtualizador(boolean abertura) {
        atualizador = new Atualizador(this);
        if (abertura) atualizador.aoAbrir();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (atualizador != null) atualizador.aoVoltar();
    }
}
