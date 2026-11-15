# Multiplayer — como jogar, como testar com dois computadores

## 1. Subir o servidor

Windows: dois cliques em **`INICIAR_SERVIDOR_ONLINE.bat`** (precisa do Node.js 22.13+).
Linux/macOS/WSL: `node --no-warnings server/index.js` (ou `npm start`).
Docker: `docker compose up -d` (ver `DEPLOY.md`).

O servidor serve o próprio jogo em `http://<máquina>:8090` e o tempo real em `ws://<máquina>:8090/ws`.
Verificação: `http://localhost:8090/health` deve responder `{"ok":true,...}`.

## 2. Testar uma corrida real com dois clientes

1. **PC 1 (servidor):** rode o `.bat`. Anote o IP local (`ipconfig` → "Endereço IPv4", ex.: 192.168.0.10). Quando o Windows perguntar, permita o Node.js na rede privada.
2. **PC 1 e PC 2:** abra `http://192.168.0.10:8090` no Chrome/Edge (no próprio servidor também serve `http://localhost:8090`).
   *Para testar num único PC, use duas janelas, uma delas anônima (contas diferentes precisam de armazenamento separado).*
3. Em cada um: aba **Online** → **Mundo Online** → **Criar conta** (nomes diferentes) → **Entrar no mundo**.
4. Os dois nascem no estacionamento do paddock (área "KAIDO MEET"). Dirija até o outro carro — o nome dele aparece sobre o carro com a distância.
5. A menos de 80 m aparece **"G Desafiar NOME"**. Pressione **G**, escolha **1 (Sprint)**.
6. No outro PC aparece o cartão **DESAFIO RECEBIDO** com som: **Y** aceita, **N** recusa (15 s para responder).
7. Ao aceitar, os dois são levados ao grid na Estrada do Parque; contagem regressiva do servidor; **VAI!**
8. Passe pelos portais (arco azul; o próximo é marcado por um feixe de luz; o último tem a bandeira quadriculada). A HUD mostra checkpoint e tempo.
9. Na chegada, ambos recebem o resultado validado pelo servidor e a recompensa (créditos/XP/reputação) é gravada no banco.
10. Feche e reabra o navegador, ou reinicie o servidor: login → o dinheiro, vitórias e carros continuam lá.

Teste de desconexão: durante uma corrida, feche a aba de um jogador e reabra em até 25 s — ele volta à mesma corrida. Se não voltar, ele recebe DNF e o outro vence ao cruzar a chegada.

## 3. O que existe no mundo online

| Sistema | Como usar |
|---|---|
| Jogadores próximos, placas de nome com distância e nível | automático |
| Buzina / piscar farol (sincronizados para quem está perto) | **H** / **J** |
| Chat local (200 m), global (`/g`), equipe (`/e`), privado (`/w nome`) | **Enter** |
| Desafios: Sprint, Circuito (2 voltas), Time Attack, Drift Battle, Tandem, Melhor de três | **G** + 1–6 |
| Eventos públicos (anunciados a todos na sala, inscrição de 60 s) | ESC → Participar |
| Mapa com jogadores, amigos (rosa), equipe (verde), pontos de interesse | **M** |
| Lista de jogadores → perfil público → adicionar/remover amigo, convidar para corrida, convidar para equipe, mensagem, bloquear, denunciar | **Tab** |
| Amigos (pedido/aceitar/recusar), jogadores recentes, equipes (criar, convidar, sair, expulsar) | ESC → Amigos e equipe |
| Garagem online: carros possuídos, compra com créditos, troca do carro ativo (sincronizado para os outros) | Lobby → Garagem / ESC → Garagem |
| Ganhos no drift livre (calculados pelo servidor, pagos a cada 20 s) | dirija de lado |
| Ranking global e semanal, perfil, histórico de corridas, extrato | Lobby / ESC |
| Encontros: estacionamento "KAIDO MEET" no paddock, Pátio do Drift Park | mapa |

Regiões do mundo: **Hakone Bay** (circuito, paddock, donut zone, encontro), **Estrada do Parque** (reta de 570 m — rota do Sprint), **Drift Park** (pista técnica com guard-rails).

## 4. Protocolo (resumo)

Cliente → servidor: `hello{v,token,room}`, `st{x,z,h,vx,vz,s,r,g,f}` (15 Hz), `respawn`, `horn`, `flash`, `chat{ch,to,msg}`, `challenge{to,kind}`, `challenge_reply{id,accept}`, `race_leave`, `event_join`, `car`, `profile`, `friends`, `friend{op,id}`, `block`, `report`, `crew{op}`, `ping`, `leave_world`.

Servidor → cliente: `welcome`, `snap{ts,p:[[id,x,z,h,vx,vz,steer,rpm,gear,flags]]}` (15 Hz, só vizinhos), `far` (1 Hz), `join`/`leave`/`presence`/`look`, `fx`, `chat`, `challenged`, `challenge_result`, `race{phase: setup|countdown|go|cp|finished|dq|left|round|resume|result}`, `wallet`, `correct`, `event`, `friends`, `profile`, `notify`, `kicked`, `fatal`.

REST: `POST /api/register`, `POST /api/login`, `POST /api/logout`, `GET /api/me`, `GET /api/servers`, `GET /api/info`, `GET /api/leaderboard?period=all|week`, `GET /api/profile/:id`, `POST /api/buy`, `POST /api/garage`, `GET /api/history`, `GET /health`, `GET /metrics`.

## 5. Testes automatizados

```
npm run test:mp        # 14 testes ponta a ponta: servidor real + clientes WebSocket independentes
npm run test:physics   # testes da física/IA originais
npm run load           # teste de carga progressivo contra um servidor rodando
node tests/browser/two-clients.cjs http://localhost:8090   # dois navegadores reais (Playwright + Chrome)
```

Os "bots" dos testes são clientes de rede reais que só existem dentro dos testes; o jogo nunca mostra jogadores falsos.

## 6. Limitações conhecidas (honestas)

- Carros remotos são visuais (sem colisão física entre jogadores) para evitar que lag vire batida injusta; colisão entre jogadores exigiria física no servidor.
- Validação anti-cheat é por plausibilidade (velocidade, aceleração, teleporte, tempo mínimo, ordem dos checkpoints). Não detecta um bot que dirija dentro dos limites físicos.
- Voz por proximidade: não implementada (exigiria WebRTC + servidor TURN); o protocolo já entrega a lista de vizinhos para isso.
- A capacidade validada está no relatório de testes; números maiores exigem novos testes de carga no hardware de produção.
