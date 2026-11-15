# Relatório de testes — Multiplayer

Executados em 15/11/2026 no ambiente de desenvolvimento (Linux, 2 vCPU Intel Xeon 2,1 GHz, Node.js 22.23.4, Chrome headless com renderização por software). Todos os números abaixo vieram de execuções reais; nada foi estimado.

## 1. Testes automatizados ponta a ponta — `npm run test:mp`

Servidor real (processo, banco SQLite em arquivo temporário) + clientes WebSocket independentes (`tests/mp/client.js`, que falam com o servidor exatamente como o navegador).

| # | Teste | Resultado |
|---|---|---|
| 1–2 | Dois jogadores entram na mesma sala, aparecem um para o outro, movimento chega no snapshot com posição/rumo/velocidade exatos | ✔ |
| 3 | Interest management: jogador a ~730 m não recebe snapshots completos, só posição a 1 Hz | ✔ |
| 4 | Desafio: longe demais recusado, convite recebido, convite duplicado bloqueado, recusa notificada, espera após recusa | ✔ |
| 5–12 | Corrida de rua completa: aceite, grid, contagem, checkpoints, chegada, vencedor calculado pelo servidor (mais rápido vence), tempos medidos pelo servidor, recompensa salva no banco, **segunda concessão da mesma recompensa ignorada**, histórico | ✔ |
| 13 | Teleporte até a chegada rejeitado, velocidade de 540 km/h rejeitada, desclassificação na 3ª violação, atividade suspeita registrada | ✔ |
| 14–15 | Desconexão durante a corrida → reconexão com o mesmo token retoma a corrida; sem retorno → DNF e vitória do outro | ✔ |
| 16 | Amigos (pedido/aceite/online), chat local/privado/global, filtro de palavrões, bloqueio impede chat e desafio, anti-spam do chat | ✔ |
| 17 | Equipes: criar, convidar, aceitar, expulsar | ✔ |
| 18 | Garagem: uso de carro não possuído negado, compra sem saldo negada, compra com saldo debitada corretamente, compra duplicada negada, pintura filtrada e sincronizada para outro jogador | ✔ |
| 19 | Requisições inválidas: token inválido, versão antiga, JSON inválido (conexão encerrada), mensagem desconhecida, senha fraca, nome inválido, força bruta no login bloqueada (HTTP 429) | ✔ |
| 20 | Persistência: servidor reiniciado com o mesmo banco → login e saldo preservados | ✔ |
| 21 | 20 clientes simultâneos se movendo: todos recebem snapshots, **0 falsos positivos** do anti-cheat | ✔ |
| 22 | Drift Battle: pontuação calculada pelo servidor (derrapando: > 10 000 pts; reto: 0) e vencedor correto | ✔ |
| 23 | Evento público: anunciado, inscrição de dois jogadores, corrida do servidor iniciada | ✔ |

Resultado: **14 testes, 14 aprovados, 0 falhas** (duração ≈ 122 s). Testes originais de física/IA: 6/6 aprovados.

## 2. Dois navegadores reais — `tests/browser/two-clients.cjs`

Dois contextos de navegador separados (armazenamento independente, como dois computadores) carregando o jogo completo do servidor dedicado:

```
both online
B sees A at { name: 'Ana16702', x: '-60.0', z: '240.0' }
A real position { x: '-58.8', z: '240.0' } — B sees { x: '-58.1', z: '240.0', speed: '10' }
chat delivered
A received and accepted challenge: Sprint
race running on both clients
race info { gates: 5, arch: true }
B notified that A left the race
OK
```
(A diferença de ~0,7 m é o atraso proposital de interpolação de 110 ms com o carro em movimento.) O mesmo fluxo foi verificado em capturas de tela: placas de nome, chat, painel de corrida, arco de checkpoint, menu online e mapa.

Observação: o navegador de teste usa renderização por software (SwiftShader), então o FPS e o ping mostrados nas capturas (segundos) não representam uma máquina real; por isso o aceite do desafio no teste é automático dentro da página.

