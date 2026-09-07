# Acesso remoto ao painel

Como **https://focus.chicofigueiredo.com.br** existe, e como refazer isso do zero.

O painel continua rodando só na máquina de casa. Nada do acervo é copiado para
servidor nenhum: o vídeo sai do disco daqui no instante em que você aperta play
no tablet. O que existe lá fora é um cano com senha na ponta.

```
tablet ──HTTPS──▶ nginx na VPS ──▶ 127.0.0.1:17788 (ponta do túnel)
                  (TLS + senha)              ▲
                                             │ túnel SSH reverso
                        casa ── ssh -R ──────┘   (focus-tunel.service)
                         │
                         └─ painel em 127.0.0.1:17788 ── acervo em /mnt/e
```

Quem disca é o PC de casa, saindo pela porta 22. Não há porta aberta no
roteador, não há IP fixo para manter, e por isso funciona atrás do NAT da
operadora.

## A porta é fixa, e isso importa

**Não basta dar `bun run panel` em qualquer porta.** O túnel é um par de portas
decidido de antemão: `ssh -R 17788:127.0.0.1:17788`. O nginx da VPS faz
proxy para a `17788` **daquela ponta**, e a ponta despeja na `17788` **desta**.
Painel em qualquer outra porta = o túnel entrega numa porta vazia = **502 no
tablet**.

Por isso a porta está fixada no `.env`:

```bash
FOCUS_PANEL_PORT=17788
```

Com isso, `bun run panel` — sem flag nenhuma — já abre na porta certa e o acesso
de fora funciona. Foi para isso que o `.env` mudou; antes o padrão era 7788 e
`bun run panel` puro não aparecia no tablet.

**A pegadinha que sobra:** quando a `17788` está ocupada, o painel *não* falha —
ele pula para a `17789` e avisa só no terminal (`porta 17788 em uso — tentando
17789…`). Local funciona, remoto vira 502. Quase sempre é um painel antigo ainda
rodando. Para ver quem está lá:

```bash
ss -lntp 'sport = :17788'
```

O `./verificar.sh` detecta esse caso e diz em qual porta o painel foi parar.

Mudar a porta: troque nos **dois** lugares (`.env` e `config.sh`) e rode
`./3-vps-nginx.sh` e `./4-servico-local.sh` de novo.

## Refazer do zero

Pré-requisitos — na VPS: nginx, certbot com plugin nginx, `apache2-utils`,
OpenSSH 7.9+. No DNS: o nome já resolvendo para o IP da VPS (o passo 3
confere e recusa seguir se não estiver). Aqui: systemd de usuário.

Ajuste `config.sh` e rode na ordem:

```bash
cd infra/remote
./1-chave-local.sh      # par de chaves exclusivo do túnel
./2-vps-usuario.sh      # usuário 'tunel' na VPS, sem shell, chave trancada
./3-vps-nginx.sh        # site, senha, certificado — imprime a senha no fim
./4-servico-local.sh    # túnel e painel como serviços do systemd
./verificar.sh          # confere a corrente inteira
```

Todos são idempotentes: rodar de novo não estraga o que já existe. O passo 3
imprime a senha uma única vez — depois dela só resta o bcrypt na VPS.

| Arquivo | O quê |
|---|---|
| `config.sh` | domínio, servidor, porta, usuário — a única coisa a editar |
| `1-chave-local.sh` | gera `~/.ssh/focus_tunel` |
| `2-vps-usuario.sh` | cria o usuário `tunel` com a chave restrita |
| `3-vps-nginx.sh` | site do nginx, `htpasswd`, certbot |
| `4-servico-local.sh` | escreve e liga o `focus-tunel` e o `focus-painel` |
| `verificar.sh` | diagnóstico elo por elo |
| `focus-nginx.conf` | cópia do que está na VPS, para leitura |

## As três decisões que valem explicar

**Por que não Caddy nem Docker.** A VPS já tinha nginx + certbot nas portas
80/443 servindo vários sites. Caddy só poderia entrar *atrás* do nginx, fazendo o
que o nginx já faz. Os scripts são aditivos: criam um arquivo novo em
`sites-available`, passam por `nginx -t` e recarregam. Não leem nem editam
configuração de outro site.

**Por que um usuário sem shell.** A chave do túnel fica guardada num serviço que
reconecta sozinho a noite toda. Ela é um par novo (não a sua chave de root) e no
`authorized_keys` vai com `restrict,port-forwarding,permitlisten="17788"`: sem
shell, sem agente, sem X11, sem TTY, e sem poder escutar em outra porta. De
posse dela, o que se alcança é um painel que ainda pede senha.

**Por que só leitura de fora.** O painel dispara scrape, transcrição e abre
arquivo no Explorer. Nada disso faz sentido a partir do tablet, e tudo isso é
poder sobre a máquina de casa. Estas respondem 403 no nginx:

```
/api/run  /api/requeue  /api/revelar  /api/abrir  /api/sincronizar
```

Assistir, ler transcrição, marcar aula como vista e anotar continuam
funcionando: tudo isso passa por `POST /api/sync`, que é escrita de progresso,
anotação e preferência — nada que rode processo nesta máquina. Se a senha
vazar, o estrago é alguém ver o acervo, não rodar processo aqui dentro.

Ao mexer na lista de bloqueio, lembre que `/api/sync` **tem de continuar
liberada**: é por ela que o tablet grava o que você marcou e anotou. Bloqueá-la
não deixa o painel "só leitura" — deixa ele quebrado, com a fila de escrita
enchendo para sempre e o aviso `⇅ N por enviar` preso no cabeçalho.

## Diagnóstico

```bash
./verificar.sh                  # elo por elo, com a dica de conserto em cada um
SENHA='...' ./verificar.sh      # inclui as conferências autenticadas

systemctl --user status focus-tunel
journalctl --user -u focus-tunel -n 50
systemctl --user restart focus-tunel
```

| Sintoma | Quase sempre é |
|---|---|
| **502** | túnel de pé, painel não. PC suspenso, painel parado, ou painel que pulou de porta |
| **401 que não passa** | senha errada — `htpasswd -B /etc/nginx/focus.htpasswd chico` troca |
| **503 / conexão recusada** | nginx fora do ar na VPS |
| **tudo lento** | é o upload da sua internet: o vídeo sai do disco de casa em tempo real |

**PC desligado ou suspenso = 502.** Não tem contorno: o acervo está aqui. O que
o passo 4 garante é que, com o PC ligado, o painel já está de pé sem ninguém
abrir terminal: ele instala `focus-painel.service` junto com o túnel.

Só que serviço de usuário sem **linger** espera alguém abrir sessão. Para eles
subirem no boot:

```bash
sudo loginctl enable-linger $USER
```

## Trocar a senha

```bash
ssh root@ssh.chico-figueiredo.com.br htpasswd -B /etc/nginx/focus.htpasswd chico
```

Não precisa recarregar o nginx: o arquivo é lido a cada requisição.

## Certificado

O certbot deixou a renovação agendada na própria VPS. Conferir:

```bash
ssh root@ssh.chico-figueiredo.com.br 'certbot certificates | grep -A2 focus'
```
