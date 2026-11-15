# Instalador e atualizações automáticas

O jogo agora tem um **instalador para Windows** e um **launcher que se atualiza sozinho** a cada abertura, baixando só os arquivos que mudaram. Tudo usa o que já vem no Windows (PowerShell 5.1, IExpress, Edge/Chrome); o jogador não precisa instalar nada.

## Para o jogador

1. Execute **`KaidoNights-Setup.exe`** (ou `KaidoNights-Setup-Completo.exe`, que funciona sem internet).
   - Instala em `%LOCALAPPDATA%\Programs\KaidoNights` — **não pede administrador**.
   - Cria atalhos na área de trabalho e no menu Iniciar (*Kaido Nights*, *Reparar Kaido Nights*, *Desinstalar Kaido Nights*) e aparece em *Configurações → Aplicativos instalados*.
2. Abra pelo atalho **Kaido Nights** — é o aplicativo nativo **`KaidoNights.exe`**:
   - procura uma versão nova, mostra as novidades e uma barra de progresso, e baixa **apenas o que mudou** (inclusive o próprio `.exe`, que reinicia sozinho);
   - abre o jogo numa janela própria do Windows, sem barra de endereço nem menus de navegador (o motor é o componente Microsoft Edge WebView2, que já vem no Windows 10/11). **F11** ou **Alt+Enter** alterna tela cheia/janela; a escolha fica salva;
   - se o WebView2 não existir no PC, oferece o download da Microsoft ou abrir no navegador;
   - sem internet ou com o servidor de atualização fora do ar, abre a versão instalada normalmente.
3. **Reparar Kaido Nights** confere o SHA-256 de todos os arquivos e corrige os danificados.
4. Desinstalar pergunta se você quer manter os saves (ficam em `%LOCALAPPDATA%\KaidoNights`).

> O Windows pode mostrar o aviso do SmartScreen ("Editor desconhecido") porque o `.exe` não tem certificado de assinatura de código. Clique em *Mais informações → Executar assim mesmo*. Para remover o aviso é preciso comprar um certificado de code signing (decisão do dono do projeto).

Os saves da versão instalada ficam no perfil do navegador do launcher (`%LOCALAPPDATA%\KaidoNights\browser-profile`), separados do jogo aberto pelo `INICIAR_JOGO.bat`.

## Publicação automática pelo GitHub (recomendado)

O repositório **github.com/scoffyt/KaidoNights** é o canal oficial de atualizações:

- **Cada `push` na branch `main` publica uma versão** (workflow `.github/workflows/release.yml`, roda num Windows do GitHub):
  1. gera o manifesto assinado e o publica na branch `update-channel`;
  2. os launchers instalados leem `https://raw.githubusercontent.com/scoffyt/KaidoNights/update-channel/manifest.json` e baixam **só os arquivos alterados**, direto do repositório, no commit publicado;
  3. gera `KaidoNights-Setup.exe` e `KaidoNights-Setup-Completo.exe` e cria a Release `vX.Y.Z` — link fixo para jogadores: **https://github.com/scoffyt/KaidoNights/releases/latest**.
- Versão = `maior.menor` do `package.json` + número de commits (ex.: 2.1.37). Para mudar de 2.1 para 2.2, edite `"version"` no `package.json`.
- A mensagem do commit vira o texto de "Novidades" mostrado no launcher.

**Configuração única:** no GitHub, *Settings → Secrets and variables → Actions → New repository secret*, nome **`RELEASE_PRIVATE_KEY`**, valor = todo o conteúdo do arquivo `keys/release-private.pem` (de `-----BEGIN PRIVATE KEY-----` até `-----END PRIVATE KEY-----`). Sem ele o workflow para com um aviso. A chave nunca vai para o repositório (`keys/` está no `.gitignore`).

Para enviar alterações: `git add -A && git commit -m "O que mudou" && git push`.

## Publicação manual / servidor próprio (alternativa)

Requer Node.js 22.13+ no PC onde você gera as versões.

