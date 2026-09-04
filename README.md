# AudioTrim Studio 🎵✂️

Editor de áudio em lote estático e **100% client-side**, desenvolvido para rodar diretamente no navegador e ser hospedado gratuitamente no **GitHub Pages** através da pasta `/docs`.

Nenhum arquivo de áudio é enviado para servidores externos. Todo o processamento (corte de forma de onda, leitura e escrita de metadados ID3 e embutimento de imagem de capa) acontece localmente na máquina do usuário via WebAssembly e Web Audio API.

---

## 🚀 Funcionalidades Principais

1. **Corte Preciso de Vinhetas (In e Out)**:
   - Visualização gráfica de forma de onda (waveform) de alta definição via **WaveSurfer.js**.
   - Clicar em qualquer ponto da waveform apenas move o cursor/playhead (não realiza cortes acidentais).
   - Botão **"Cortar início até aqui"**: elimina vinhetas de introdução antes do ponto selecionado.
   - Botão **"Cortar daqui até o fim"**: elimina vinhetas de encerramento após o ponto selecionado.
   - Botão **"Desfazer corte"**: restaura a faixa original instantaneamente.
   - Indicação visual colorida destacando o trecho mantido (verde suave) e os trechos cortados/descartados (vermelho translúcido).
   - Botão **"Tocar trecho"**: reproduz apenas a porção final que será salva.
   - Controles de ajuste fino (`-0.1s` e `+0.1s`).

2. **Controle de Velocidade de Reprodução**:
   - Botões dedicados para `1x`, `0.5x` e `0.25x` para escuta detalhada de pontos de corte sem alterar a exportação final.

3. **Edição de Metadados ID3v2**:
   - Leitura automática de tags existentes ao carregar o arquivo (`music-metadata-browser`).
   - Edição de **Título**, **Artista**, **Álbum** e **Ano**.
   - Se o título estiver vazio, utiliza o nome do arquivo original sanitizado.

4. **Troca e Gerenciamento de Capa de Álbum (Artwork)**:
   - Exibição de miniatura da capa existente (se presente no arquivo original).
   - Troca simplificada de imagem (JPEG, PNG, WEBP) com pré-visualização em tempo real.
   - Opção para remover a capa.
   - Inserção de tag padrão APIC ID3v2 universalmente compatível com reprodutores de som, celulares e centrais multimídia automotivas.

5. **Processamento em Lote & Download Único em ZIP**:
   - Suporte a múltiplos arquivos simultâneos via seleção ou arrastar e soltar (drag & drop).
   - Processamento individual com indicador de progresso e status (*Não editado*, *Cortado*, *Metadados alterados*, *Processando...*, *Pronto*).
   - Nomeação padronizada dos arquivos resultantes: `{Artista} - {Título}.mp3`.
   - Botão fixo **"Baixar tudo (.ZIP)"**: processa toda a fila com **FFmpeg.wasm** e compacta tudo em um arquivo `.zip` via **JSZip**.
   - Botão para download individual de cada faixa processada.

---

## 🛠️ Stack Tecnológica

- **Vite**: Bundler rápido e moderno, configurado com caminhos relativos (`base: './'`) e saída em `outDir: 'docs'`.
- **WaveSurfer.js (v7)**: Desenho das waveforms, controle de reprodução, taxas de velocidade e plugin de regiões visuais.
- **FFmpeg.wasm (`@ffmpeg/ffmpeg` + `@ffmpeg/util`)**: Motor de corte preciso e injeção de tags ID3v2 + capa MJPEG rodando WebAssembly single-threaded (compatível nativamente com GitHub Pages sem necessidade de configurações de cabeçalhos COOP/COEP no servidor).
- **music-metadata-browser**: Leitura client-side de metadados e extração de imagens de capa embutidas.
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
│   │   ├── audioProcessor.js  ← Integração com FFmpeg.wasm (corte e tags)
│   │   ├── metadataReader.js  ← Extração de tags e capa original
│   │   ├── trackCard.js       ← Card interativo com WaveSurfer e controles
│   │   └── zipExporter.js     ← Empacotamento em ZIP e downloads
│   ├── main.js                ← Coordenação geral e fila de faixas
│   └── styles.css             ← Interface estilo DAW escura e responsiva
├── index.html                 ← Template HTML base
├── vite.config.js             ← Configuração de build para /docs
├── package.json
└── README.md
```

---

## 💻 Como Rodar Localmente

### Pré-requisitos
- Node.js 18+ instalado.

### Instalação e Desenvolvimento
```bash
# 1. Instalar dependências
npm install

# 2. Iniciar servidor de desenvolvimento
npm run dev
```
Abra o navegador no endereço exibido (geralmente `http://localhost:5173`).

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
   git commit -m "Build do editor de áudio para GitHub Pages"
   git push origin main
   ```
2. No repositório do GitHub, acesse a aba **Settings** (Configurações).
3. Na barra lateral esquerda, clique em **Pages**.
4. Em **Build and deployment**:
   - **Source**: Selecione `Deploy from a branch`.
   - **Branch**: Selecione `main` (ou a branch principal) e a pasta `/docs`.
   - Clique em **Save**.
5. Aguarde cerca de 1 minuto. O GitHub Pages fornecerá o link público do seu site (ex.: `https://seu-usuario.github.io/nome-do-repositorio/`).

---

## 🔒 Privacidade & Segurança

- **Zero telemetria ou envio de arquivos**: Todos os bytes de áudio e imagem são processados na memória RAM do seu próprio navegador.
- Os arquivos não passam por nenhum backend ou serviço em nuvem.
- Funciona perfeitamente mesmo sem conexão à internet após o primeiro carregamento da página.
