# Arquitetura — Kaido Nights Online

## Visão geral

```
 Navegador (cliente)                                   Servidor dedicado (Node.js ≥ 22.13, sem dependências)
 ┌──────────────────────────────┐   HTTPS/HTTP REST    ┌───────────────────────────────────────────────┐
 │ Three.js + física local      │ ───────────────────▶ │ server/index.js  HTTP: arquivos do jogo + /api │
 │ src/net/net.js  (REST + WS)  │                      │   auth.js  scrypt, tokens, rate limit          │
 │ src/net/online.js (modo)     │   WebSocket /ws      │ server/ws.js     WebSocket RFC 6455 próprio    │
 │ src/net/remote.js (carros    │ ◀──────────────────▶ │ server/hub.js    conexões, salas, social       │
 │   remotos interpolados)      │   JSON, 15 Hz        │ server/room.js   mundo, interesse, desafios    │
 │ src/ui/onlineUi.js (telas)   │                      │ server/race.js   corridas autoritativas        │
 │ src/net/shared.js ◀──────────┼── mesmo arquivo ────▶│ src/net/shared.js rotas, preços, limites       │
 └──────────────────────────────┘                      │ server/db.js     SQLite (node:sqlite, WAL)     │
                                                        └───────────────────────────────────────────────┘
```

**Por que assim:** o jogo já era 100% navegador (ES modules, sem build). O servidor usa só módulos nativos do Node (`http`, `crypto`, `node:sqlite`), então roda em qualquer PC Windows/Linux sem `npm install` e cabe num container pequeno. O protocolo é JSON sobre WebSocket — simples de depurar e suficiente para os volumes medidos (ver relatório de testes).

## Autoridade

| Decisão | Quem decide |
|---|---|
| Física do próprio carro (sensação de direção sem atraso) | Cliente |
| Aceitar/rejeitar cada posição (velocidade, aceleração, teleporte, limites do mundo) | **Servidor** |
| Grid, contagem regressiva, horário da largada | **Servidor** |
| Checkpoints (cruzamento do segmento entre duas posições validadas com o portal) | **Servidor** |
| Tempo de corrida (interpolado no instante do cruzamento) | **Servidor** |
| Pontuação de drift em batalhas/tandem (calculada do fluxo de estados) | **Servidor** |
| Colocação, vencedor, dinheiro, XP, reputação, ranking | **Servidor** (transação SQLite, idempotente) |
| Propriedade de carros, compra, carro ativo, pintura sincronizada | **Servidor** |
| Ganhos do drift livre | **Servidor** (pontos calculados do fluxo de estados, com teto) |

O cliente nunca envia "pontos", "tempo" ou "dinheiro": só estado do carro (posição, rumo, velocidade, esterço, rpm, marcha, flags).

## Mundo e salas

- Uma **sala** (`Room`) é uma instância do mundo inteiro (Hakone Bay + Estrada do Parque + Drift Park), com capacidade configurável (`ROOM_CAPACITY`, padrão 24).
- **Matchmaking:** entra na sala pública mais cheia que ainda tem vaga (mantém o mundo movimentado); se todas estiverem cheias cria outra, até `MAX_ROOMS`. Salas privadas por código já são suportadas pelo hub (`matchmake(code)`), a UI aceita o código no lobby.
- **Regiões geográficas:** `REGION` identifica o servidor (ex.: `sa-east`). Para várias regiões, sobe-se um servidor por região e a lista de servidores do cliente aponta para cada um (ver `DEPLOY.md`).
- **Interest management:** grade espacial de 150 m; cada jogador recebe snapshots completos a 15 Hz só dos jogadores a até 450 m, e uma lista de posições a 1 Hz dos demais (mapa/radar). Membros da mesma equipe vêm marcados.
- **Interpolação:** o cliente renderiza os carros remotos 110 ms no passado, com interpolação Hermite (usa a velocidade, não corta curvas) e extrapolação curta (até 350 ms) quando pacotes atrasam. O carro local nunca espera a rede.
- **Correção/reconciliação:** se o servidor rejeita um estado, responde `correct` com a última posição válida e o cliente reposiciona o carro.
- **Reconexão:** ao cair, o jogador fica na sala como "reconectando" por `RECONNECT_GRACE_SEC` (25 s). Reconectar com o mesmo token retoma a sessão, inclusive a corrida em andamento (`race: resume`). Passado o prazo, ele sai (e numa corrida vira DNF).

## Corridas

`Race` (server/race.js) é criada por um desafio aceito ou por um evento público:

1. `setup` — servidor escolhe a rota (`ROUTES` em shared.js), envia slot de largada (teleporte autorizado) e portais.
2. `countdown` → `go` — o horário de largada é do servidor; sair do grid antes do "go" gera +3 s.
3. Cada estado validado é testado contra o próximo portal (interseção segmento × círculo). Teleportes nunca contam portais.
4. Chegada: tempo menor que o mínimo plausível da rota → desclassificação. 3 violações de movimento → desclassificação.
5. Resultado: classificação, `race_results`, recompensas (`rewards` com `UNIQUE(race_id,user_id)` → impossível receber duas vezes), estatísticas.

Modalidades: Sprint (paddock → Drift Park), Circuito (2 voltas), Time Attack (1 volta), Drift Battle (pontuação do servidor), Tandem (perseguidor ganha bônus de proximidade), Melhor de três (3 sprints) e Eventos públicos (anunciados a cada `EVENT_EVERY_MIN`, inscrição de `EVENT_JOIN_SEC`).

## Banco de dados

SQLite em modo WAL via `node:sqlite` (arquivo único, transações ACID, backups online). Tabelas: `users`, `sessions`, `profiles`, `vehicles`, `friends`, `blocks`, `crews`, `crew_members`, `races`, `race_results`, `rewards`, `transactions`, `achievements`, `reports`, `activity_log`, `recent_players`, `schema_version`. Migrações versionadas em `server/db.js`, chaves estrangeiras com `ON DELETE`, índices nas consultas quentes, `CHECK (money >= 0)`.

Escala: SQLite atende bem um servidor dedicado (escritas são raras — corridas, compras, pagamentos a cada 20 s). Para vários servidores compartilhando contas, a camada `DB` é o único ponto a trocar por PostgreSQL (consultas SQL padrão, transações explícitas).

## Arquivos

| Caminho | Papel |
|---|---|
| `server/index.js` | HTTP (estático + REST), upgrade WebSocket, keepalive, backups, desligamento gracioso |
| `server/hub.js` | jogadores, sessões, reconexão, matchmaking, amigos, bloqueios, denúncias, equipes, perfis |
| `server/room.js` | validação de estados, interesse espacial, desafios, eventos, chat, buzina/farol, ganhos de drift |
| `server/race.js` | corrida autoritativa |
| `server/db.js` | esquema, migrações, todas as operações de dados |
| `server/auth.js` | scrypt, tokens, rate limiter |
| `server/ws.js` | WebSocket |
| `server/config.js`, `server/log.js` | variáveis de ambiente, logs JSON |
| `src/net/shared.js` | dados compartilhados cliente/servidor |
| `src/net/net.js`, `online.js`, `remote.js`, `src/ui/onlineUi.js` | cliente |
| `src/world/driftPark.js` | mapa Drift Park (superfície e muros extraídos do próprio GLB) |
| `tests/mp/` | testes multiplayer e teste de carga · `tests/browser/two-clients.cjs` teste com dois navegadores |
