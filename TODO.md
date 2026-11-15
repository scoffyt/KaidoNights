# TODO — melhorias futuras

## Multiplayer (próximos passos)
- [ ] Teste com jogadores reais pela internet (latência/perda de pacotes) e teste de carga no hardware de produção.
- [ ] Colisão física entre jogadores (exige simulação/arbitragem no servidor ou colisão cliente com reconciliação).
- [ ] Voz por proximidade (WebRTC + servidor TURN; o servidor já sabe quem está perto).
- [ ] Recuperação de senha e 2FA (precisa de serviço de e-mail externo).
- [ ] Painel de moderação (denúncias, banimentos) em vez de SQL manual.
- [ ] PostgreSQL para contas compartilhadas entre várias regiões/processos.
- [ ] Mais rotas de corrida no Drift Park (exige linha central do mapa) e eventos com rotas variadas.
- [ ] Mais áreas de mundo aberto: avenidas, rodovia, área industrial (hoje: circuito, paddock/encontro, estrada e Drift Park).
- [ ] Mapa-múndi e radar mostrando o Drift Park também no minimapa da HUD.
- [ ] Protocolo binário (hoje JSON) se o tráfego por jogador precisar cair abaixo de ~15 KB/s.
- [ ] Customização de pintura direto no mundo online (hoje usa a pintura da garagem local, sincronizada ao entrar/trocar de carro).

## Alta prioridade
- [ ] Ajuste fino da física com volante/controle real (curva do pneu, transferência de carga, embreagem).
- [ ] IA de drift com física pura (hoje o líder do tandem usa linha de corrida + pose de drift roteirizada para ser confiável).
- [ ] LOD real para carros distantes (simplificação de malha do R34 para IA/estacionados).
- [ ] Pré-compilar shaders dos carros da IA antes da largada (evitar pequena travada no primeiro quadro).

## Conteúdo
- [x] Segundo mapa (Drift Park, importado de GLB e ligado ao paddock por uma estrada).
- [ ] Touge de montanha com elevação e layout reverso do circuito.
- [ ] Mais carros (o sistema de importação aceita qualquer GLB com rodas nomeadas "Wheel Front/Rear L/R").
- [ ] Modo carreira com campeonato de drift e eventos semanais.
- [ ] Replays completos com câmeras de TV.
- [ ] Clima (chuva com asfalto molhado e spray).

## Técnico
- [ ] Física com elevação/relevo (hoje o chão é plano; suspensão é visual).
- [ ] Rapier/ammo para colisões 3D completas com objetos do cenário.
- [ ] Reconstruir o cenário ao trocar a qualidade (quantidade de árvores é definida na carga).
- [ ] WebGPU renderer quando estável no Three.js.
- [ ] Remapeamento de teclas e suporte a volantes (force feedback via Gamepad Haptics).
- [ ] Áudio com samples reais opcionais (o motor atual é 100% sintetizado).
- [ ] Multiplayer local em tela dividida.
