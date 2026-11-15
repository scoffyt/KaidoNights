# Deploy — servidor dedicado

> Nada aqui foi publicado na internet. Estas instruções preparam o deploy; contratar servidor/domínio é decisão do dono do projeto.

## Requisitos

- Node.js **22.13+** (usa `node:sqlite` nativo) — ou Docker.
- 1 vCPU / 512 MB RAM atende os volumes medidos no relatório de testes (150 conexões simuladas: tick médio 4,7 ms, ~154 MB de RAM).
- Porta TCP 8090 (ou outra via `PORT`). Em produção, coloque atrás de um proxy HTTPS (Caddy/Nginx) para ter `wss://`.

## Opção A — direto no Windows/Linux

```
cp .env.example .env        # ajuste NODE_ENV=production, SERVER_NAME, REGION, ADMIN_TOKEN…
node --no-warnings server/index.js
```
Serviço no Linux (systemd):
```
[Unit]
Description=Kaido Nights server
After=network.target
[Service]
WorkingDirectory=/opt/kaido
EnvironmentFile=/opt/kaido/.env
ExecStart=/usr/bin/node --no-warnings server/index.js
Restart=always
User=kaido
[Install]
WantedBy=multi-user.target
```

## Opção B — Docker

```
cp .env.example .env
docker compose up -d --build
docker compose logs -f
curl http://localhost:8090/health
```
Os dados ficam no volume `kaido-data` (`/data/kaido.db`, backups em `/data/backups`, logs em `/data/logs`). O container roda como usuário sem privilégios e tem HEALTHCHECK.

## HTTPS (exemplo com Caddy)

```
jogo.seudominio.com {
    reverse_proxy 127.0.0.1:8090
}
```
Com proxy, defina `TRUST_PROXY=1` (para o rate limit usar o IP real) e `PUBLIC_URL=https://jogo.seudominio.com`. O cliente usa automaticamente `wss://` quando a página é servida por HTTPS.

## Configuração de produção recomendada

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `ADMIN_TOKEN` | segredo aleatório (protege `/metrics`) |
| `TRUST_PROXY` | `1` somente atrás de proxy confiável |
| `CORS_ORIGIN` | vazio (mesma origem) ou o domínio do site do jogo |
| `BACKUP_EVERY_MIN` / `BACKUP_KEEP` | 60 / 48, e copie `data/backups` para fora da máquina |
| `ROOM_CAPACITY` / `MAX_ROOMS` | conforme novo teste de carga no hardware real |

## Monitoramento

- `GET /health` — liveness/readiness (inclui consulta ao banco).
- `GET /metrics` — jogadores online, salas, corridas, tick médio/máximo do servidor, memória, bytes enviados (`?reset=1` zera as janelas de tick). Em produção exige `Authorization: Bearer $ADMIN_TOKEN`.
- Logs JSON estruturados em stdout e `logs/server-AAAA-MM-DD.log` (prontos para Loki/ELK/CloudWatch).
- Atividades suspeitas: tabela `activity_log` com `suspicious = 1` (`SELECT * FROM activity_log WHERE suspicious=1 ORDER BY id DESC LIMIT 100`).

## Backup e recuperação

- Automático: a cada `BACKUP_EVERY_MIN` e ao desligar (SIGINT/SIGTERM), em `BACKUP_DIR`, mantendo `BACKUP_KEEP` arquivos.
- Manual (com o servidor rodando): `npm run backup`.
- Restaurar: **pare o servidor**, depois `node server/tools/restore.js data/backups/kaido-XXXX.db`. O script verifica a integridade (`PRAGMA integrity_check`), guarda o banco atual como `.before-restore-…` e restaura. Inicie o servidor de novo.

## Atualização (procedimento)

1. `npm run backup` (ou deixe o backup automático do desligamento).
2. Pare o servidor (SIGTERM/fechar a janela) — jogadores recebem "Servidor reiniciando".
3. Substitua os arquivos (ou `docker compose build`).
4. Inicie. As migrações de banco pendentes rodam sozinhas na inicialização (`schema_version`).
5. Confira `/health` e os logs. Se algo falhar: pare, restaure o backup e volte à versão anterior.
6. Mudou o protocolo? Incremente `PROTOCOL_VERSION` em `src/net/shared.js` — clientes antigos recebem "recarregue a página".

## Várias regiões / crescimento

- Um processo por região (`REGION=sa-east`, `REGION=us-east`…). Cada um é independente.
- Para contas compartilhadas entre regiões: trocar a implementação de `server/db.js` para PostgreSQL (mesmo SQL, transações explícitas) e apontar todos para o mesmo banco.
- Para mais de um processo na mesma região: as salas são independentes; um balanceador com afinidade por sala (ou uma lista de servidores no cliente) distribui os jogadores. Não é necessário mudar o protocolo.
