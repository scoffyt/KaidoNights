# KAIDO NIGHTS — Hakone Bay Drift Circuit

Jogo de drift 3D para navegador (WebGL2), feito do zero com **Three.js r170** (incluído localmente na pasta `lib/` — não precisa de internet nem de instalar nada).
**Novo: mundo aberto multiplayer online** (servidor dedicado real, contas, desafios na rua, corridas validadas pelo servidor, amigos, equipes, chat, economia) — veja a seção *Multiplayer* abaixo e `MULTIPLAYER.md`.
Mapas: **Hakone Bay** (circuito + paddock) e **Drift Park** (`assets/maps/drift_track.glb`), ligados por uma estrada — um único mundo.
Carros: **Nissan Skyline GT-R R34**, **Toyota Supra MK4**, **Nissan Silvia S14 drift**, **Nissan 240SX (S13)** e **Ford Mustang "Hoonicorn"**, importados de verdade (rodas, pinças de freio, lanternas de freio e pintura são peças animadas/editáveis do próprio modelo), cada um com sua própria física.
Vegetação: **Stylized Nature MegaKit** (`assets/nature/`) — árvores, pinheiros, arbustos, flores, grama e pedras espalhados pelo circuito, com vento nas folhas.
Menus no estilo "festival": abas com Q/E (LB/RB), blocos grandes, configurações com descrição e **seleção de carros com preview 3D num stand giratório**.

---

## Como iniciar

1. Dê **dois cliques em `INICIAR_JOGO.bat`**.
   - Ele abre um pequeno servidor local (PowerShell, já incluso no Windows) e o jogo no seu navegador padrão em `http://localhost:8080/`.
   - Mantenha a janela preta aberta enquanto joga. Feche-a para encerrar.
2. Use **Chrome, Edge ou Firefox** atualizados, com aceleração por hardware ligada.

> Abrir o `index.html` direto com duplo clique **não funciona** (o navegador bloqueia módulos JS e o GLB via `file://`). O jogo mostra um aviso nesse caso.
>
> Alternativa (se tiver Python): `python -m http.server 8080` dentro da pasta e acesse `http://localhost:8080/`.

O arquivo `R34.glb` precisa ficar na mesma pasta do `index.html`. Se ele faltar, o jogo usa um carro provisório e avisa na tela.

---

## Instalador com atualizações automáticas

**Baixar o jogo:** https://github.com/scoffyt/KaidoNights/releases/latest — `KaidoNights-Setup.exe`. Cada push na `main` publica uma nova versão e os jogos instalados se atualizam sozinhos (veja `ATUALIZACOES.md`).

Gere os instaladores com **`CRIAR_INSTALADOR.bat`** (precisa do Node.js 22.13+): saem `dist/KaidoNights-Setup.exe` e `dist/KaidoNights-Setup-Completo.exe`. Instalado, o jogo abre pelo atalho **Kaido Nights**, procura atualizações, baixa só o que mudou (com assinatura e hash verificados) e abre numa janela própria. Antes da primeira publicação, coloque o endereço do seu servidor em `launcher/update.json`. Detalhes em **`ATUALIZACOES.md`**.

---

## Multiplayer (mundo online)