## 3. Teste de carga progressivo — `tests/mp/load.mjs`

Clientes WebSocket reais, cada um registrado com conta própria, dirigindo em círculos a 15 Hz e derrapando metade do tempo. **O gerador de carga rodou na mesma máquina de 2 vCPU que o servidor**, ou seja, os números de tick incluem a disputa de CPU com os próprios clientes.

Salas padrão (`ROOM_CAPACITY=24`, matchmaking distribui):

| Clientes | Salas | Tick médio | Tick máx | Saída do servidor | Por cliente | RAM | Falsos positivos |
|---|---|---|---|---|---|---|---|
| 10 | 1 | 0,39 ms | 3,3 ms | 62 KB/s | 6,2 KB/s | 136 MB | 0 |
| 25 | 2 | 0,76 ms | 4,3 ms | 365 KB/s | 14,6 KB/s | 143 MB | 0 |
| 50 | 3 | 1,53 ms | 11,6 ms | 731 KB/s | 14,6 KB/s | 144 MB | 0 |
| 100 | 5 | 3,09 ms | 12,9 ms | 1,47 MB/s | 14,7 KB/s | 152 MB | 0 |
| 150 | 7 | 4,66 ms | 16,0 ms | 2,24 MB/s | 14,9 KB/s | 154 MB | 0 |

Pior caso — todos amontoados numa sala só, todos dentro do raio de interesse (`ROOM_CAPACITY=64`):

| Clientes | Tick médio | Tick máx | Por cliente |
|---|---|---|---|
| 24 | 0,85 ms | 4,7 ms | 15,1 KB/s |
| 48 | 2,46 ms | 13,1 ms | 30,5 KB/s |
| 64 | 3,48 ms | 14,3 ms | 40,7 KB/s |

O orçamento de um tick a 15 Hz é 66 ms; o maior tick medido foi 16 ms. O tráfego por cliente cresce com o número de vizinhos (por isso o limite padrão de 24 por sala).

**Capacidade recomendada a partir destes testes:** salas de 24 jogadores; até ~150 conexões por processo validadas neste hardware modesto. Não foi testado acima de 150 clientes nem com latência/perda de pacotes de internet real — repita `npm run load` no servidor de produção antes de aumentar `ROOM_CAPACITY`/`MAX_ROOMS`.

## 4. Mapa Drift Park e novos carros

- Superfície do Drift Park extraída do asfalto do GLB (grade de 0,4 m) e muros extraídos dos guard-rails (3 702 segmentos de colisão). Teste: carro a 100 km/h direto no guard-rail para em x=693,25 com o muro em x≈691 (antes da correção de muros finos ele atravessava — corrigido com profundidade de colisão por segmento).
- Silvia S14, 240SX (rodas esquerda/direita num único mesh, separadas automaticamente) e Hoonicorn: rodas localizadas, centradas e com eixo calculado (PCA); verificados no showroom.

## 5. Critérios de aceitação

| Critério | Situação |
|---|---|
| Dois computadores conectam ao servidor | ✔ dois clientes independentes (navegador e WebSocket); servidor escuta em 0.0.0.0 para a rede local — teste físico entre dois PCs fica com o usuário (instruções em MULTIPLAYER.md) |
| Dois jogadores no mesmo mundo | ✔ |
| Veículos sincronizados | ✔ |
| Desafio na rua | ✔ |
| Aceitar ou recusar | ✔ |
| A corrida começa | ✔ |
| Checkpoints funcionam | ✔ |
| Servidor valida o resultado | ✔ |
| Recompensas salvas | ✔ |
| Reconexão | ✔ |
| Persistência após reiniciar o servidor | ✔ |

O jogo **não** deve ser considerado pronto para produção pública sem: teste com jogadores reais pela internet, teste de carga no hardware de produção, HTTPS configurado e revisão de moderação (ver SECURITY.md e TODO.md).
