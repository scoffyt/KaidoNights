# Relatório de desenvolvimento — KAIDO NIGHTS

## Ambiente e decisões técnicas

- Pasta inicial continha apenas `R34.glb` (15,9 MB, 2797 nós, 1388 malhas, 266 mil triângulos, 22 materiais, extensões de clearcoat/specular/transmission).
- Tecnologia escolhida: **Three.js r170** (renderização WebGL2) com módulos ES nativos, sem etapa de build. A biblioteca foi copiada para `lib/` para o jogo rodar **offline**.
- Física: em vez do Rapier, foi escrita uma física de veículo própria (pneus com escorregamento combinado), porque drift exige controle fino do modelo de pneu que um motor genérico não oferece. Colisões são resolvidas por impulsos contra segmentos (muros), círculos (cones) e entre carros.
- Áudio 100% sintetizado (WebAudio) — não havia arquivos de som e não há acesso à internet no ambiente de desenvolvimento.
- Servidor local em PowerShell (`servidor.ps1`), pois navegadores bloqueiam módulos e GLB via `file://`.

## Importação do GLB

- Rodas localizadas pelos nós `3DWheel_Front_L/R`, `3DWheel_Rear_L/R` e pinças `Calliper_*` (o GLTFLoader troca espaços por "_").
- Orientação/escala calculadas a partir das 4 rodas (entre-eixos normalizado para 2,665 m; frente = +Z; chão = ponto mais baixo).
- As ~1400 malhas são **fundidas por material**: carroceria em 18 draw calls, cada roda em 1, pinças separadas (giram com o esterço, não com a roda).
- Material de pintura substituído por MeshPhysicalMaterial com clearcoat (cor/acabamento editáveis). Vidro vermelho do modelo vira luz de freio (emissivo). Transmissão desativada (evita uma passada extra de renderização da cena inteira).
- Versão LOD (sem interior/motor) para carros da IA e estacionados.

## Testes executados

Testes automatizados no Chrome headless (SwiftShader/WebGL2) via Playwright, com o jogo servido localmente, além de testes de física/IA no Node:

| # | Teste | Resultado |
|---|---|---|
| 1 | Carregamento inicial (texturas, pista, GLB, shaders) | OK, sem erros de console |
| 2 | Menu principal, navegação por teclado (↑↓ Enter ESC) e mouse | OK |
| 3 | Entrada no mapa (todos os 5 modos) | OK |
| 4 | Carregamento do carro (rodas, pinças, luzes detectadas) | OK — 4 rodas, raio 0,33 m, bitola 1,48 m |
| 5 | Aceleração | 0–100 km/h ≈ 5,5 s; máxima ≈ 250 km/h |
| 6 | Frenagem | 250→0 km/h em ≈ 200 m; ABS opcional |
| 7 | Direção | OK, sensível à velocidade no teclado; analógico no controle |
| 8 | Freio de mão | OK — inicia derrapagem |
| 9 | Drift | Drift sustentado de 10 s com assistência média num piloto-robô de teclado (binário); transições e donuts funcionam |
| 10 | Pontuação | Combos, multiplicador até x10, transições, zonas, bônus de muro e linha, falhas (batida, fora da pista, rodar), banco de pontos |
| 11 | Desafios (9) | Contagem regressiva, metas, medalhas, créditos, recorde; inclui Gymkhana no paddock |
| 12 | Corridas | IA completa as voltas (Fácil ≈ 96 s, Normal ≈ 90 s, Difícil ≈ 86 s por volta); posições, voltas, resultado final com tempos |
| 13 | Drift Battle | 2 baterias completas, notas, penalidades, resultado |
| 14 | Time Attack | Volta completa salva, fantasma gravado e reproduzido, setores |
| 15 | Câmeras | 5 modos alternando com C |
| 16 | Interface | HUD (velocímetro/conta-giros, marcha, nitro, pontuação, ângulo, minimapa, posições), pausa, configurações, estatísticas, garagem |
| 17 | Áudio | AudioContext ativo, vozes de motor criadas para todos os carros, sem erros (não é possível ouvir no ambiente de teste) |
| 18 | Salvamento | localStorage: configurações, carro, recordes, ranking, histórico, créditos, desbloqueios |
| 19 | Reinicialização / tentar de novo / sair | OK |
| 20 | Qualidades Baixa/Alta/Ultra e horários Noite/Pôr do sol/Dia | OK |

Desempenho medido (grid de largada com 5 carros): Baixa ≈ 310 draw calls / 1,4 M triângulos; Alta ≈ 365 / 2,0 M (com sombras); Ultra ≈ 750 / 4,2 M (GTAO + MSAA + sombras 4K).

### Bugs encontrados e corrigidos durante os testes
- Malha da pista e das zebras com faces voltadas para baixo (invisíveis) → correção automática de orientação dos triângulos.
- Nomes de nós do GLB sanitizados pelo loader impediam encontrar as rodas → regex aceita "_".
- Instabilidade numérica da rotação das rodas dianteiras → limite de força pela inércia da roda.
- Embreagem patinando em marchas altas (giro preso em 4750 rpm) → patinação só na largada.
- Câmbio automático trocando cedo demais com o pneu patinando e "caçando" marchas → referência de giro corrigida e histerese.
- Torque excessivo (pneu patinando até a 3ª marcha) → curva de torque e aderência rebalanceadas.
- Interface atrás do canvas (z-index), contador de luzes da largada, pausa/retomar com ESC em sequência, voz do motor do jogador criada antes do AudioContext, troca de número de luzes recompilando shaders (pista sumia por alguns quadros).

## Limitações conhecidas
- Testes de jogabilidade foram feitos com pilotos-robô; o ajuste fino de sensação ao volante/teclado real pode precisar de calibração (há sliders de assistência e de acerto na garagem).
- O chão é plano para a física (a suspensão é visual). Sem elevação na pista.
- O líder do tandem (IA) usa a linha de corrida com pose de drift roteirizada (visual + fumaça) para ser confiável; a pontuação dele é escalonada pela dificuldade.
- Áudio sintetizado: soa como um motor de 6 cilindros turbo estilizado, não como gravações reais.
- Trocar a qualidade gráfica em jogo não reconstrói a quantidade de árvores (definida no carregamento).

## Funcionalidades concluídas
Todas as seções pedidas: importação real do GLB com rodas/esterço/suspensão visual/luzes, física de drift, mapa completo com boxes, estacionamento, arquibancadas, iluminação, prédios, barreiras, placas, cones, pneus, postes, vegetação e cenário de fundo, gráficos com 3 níveis, 5 modos de jogo, pontuação completa, menus, HUD, garagem com personalização e ajustes, IA com 3 dificuldades, áudio dinâmico, salvamento, README e TODO.

## Pendências
Ver `TODO.md`.