### 1. Configure onde as atualizações ficarão
Edite **`launcher/update.json`** antes da primeira publicação:
```json
{ "manifestUrls": ["https://SEU-SERVIDOR/updates/manifest.json"], "playUrl": "", "browser": "auto" }
```
- O próprio **servidor online** (`INICIAR_SERVIDOR_ONLINE.bat`) publica a pasta `release/` em `/updates/` — ex.: `http://SEU-IP:8090/updates/manifest.json` na rede local, ou seu domínio HTTPS na internet.
- Também funciona em qualquer hospedagem de arquivos estáticos (GitHub Pages, Netlify, S3, etc.): envie o conteúdo de `release/` e use a URL de `manifest.json`.
- Pode listar várias URLs (espelhos); o launcher tenta em ordem.
- `playUrl` (opcional): se preenchido, o launcher abre esse endereço (ex.: o servidor online) em vez do servidor local.

### 2. Publique uma versão e gere os instaladores
Dois cliques em **`CRIAR_INSTALADOR.bat`**: ele pergunta as novidades, publica a versão nova (`tools/release.mjs`) e gera em `dist/`:
- `KaidoNights-Setup.exe` — pequeno, baixa o jogo do servidor de atualização;
- `KaidoNights-Setup-Completo.exe` — leva o jogo inteiro (instala sem internet).

Ou manualmente:
```
node tools/release.mjs --notes "Novo carro e correções"     (aumenta a versão automaticamente)
node tools/release.mjs --version 3.0.0 --notes "..."
powershell -ExecutionPolicy Bypass -File tools\build-setup.ps1
```

### 3. Atualizar quem já instalou
Basta rodar `node tools/release.mjs --notes "..."` e deixar `release/` disponível na URL configurada (se usa o servidor online, ele já serve a pasta). Na próxima vez que o jogador abrir o jogo, ele recebe a versão nova. Arquivos que não mudaram não são baixados de novo.

## Segurança do canal de atualização

- Na primeira publicação é criada a chave **`keys/release-private.pem`**. **Ela nunca deve sair do seu PC** (não envie ao servidor, repositório ou jogadores) — faça backup dela: sem ela você não consegue mais publicar atualizações para quem já instalou. Sua parte pública vai junto com o jogo em `launcher/update-key.xml`.
- O manifesto é assinado (RSA 3072, SHA-256). O launcher **recusa** manifestos sem assinatura válida, então um servidor invadido ou um espelho falso não consegue distribuir arquivos.
- Cada arquivo é verificado pelo SHA-256 antes de ser instalado. Nada é substituído antes de todos os arquivos estarem baixados e conferidos; se algo falhar no meio da instalação, os arquivos antigos são restaurados do backup (as 2 últimas cópias ficam em `%LOCALAPPDATA%\KaidoNights\backup`).
- Downloads interrompidos são retomados na próxima abertura (os arquivos já conferidos na pasta `staging` são reaproveitados).
- O servidor só entrega `manifest.json`, `manifest.json.sig`, `objects/<sha256>` e `versions/<x.y.z>.json` em `/updates/`; `keys/`, `release/` (direto), `.kaido/`, `data/` e `logs/` são bloqueados.
- Prefira HTTPS para a URL de atualização.

## Estrutura

| Arquivo | Função |
|---|---|
| `native/KaidoNights.cs`, `native/GameHost.cs` | aplicativo nativo: atualizador + janela WebView2 (compilado por `tools/build-native.ps1`) |
| `launcher/Instalar.ps1` | instala/atualiza/desinstala, atalhos, entrada em "Aplicativos instalados" |
| `launcher/Launcher.ps1` | verifica e aplica atualizações, inicia servidor local e a janela do jogo |
| `launcher/KaidoCommon.ps1` | download, verificação de assinatura e hash, aplicação com backup, janela de progresso |
| `launcher/KaidoNights.vbs` | abre o launcher sem janela de console (alvo dos atalhos) |
| `launcher/update.json` | URLs de atualização |
| `launcher/update-key.xml` | chave pública (gerada pelo `release.mjs`) |
| `INSTALAR.bat` | instala a partir desta pasta (usa `release/` se existir, senão as URLs) |
| `CRIAR_INSTALADOR.bat`, `tools/release.mjs`, `tools/build-setup.ps1` | publicação e geração dos `.exe` |
| `tests/release.test.js` | testa assinatura, adulteração e o canal `/updates/` do servidor |
