
[Site](https://JoaoOMago.github.io/Cortador-de-Audio)

# vox acies 🎵✂️

Editor de áudio em lote estático e **100% client-side**, desenvolvido para rodar diretamente no navegador e ser hospedado gratuitamente no **GitHub Pages** através da pasta `/docs`.

Nenhum arquivo de áudio é enviado para servidores externos. Todo o processamento (corte de forma de onda, leitura e escrita de metadados ID3, sincronia de letras LRC e embutimento de imagem de capa) acontece localmente na máquina do usuário via WebAssembly e Web Audio API.

---

## 🚀 Funcionalidades Principais

1. **Amplo Suporte a Formatos de Áudio**:
   - **Padrões**: MP3, WAV, M4A, FLAC, OGG, AAC.
   - **Formatos Clássicos & Menos Usados**: MPEG / MPG (`.mpeg`, `.mpg`, `.mp2`, `.m1a`, `.m2a`, `.mpa`), Opus (`.opus`), WMA (`.wma`), AIFF (`.aiff`, `.aif`), ALAC (`.alac`), WebM (`.weba`, `.webm`), Monkey's Audio (`.ape`), WavPack (`.wv`), True Audio (`.tta`), Musepack (`.mpc`), AC3, AMR.
   - Fallback inteligente com transcodificação interna via **FFmpeg.wasm** caso o navegador não possua decodificador nativo para formatos raros.

2. **Corte Preciso de Vinhetas (In e Out)**:
   - Visualização gráfica de forma de onda (waveform) de alta definição via **WaveSurfer.js (v7)**.
   - **Barra Vertical Indicadora de Seleção**: ao clicar em qualquer ponto da forma de onda ou usar os botões de ajuste fino, uma barra vertical neon ciano (`📍 mm:ss.xx`) é exibida em tempo real indicando com precisão o local selecionado.
   - Clicar na waveform apenas move o cursor/playhead e posiciona o indicador (não realiza cortes acidentais).
   - Botão **"Cortar início até aqui"**: fixa uma barra vertical verde (`✂ Início: mm:ss.xx`) e elimina vinhetas de introdução antes do ponto selecionado.
   - Botão **"Cortar daqui até o fim"**: fixa uma barra vertical vermelha (`✂ Fim: mm:ss.xx`) e elimina vinhetas de encerramento após o ponto selecionado.
   - Botão **"Desfazer corte"**: restaura a faixa original instantaneamente.
   - Indicação visual colorida destacando o trecho mantido (verde esmeralda translúcido) e os trechos cortados/descartados (vermelho translúcido com rótulos `✂️ Vinheta Início` e `✂️ Vinheta Fim`).
   - Botão **"Tocar trecho"**: reproduz apenas a porção final que será salva.
   - Controles de ajuste fino (`-0.1s` e `+0.1s`).

3. **Controle de Velocidade de Reprodução**:
   - Botões dedicados para `1x`, `0.5x` e `0.25x` para escuta detalhada de pontos de corte sem alterar a exportação final.

4. **Edição de Metadados ID3v2 & Capa de Álbum (Artwork)**:
   - Extração robusta multi-camada de metadados e capas: `music-metadata` em memória + `jsmediatags` fallback + scanner binário direto para APIC ID3v2.
   - Edição de **Título**, **Artista**, **Álbum** e **Ano**.
   - Exibição da miniatura da capa existente com opção de troca rápida (JPEG, PNG, WEBP) e pré-visualização instantânea.
   - Inserção de capa em formato MJPEG compatível com reprodutores de som, celulares e centrais multimídia automotivas.

5. **Suporte Completo a Letras Sincronizadas (.LRC)**:
   - Arraste arquivos `.lrc` junto com suas músicas: pareamento automático por nome de arquivo.
   - Painel expansível de letra em cada card para visualização e edição direta do texto e timestamps `[mm:ss.xx]`.
   - **Sincronia Automática nos Cortes**: ao cortar uma vinheta de introdução, os timestamps do `.lrc` são recalculados e adiantados automaticamente para manter a letra 100% no tempo certo da música cortada!
   - Embutimento da letra nas tags ID3 do arquivo e exportação do arquivo `.lrc` sincronizado no pacote `.zip` ou download avulso.

6. **Processamento em Lote & Download Único em ZIP**:
   - Suporte a múltiplos arquivos simultâneos via seleção ou arrastar e soltar (drag & drop).
   - Processamento individual com indicador de progresso e status.
   - Nomeação padronizada dos arquivos resultantes: `{Artista} - {Título}.mp3` (e `.lrc` correspondente).
   - Botão fixo **"Baixar tudo (.ZIP)"**: processa toda a fila com **FFmpeg.wasm** e compacta tudo em um arquivo `.zip` via **JSZip**.
   - Botão para download individual de cada faixa e letra processada.

---

## 🛠️ Stack Tecnológica

- **Vite**: Bundler rápido e moderno, configurado com caminhos relativos (`base: './'`) e saída em `outDir: 'docs'`.
- **WaveSurfer.js (v7)**: Desenho das waveforms, controle de reprodução, taxas de velocidade e plugin de regiões visuais.
- **FFmpeg.wasm (`@ffmpeg/ffmpeg` + `@ffmpeg/util`)**: Motor de corte preciso e injeção de tags ID3v2 + capa MJPEG rodando WebAssembly single-threaded (compatível nativamente com GitHub Pages sem necessidade de configurações de cabeçalhos COOP/COEP no servidor).
- **music-metadata-browser + jsmediatags**: Leitura client-side robusta de metadados e extração de capas embutidas.
- **JSZip**: Criação do pacote `.zip` diretamente na memória do navegador.

---

## 📁 Estrutura de Pastas

```
/ (raiz do repositório)
├── docs/                      ← Pasta publicada pelo GitHub Pages (build de produção)
│   ├── index.html
│   └── assets/
├── src/                       ← Código-fonte da aplicação
│   ├── components/
│   │   ├── audioProcessor.js  ← Integração com FFmpeg.wasm (corte, tags e transcode)
│   │   ├── lrcParser.js       ← Parser, formatador e offset de timestamps de letras LRC
│   │   ├── metadataReader.js  ← Extrator de tags e capas com fallbacks
│   │   ├── trackCard.js       ← Card interativo com WaveSurfer, controles e aba LRC
│   │   └── zipExporter.js     ← Empacotamento em ZIP com suporte a áudio + .lrc
│   ├── main.js                ← Coordenação geral, drag & drop e fila de exportação
│   └── styles.css             ← Interface estilo DAW escura e responsiva
├── index.html                 ← Template HTML base
├── vite.config.js             ← Configuração de build para /docs
├── package.json
└── README.md
```

---

## 💻 Como Rodar Localmente

```bash
# 1. Instalar dependências
npm install

# 2. Iniciar servidor de desenvolvimento
npm run dev
```

### Gerando o Build para Publicação
```bash
npm run build
```
O comando compilará todos os arquivos diretamente para a pasta `/docs`.

---

## 🌐 Como Publicar no GitHub Pages

1. Faça o commit e envie as alterações para o seu repositório no GitHub:
   ```bash
   git add .
   git commit -m "Suporte a capa corrigido, suporte a MPEG, LRC e formatos adicionais"
   git push origin main
   ```
2. No repositório do GitHub, acesse a aba **Settings** (Configurações).
3. Na barra lateral esquerda, clique em **Pages**.
4. Em **Build and deployment**:
   - **Source**: Selecione `Deploy from a branch`.
   - **Branch**: Selecione `main` e a pasta `/docs`.
   - Clique em **Save**.
5. Aguarde cerca de 1 minuto. O GitHub Pages fornecerá o link público do seu site.

---

## 🔒 Privacidade & Segurança

- **Zero telemetria ou envio de arquivos**: Todos os bytes de áudio, imagens e letras são processados exclusivamente na memória RAM do seu próprio navegador.
- Os arquivos não passam por nenhum backend ou serviço em nuvem.
