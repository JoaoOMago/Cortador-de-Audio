# [🎵 vox acies](https://JoaoOMago.github.io/Cortador-de-Audio)

O **vox acies** é um estúdio de corte de áudio, edição de metadados (tags ID3) e gerenciamento de capas de álbum que roda **100% no navegador (Client-Side)**. A aplicação foi projetada para ser rápida, privativa e gratuita, dispensando envio de arquivos para servidores externos.

---

## 📑 Índice

1. [Arquitetura & Privacidade (Zero Servidor)](#secao-1)
2. [Formatos Suportados & Upload em Lote](#secao-2)
3. [Corte Visual de Áudio (WaveSurfer & Web Audio)](#secao-3)
4. [Edição Avançada de Metadados (ID3v2)](#secao-4)
5. [Busca Inteligente & Autocomplete na Web](#secao-5)
6. [Gerenciamento de Capas de Álbum (Artwork)](#secao-6)
7. [Motor de Processamento WebAssembly (FFmpeg.wasm)](#secao-7)
8. [Exportação Individual & Pacote .ZIP](#secao-8)
9. [Diagnóstico, Logs de Erro & Resiliência](#secao-9)

---

## <a id="secao-1"></a>1. 🛡️ Arquitetura & Privacidade (Zero Servidor)

* **100% Client-Side:** Todo o processamento de áudio, geração das formas de onda, leitura e escrita de tags ID3 e compressão em ZIP acontecem localmente na memória RAM do computador/celular do usuário.
* **Privacidade Absoluta:** Suas músicas e arquivos pessoais nunca saem do seu navegador.
* **Compatibilidade Estática:** Pode ser hospedado gratuitamente no **GitHub Pages** (pasta /docs) ou em qualquer CDN estático sem necessidade de Node.js ou banco de dados no backend.

---

## <a id="secao-2"></a>2. 📂 Formatos Suportados & Upload em Lote

* **Arrastar e Soltar (Drag & Drop):** Arraste dezenas de músicas diretamente na área pontilhada da interface.
* **Seleção Múltipla:** Botão de seleção de arquivos compatível com múltiplos itens simultâneos.
* **Formatos Aceitos:**
  * **Padrões:** MP3, WAV, M4A, FLAC, OGG, OPUS, AAC.
  * **Clássicos e Adicionais:** WMA, AIFF, ALAC, WebM/WebA, APE (Monkey's Audio), WavPack (.wv), TTA, MPC, AC3, AMR.
* **Painel e Contadores:** Barra superior com contador dinâmico de faixas carregadas e atalhos rápidos.

---

## <a id="secao-3"></a>3. ✂️ Corte Visual de Áudio (WaveSurfer & Web Audio)

* **Forma de Onda Interativa:** Renderizada via **WaveSurfer.js (v7)** com visualização precisa dos picos de volume da música.
* **Cálculo da Duração PCM Real:** O sistema decodifica os buffers brutos via AudioContext para obter o tempo milimétrico exato, eliminando discrepâncias causadas por cabeçalhos incorretos de MP3s com taxa de bits variável (VBR).
* **Posicionamento do Cursor Sem Cortes Acidentais:** Clicar na forma de onda apenas posiciona a agulha de reprodução e o marcador neon ciano (📍 Cursor: mm:ss.xx), sem perigo de cortar por engano.
* **Corte de Vinhetas em 1 Clique:**
  * 🟢 **"Cortar início até aqui":** Elimina introduções, falas, anúncios ou vinhetas anteriores ao cursor.
  * 🔴 **"Cortar daqui até o fim":** Elimina encerramentos, aplausos ou vinhetas posteriores ao cursor.
  * ↺ **"Desfazer corte":** Restaura instantaneamente a faixa completa sem perda de dados.
* **Destaque Visual das Regiões:**
  * **Verde translúcido:** Trecho útil que será mantido e exportado.
  * **Vermelho translúcido:** Trechos que serão eliminados.
* **Modo "Tocar Trecho" (Preview do Corte):** Reproduz apenas o trecho selecionado e pausa automaticamente ao atingir o ponto final do corte.
* **Ajuste Fino:** Botões de -0.1s e +0.1s para ajuste cirúrgico do ponto de corte.
* **Controle de Velocidade:** Modos de reprodução em 1x, 0.5x e 0.25x para escutar transições sutis com clareza.

---

## <a id="secao-4"></a>4. 🏷️ Edição Avançada de Metadados (ID3v2)

### Extração Automática Multi-Camada
Ao carregar uma música, a aplicação executa leitura com **dupla camada de fallback**:
1. music-metadata-browser (leitor robusto em memória).
2. jsmediatags (fallback para tags antigas ou formatos específicos).

### Campos Básicos
* **Título da Música** (com detecção do nome do arquivo como fallback).
* **Artista / Banda**.
* **Álbum**.
* **Ano de Lançamento**.

### Campos Extras Configuráveis Globalmente (⚙️)
Através do modal global de configuração de metadados, você pode habilitar ou desabilitar campos extras que se aplicam a todas as faixas da lista:
* **Gênero Musical** (ID3 TCON)
* **BPM / Andamento** (ID3 TBPM)
* **Legenda / Subtítulo / Versão** (ID3 TIT3 - ex: *Remaster*, *Extended Mix*)
* **Classificação / Rating** (ID3 POPM - ex: *Clean*, *Explicit*, *+16*)
* **Compositor** (ID3 TCOM)
* **Número da Faixa** (ID3 TRCK - ex: *1* ou *1/12*)
* **Número do Disco** (ID3 TPOS - ex: *1* ou *1/2*)
* **Artista do Álbum** (ID3 TPE2)
* **Copyright / Gravadora** (ID3 TCOP)
* **Letra da Música** (ID3 USLT - caixa de texto expansível)
* **Comentários / Notas Adicionais** (ID3 COMM)

> As configurações de campos ativos ficam salvas no navegador (localStorage) para que você não precise reconfigurar a cada visita.

---

## <a id="secao-5"></a>5. 🔍 Busca Inteligente & Autocomplete na Web

Em cada campo (Álbum, Ano, Gênero, BPM, Letra, Classificação, etc.), há um botão com ícone de lupa **🔍**:

* **Integração com Fontes Públicas:** Consulta serviços públicos da web (como iTunes Search API, LRCLIB e Deezer) sem exigir login nem chave de API.
* **Dropdown Estilo Google:** Ao clicar na lupa, abre-se uma lista de sugestões limpa com capa em miniatura, títulos e detalhes de lançamento.
* **Preenchimento Cruzado Automático:** Ao escolher um Álbum no dropdown, a aplicação pode preencher automaticamente o Ano e o Gênero associados se eles ainda estiverem vazios.
* **Cálculo Físico de BPM via WebAudio:**
  * O sistema faz uma análise matemática de picos de energia do áudio PCM decodificado diretamente no navegador para estimar o BPM real da música.
  * Disponibiliza sugestões de andamento normal e **Meio-tempo (Half-time)**.
* **Busca Automática de Letras:** Pesquisa e importa letras com 1 clique através da base aberta do LRCLIB.

---

## <a id="secao-6"></a>6. 🖼️ Gerenciamento de Capas de Álbum (Artwork)

* **Leitura da Capa Existente:** Se a música já possuir imagem embutida, ela é renderizada instantaneamente no card.
* **Troca Rápida de Capa:** Permite selecionar qualquer imagem do computador (JPEG, PNG, WEBP).
* **Remoção de Capa:** Botão para limpar a capa caso queira exportar a faixa sem imagem.
* **Otimização Inteligente de Memória (Anti-Crash):**
  * Para evitar estouro de memória no WebAssembly ao lidar com fotos gigantescas de alta resolução, o sistema faz um downscale inteligente da imagem via Canvas para no máximo 1000x1000 em JPEG (qualidade 0.85).
  * Garante capas nítidas, leves e 100% compatíveis com aparelhos de som, celulares e centrais automotivas.

---

## <a id="secao-7"></a>7. ⚙️ Motor de Processamento WebAssembly (FFmpeg.wasm)

* **FFmpeg no Navegador:** Utiliza o motor oficial @ffmpeg/ffmpeg compilado para WebAssembly (single-threaded), funcionando sem necessidade de configurações especiais de cabeçalhos no servidor (COOP/COEP).
* **Corte sem Falhas:** Aplica os parâmetros -ss e -to com codificação MP3 de alta fidelidade (libmp3lame -q:a 2).
* **Sanitização Inteligente de Nomes de Arquivo:**
  * Converte caracteres proibidos no Windows/Linux/macOS (/ \ : * ? " < > |) para equivalentes Unicode visualmente idênticos (exemplo: AC/DC vira AC∕DC).
  * Trata nomes reservados do Windows (CON, PRN, AUX, NUL), aspas inteligentes e pontos no início/fim de arquivos.
* **Controle de Timeout por Música:**
  * Permite definir no topo da página o tempo limite máximo de tolerância por faixa (padrão: 2 minutos).
  * Se um arquivo corrompido travar o processamento, a tarefa é abortada com elegância sem travar as outras músicas da fila.

---

## <a id="secao-8"></a>8. 📦 Exportação Individual & Pacote .ZIP

* **Download Individual:** Cada card possui o botão *"⬇ Baixar esta música (.mp3)"* para processamento e download imediato.
* **Download em Lote (.ZIP):**
  * O botão fixo no rodapé *"📦 Baixar tudo (.ZIP)"* percorre todas as músicas da lista sequencialmente.
  * Exibe barra de progresso individual em cada card e barra de progresso global em tempo real.
  * Empacota todas as músicas editadas num único arquivo .zip via **JSZip**.
  * **Tratamento de Arquivos Duplicados:** Garante que faixas com nomes iguais recebam sufixos numéricos (ex: Musica (1).mp3) para não sobrescrever nenhum arquivo dentro do ZIP.

---

## <a id="secao-9"></a>9. 📋 Diagnóstico, Logs de Erro & Resiliência

* **Badges de Status Dinâmicas:** Acompanhe o estado de cada faixa: Não editado, Cortado, Metadados alterados, Processando..., Pronto ✓ ou Erro.
* **Painel de Log de Erro:**
  * Se ocorrer qualquer falha durante a conversão, o card exibe o botão *"📋 Ver log de erro"*.
  * Abre um modal completo com horário, contexto, causa (timeout, arquivo corrompido, etc.), stack trace e as últimas 40 linhas do console interno do FFmpeg.
  * Botão *"📋 Copiar log"* com um clique para facilitar suporte e resolução de problemas.
* **Auto-Recuperação do Motor:** Se a memória do WebAssembly sofrer instabilidade em arquivos excepcionalmente grandes, a instância do FFmpeg é reinicializada automaticamente para a próxima faixa.