Requer **Node.js 22.13 ou mais novo** (https://nodejs.org — versão LTS). Nada mais para instalar (sem `npm install`).

1. Dê dois cliques em **`INICIAR_SERVIDOR_ONLINE.bat`** (no PC que será o servidor). Ele cria o banco de dados em `data/` e abre `http://localhost:8090`.
2. No jogo: aba **Online** → **Mundo Online** → crie sua conta → **Entrar no mundo**.
3. Em outro computador da mesma rede: abra `http://IP-DO-SERVIDOR:8090` (descubra o IP com `ipconfig`; libere a porta 8090 no Firewall do Windows quando ele perguntar).

Teclas no mundo online: **G** desafiar o piloto próximo (1–6 escolhe a modalidade) • **Y/N** aceitar/recusar desafio • **H** buzina • **J** piscar farol • **Enter** chat (`/g` global, `/e` equipe, `/w nome` privado) • **Tab** jogadores • **M** mapa • **X** abandonar corrida • **ESC** menu online (mapa, jogadores, amigos/equipe, garagem, estatísticas, eventos, sair).

Detalhes: `MULTIPLAYER.md` (como jogar e testar com dois clientes), `ARCHITECTURE.md`, `DEPLOY.md`, `SECURITY.md`, `RELATORIO_TESTES_MULTIPLAYER.md`.

---

## Controles

| Ação | Teclado | Controle (XInput) |
|---|---|---|
| Acelerar | W / ↑ | RT |
| Frear / Ré (segure parado) | S / ↓ | LT |
| Direção | A D / ← → | Analógico esquerdo |
| Freio de mão | Espaço | A / B |
| Nitro | Shift | X |
| Embreagem (clutch kick) | F | LB |
| Marchas (modo manual) | Q / E | RB / D-pad ↓ |
| Câmera (perseguição, distante, **livre**, capô, para-choque, cinemática) | C | Y |
| Câmera livre: girar em volta do carro | Mouse (clique na tela para travar o cursor; ESC solta) | — |
| Câmera livre: zoom | Roda do mouse | — |
| Câmera livre: seguir o giro do carro / ficar fixa no mundo | Botão direito | — |
| Olhar em volta nas câmeras de perseguição | Arrastar com o mouse (volta sozinha) | — |
| Olhar para trás | B | L3 |
| Reposicionar carro | R | Select |
| Faróis | L | — |
| Pausa | ESC / P | Start |

Menus: setas/WASD + Enter, ESC volta. Mouse também funciona. F1 no menu mostra os controles.

---

## Modos de jogo

- **Drift Livre** — circuito + paddock (área de donuts, estacionamento, boxes) sem limite de tempo, pontuação em tempo real.
- **Drift Challenge** — 9 desafios com metas Bronze/Prata/Ouro, tempo limite, ângulo mínimo, velocidade mínima, combo, zonas de clipping, volta única. Medalhas dão créditos.
- **Drift Battle** — tandem 1×1 contra a IA em duas baterias (você persegue / você lidera). Juízes avaliam tempo em drift, ângulo, proximidade do líder e penalidades por contato e por ficar para trás.
- **Corrida** — 1 a 5 adversários IA (Fácil/Normal/Difícil), largada com semáforo no pórtico, 1–5 voltas, posições, checkpoints, contramão, resultado final.
- **Time Attack** — voltas contra o relógio com tempos de setor, **fantasma** da melhor volta e recordes salvos.

## Sistema de pontuação de drift

- Pontos/s = ângulo × velocidade (+ bônus perto do muro); sequência continua enquanto você mantém o carro de lado.
- Multiplicador cresce com a duração do combo e com **transições** (troca de lado sem endireitar), até x10.
- **Zonas de clipping** (postes azuis no lado de fora/dentro das curvas) dão bônus.
- O combo é **perdido** ao bater, sair da pista (2+ rodas na grama/brita) ou rodar.
- **Anti-farm**: girar parado no mesmo lugar não pontua (só a área DONUT ZONE dá pontuação reduzida, e exige velocidade).
- Recordes, ranking local (top 10 por modo) e histórico ficam salvos no navegador (localStorage).

## Física

Modelo próprio (arquivo `src/car/physics.js`, testável no Node):
- Corpo rígido planar com 4 pneus independentes e **modelo de pneu com escorregamento combinado** (elipse de atrito + queda de aderência após o pico), carga dinâmica por **transferência de peso** longitudinal e lateral.
- Motor com curva de torque, limitador, freio-motor, embreagem que patina na largada, câmbio de 6 marchas (automático ou manual), diferencial traseiro travado (ideal para drift), freio de mão, ABS e controle de tração opcionais, nitro.
- Superfícies: asfalto, zebra, grama e brita (aderência e arrasto diferentes, poeira).
- Assistências configuráveis: contra-esterço automático e estabilidade em drift (ajudam no teclado; podem ser desligadas).
- Colisões com muros/pneus (impulso com atrito e rotação), entre carros e com cones derrubáveis.

## Gráficos

- Iluminação dinâmica, sombras (PCF soft), materiais PBR, pintura com clearcoat (metálico, fosco, perolado, cromado), reflexos por environment map (PMREM).
- Três horários: **Noite** (céu com estrelas e lua, holofotes reais próximos ao jogador, poças de luz, faróis com SpotLight), **Pôr do sol** e **Dia** (céu físico).
- Pós-processamento: Bloom, GTAO (ambient occlusion, Ultra), SMAA/FXAA, motion blur radial por velocidade, vinheta, tone mapping ACES.
- Fumaça dos pneus com partículas instanciadas, poeira na grama/brita, faíscas em batidas, chamas de escapamento, marcas de pneu no asfalto e na grama.
- Qualidade **Baixa / Alta / Ultra** + escala de resolução + limite de FPS.

## Áudio

**Sons reais (gratuitos):** motor com gravações reais CC0 (domasx2, OpenGameArt) misturadas por RPM, pneus cantando com gravação real CC-BY 3.0 (audible-edge/Tom Haigh, OpenGameArt) e batidas MIT (Godot demo projects). Créditos completos em `assets/sounds/CREDITS.txt`. Se os arquivos faltarem, o jogo volta ao som sintetizado.


Todo sintetizado em tempo real (WebAudio), sem arquivos externos: motor I6 com harmônicos dependentes de RPM e carga, turbo, válvula de alívio (blow-off), estouros no limitador, troca de marcha, pneus cantando, grama/brita, vento, batidas, cones, efeitos de interface e trilha synthwave procedural no menu e na corrida. Áudio espacial (HRTF) para os carros da IA.

## Garagem

Visualização 3D em estúdio com câmera orbital; pintura (16 cores + cor livre), acabamento, cor das rodas, fumaça colorida, altura, suspensão, potência, relação final, aderência, equilíbrio, ângulo de esterço, freio de mão e presets Drift/Grip. Acabamentos e fumaças especiais são desbloqueados com créditos.

---

## Estrutura do projeto

```
index.html            página principal (import map para lib/)
INICIAR_JOGO.bat      inicia servidor local + abre o navegador
servidor.ps1          servidor HTTP mínimo em PowerShell
R34.glb               modelo do carro (fornecido)
css/style.css         interface
lib/                  three.js r170 + addons usados (licença MIT em lib/THREE_LICENSE)
src/main.js           ponto de entrada
src/game.js           orquestração: estados, loop, garagem, eventos
src/core/             renderer + pós-processamento, input, câmera, save
src/world/            circuito (spline, linha ideal), cenário, vegetação (nature.js), texturas, céu/iluminação
src/car/cars.js       catálogo de carros (adicione novos GLBs aqui)
assets/nature/        modelos glTF do Stylized Nature MegaKit (texturas de casca reduzidas para 1024px)
assets/cars/          GLBs dos carros adicionais
src/car/              física, importação do GLB, entidade do carro, IA
src/fx/               partículas e marcas de pneu
src/modes/            modos de jogo e pontuação
src/ui/               menus, HUD, garagem, resultados
src/audio/            motor de áudio sintetizado e música
tests/                testes de física/IA/pista executáveis com Node (`node tests/physics.test.js`)
```

## Testes realizados

Veja `RELATORIO.md`.
