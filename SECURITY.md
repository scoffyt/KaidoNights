# Segurança e anti-cheat

## Contas e sessões
- Senhas com **scrypt** (N=16384, r=8, p=1, sal de 16 bytes, chave de 64 bytes); comparação em tempo constante. Nunca em texto puro.
- Token de sessão: 32 bytes aleatórios (base64url). O banco guarda apenas o **SHA-256** do token; expira em `SESSION_DAYS`. Logout apaga a sessão.
- Uma sessão ativa por conta: uma nova conexão com a mesma conta derruba a anterior.
- Nome de usuário: 3–16 caracteres (letras, números, `_ - .`), único sem diferenciar maiúsculas; senha 8–128.
- Nenhuma chave secreta no cliente. Segredos só em `.env` (fora do repositório — veja `.gitignore`).

## Limitação de requisições
| Recurso | Limite padrão |
|---|---|
| API REST por IP | 40 de rajada, 2/s (`API_BURST`, `API_PER_SEC`) |
| Criação de contas por IP | 5/min (`REGISTER_PER_MIN`) |
| Logins com senha errada por IP+usuário | 8 a cada 5 min (`LOGIN_FAIL_PER_5MIN`) |
| Conexões WebSocket por IP | 30/min (`CONN_PER_MIN_PER_IP`) |
| Mensagens WS por jogador | 60 de rajada, 40/s (excesso é descartado e registrado) |
| Chat | 5 de rajada, 20/min, 200 caracteres, filtro de palavrões, bloqueios respeitados |
| Desafios | 6 de rajada, 6/min; 1 pendente por par; 20 s de espera após recusa; só a até 80 m; nunca para jogador ocupado, desconectado ou bloqueado |
| Reposicionamento (R) | 3 de rajada, 1 a cada 3 s; até 400 m (80 m em corrida) |
| Payload WebSocket | 32 KB; corpo REST 16 KB; JSON inválido encerra a conexão |

## Validação no servidor (o cliente nunca decide)
- **Movimento:** cada estado é checado contra velocidade máxima (105 m/s), deslocamento possível no intervalo, teleporte (> 40 m sem autorização) e limites do mundo. Estado inválido é descartado, o cliente é corrigido (`correct`) e o evento vai para `activity_log` como suspeito. Mais de 30 violações → desconexão.
- **Corridas:** grid, largada, checkpoints em ordem (por interseção de segmento validado), tempo medido no servidor, tempo mínimo plausível por rota, queima de largada (+3 s), 3 violações durante a corrida = desclassificação. Teleportes autorizados (grid/respawn) nunca contam checkpoint.
- **Recompensas:** só o servidor credita dinheiro/XP/reputação, dentro de transação. `rewards` tem `UNIQUE(race_id, user_id)` — repetir a requisição/evento não paga duas vezes (testado). Extrato completo em `transactions`.
- **Economia:** compra de carro em transação com verificação de saldo (`CHECK (money >= 0)`), proibida compra duplicada. Ganhos do drift livre têm teto por período e são suspensos para jogadores com violações.
- **Veículos:** usar/trocar carro exige posse no banco; pintura recebida passa por lista branca (cores `#RRGGBB`, acabamentos conhecidos, altura limitada) antes de ser sincronizada.
- **Ranking:** calculado a partir das tabelas de perfil/recompensas no servidor.

## Dados pessoais
- Armazenados: nome de usuário, hash da senha, estatísticas, IP em `sessions`/`activity_log` (para segurança). Não há e-mail nem dados de pagamento.
- O perfil público não expõe dinheiro nem IP.
- Arquivos sensíveis (`server/`, `data/`, `logs/`, `.env`, `*.db`) são bloqueados pelo servidor de arquivos estáticos.

## Moderação
- Bloquear jogador: some do chat, não pode desafiar nem convidar.
- Denúncias ficam em `reports` (e em `activity_log` como suspeito) para revisão.
- Banimento: `UPDATE users SET banned = 1 WHERE username_lc = 'nome';` — a conta não consegue mais entrar.

## Produção
- Use HTTPS/WSS (proxy reverso), `NODE_ENV=production`, `ADMIN_TOKEN` para `/metrics`, `TRUST_PROXY=1` só atrás de proxy confiável.
- O que **não** é coberto: bots que dirigem dentro dos limites físicos, DDoS volumétrico (precisa de proteção na borda/provedor), 2FA e recuperação de senha por e-mail (exigem serviço de e-mail externo).
