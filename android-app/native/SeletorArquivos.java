package br.com.workcell.central;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * Seletor de arquivos igual ao do Chrome: o Capacitor abre o "Arquivos" direto; aqui o pedido passa por um
 * seletor do Android ("Escolha uma ação"), onde dá para escolher o app e, no Samsung, Pessoal ou Pasta Segura.
 * Câmera continua pelo caminho do Capacitor (permissão e foto prontas).
 */
public class SeletorArquivos extends BridgeWebChromeClient {
    private final ActivityResultLauncher<Intent> lancador;
    private ValueCallback<Uri[]> retorno;

    public SeletorArquivos(Bridge bridge) {
        super(bridge);
        lancador = bridge.registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), resultado -> {
            ValueCallback<Uri[]> cb = retorno;
            retorno = null;
            if (cb == null) return;
            Intent dados = resultado.getData();
            Uri[] uris = null;
            if (resultado.getResultCode() == Activity.RESULT_OK && dados != null && dados.getClipData() != null) {
                int n = dados.getClipData().getItemCount();
                uris = new Uri[n];
                for (int i = 0; i < n; i++) uris[i] = dados.getClipData().getItemAt(i).getUri();
            } else {
                uris = WebChromeClient.FileChooserParams.parseResult(resultado.getResultCode(), dados);
            }
            cb.onReceiveValue(uris);
        });
    }

    @Override
    public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams params) {
        // Foto direta da câmera (input com capture): segue o caminho padrão do Capacitor
        if (params.isCaptureEnabled()) return super.onShowFileChooser(webView, filePathCallback, params);
        try {
            Intent pedido = params.createIntent();
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) pedido.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            String[] tipos = params.getAcceptTypes();
            if (tipos != null && tipos.length > 1) {
                java.util.List<String> validos = new java.util.ArrayList<>();
                for (String t : tipos) if (t != null && t.contains("/") && !validos.contains(t)) validos.add(t);
                if (validos.size() > 1) pedido.putExtra(Intent.EXTRA_MIME_TYPES, validos.toArray(new String[0]));
            }
            // Abre o seletor do sistema; se um seletor anterior ficou sem resposta, libera ele antes
            if (retorno != null) retorno.onReceiveValue(null);
            retorno = filePathCallback;
            lancador.launch(Intent.createChooser(pedido, "Escolha uma ação"));
            return true;
        } catch (RuntimeException e) { // inclui ActivityNotFoundException
            retorno = null;
            return super.onShowFileChooser(webView, filePathCallback, params);
        }
    }
}
