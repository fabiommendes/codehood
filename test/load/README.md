# Teste de carga da prova

Reproduz uma prova com N alunos simultâneos e `chalk-worker`s corrigindo a
fila, contra um build de produção do servidor, e mede latência, erros, atraso
do event loop, memória, CPU e disco. Issue de origem:
`dev/issues/teste-de-carga-da-prova.md`.

```sh
pnpm run load --students 100 --duration 10m --scenario all
```

Precisa de `uv`, `elm`, `elm-test` e `node` para o worker (ver
`workers/chalk-worker/README.md`). Tudo o que a rodada produz fica em `.load/`
(ignorado pelo git): o build em `.load/dist`, o cache dos workers em
`.load/worker-cache/<n>` e cada rodada em `.load/reports/<data>/`.

## O que acontece

Para cada cenário:

1. Banco novo (`prisma db push`) e seed (`seed.ts`). O seed cria um curso
   `loadtest/loadteacher_<edição>`, um `QUIZ` aberto (`load-quiz`) com 6
   questões Elm `code` e 2 dissertativas, os alunos `load001…` (senha
   `load-password`) e a chave `BOT` `load-bot-key`. As questões estão em
   `questions.ts`, com 4 respostas cada: correta, falha num pré-teste, falha num
   teste escondido e não compila.
2. Sobe o servidor (`node .load/dist/server/entry.mjs`) com o `probe.mjs`
   pré-carregado: a cada segundo ele grava memória, CPU e atraso do event loop
   do processo, sem mudar o código do servidor. Ele também liga o profiler de
   CPU do V8 (amostra a cada 1 ms) e grava um `.cpuprofile` por minuto em
   `profile/`. O `probe-db.mjs` envolve o adapter do SQLite e grava em
   `tx.jsonl` quanto cada transação esperou pelo mutex do adapter e quanto
   tempo o segurou, em `sql.jsonl` o tempo do better-sqlite3 por SQL e por
   método do servidor que a chamou, e em `route.jsonl` a CPU e o tempo de cada
   rota, a cada segundo.
3. Sobe os workers (`chalk-worker --exam load-quiz`) e os alunos sintéticos.
4. Quando os alunos terminam, para os workers e deixa o servidor parado por
   `--cooldown` para ver se a memória volta.

## Cenários

| Cenário        | O que isola                                                                 |
| :------------- | :-------------------------------------------------------------------------- |
| `baseline`     | Referência sem carga: 3 alunos no ritmo de uma prova, 1 worker, 3 min        |
| `monitor`      | Monitoramento: todos digitando (autosave e histórico), sem envios nem worker |
| `queue-Nw`     | Fila: todos enviam todas as questões de código de uma vez e consultam a nota |
| `combined-Nw`  | O ritmo de uma prova, com N workers                                          |
| `…-cpuQ`       | O mesmo com cada worker limitado a `CPUQuota=Q%` (`--worker-cpu`)            |
| `…+wal`        | O mesmo com o banco em WAL (`--wal on` ou `--wal both`)                     |

## Opções

| Opção               | Padrão | O que faz                                                         |
| :------------------ | :----- | :---------------------------------------------------------------- |
| `--students`        | 100    | Alunos sintéticos                                                 |
| `--duration`        | 10m    | Duração da prova; quem não terminou entrega no fim                |
| `--ramp`            | 2m     | Janela de chegada dos alunos                                      |
| `--history`         | 0      | Autosaves de uma prova antiga já no banco, como em produção       |
| `--scenario`        | all    | `baseline`, `monitor`, `queue`, `combined` ou uma lista           |
| `--grading-workers` | 1,4    | Workers dos cenários `queue` e `combined`; uma lista roda cada um |
| `--worker-cpu`      | none   | `CPUQuota` de cada worker; uma lista (`none,100%`) roda cada uma  |
| `--worker-poll`     | 10     | Segundos entre dois `claim` com a fila vazia                      |
| `--wal`             | off    | `off`, `on` ou `both`                                             |
| `--memory`, `--cpu` | —      | Limites do servidor, como `--memory 1G --cpu 100%` (ver abaixo)   |
| `--seed`            | 1      | Semente dos sorteios; a mesma semente repete a mesma turma        |
| `--skip-build`      | —      | Reaproveita o build de `.load/dist`                               |
| `--resume <dir>`    | —      | Continua uma rodada interrompida: pula os cenários já gravados    |
| `--no-profile`      | —      | Desliga o profiler de CPU do servidor (para medir o custo dele)   |
| `--environment`     | prod   | `ENVIRONMENT` do servidor                                         |

## O aluno sintético

Cada aluno sorteia um perfil (`PROFILES` em `student.ts`): `careful`,
`paster` (cola a resposta e edita um pouco), `fast`, `stuck` (pausas longas,
pula questões) e `quitter` (desiste e às vezes nem entrega). O perfil decide
o tempo de leitura e de raciocínio, a velocidade de digitação, as pausas, a
chance de colar, pular, desistir e enviar, e quantas respostas erradas tenta
antes da última. A chegada se espalha por `--ramp` e a ordem das questões é a
da prova com ruído gaussiano, então a maioria segue a ordem e alguns pulam à
frente.

`solveQuestion` não conhece o tipo da questão, só as respostas candidatas
(`answers[0]` é a certa) e se ela vai para um worker. A digitação vai em
rajadas. Uma resposta pode marcar trechos `<remove>…</remove>`: o aluno digita
esses trechos e depois volta para apagá-los, no meio do texto. Além deles, o
perfil sorteia alguns deslizes (texto digitado adiantado ou uma palavra
repetida) que também são apagados depois. O texto final é sempre a resposta
sem os trechos.

### Fidelidade ao cliente

A página da prova é simulada por `page.ts` com o código do próprio cliente: o
transporte (`createActionTransport`), o coordenador e o adaptador do histórico
de edição, `sendsOf`/`hasPendingSend` dos envios e `retryDelay` dos saves.
Só o IndexedDB vira memória e `astro:actions` vira HTTP (`http.ts`). O
histórico segue as questões que o servidor aceita (`isHistoryField`).

Os tempos da página (`SAVE_DELAY_MS`, `SENDS_POLL_MS`, `FLUSH_CEILING_MS`…)
são lidos do código-fonte de `ExamAttempt.tsx` e `answer-edit-session.ts`
(`rhythm.ts`). `test/load-rhythm.spec.ts` falha se uma dessas constantes
deixar de ser um número, e se a página passar a chamar uma action que o aluno
sintético não chama.

O que o aluno sintético não faz: baixar os assets estáticos e o runner do
navegador (que roda os pré-testes no cliente, sem tocar o servidor).

## Máquina local × VPS

O servidor roda num event loop só, então o que conta é a velocidade por
núcleo, a memória e o disco. Para aproximar a VPS:

```sh
pnpm run load --memory 2G --cpu 100%
```

limita só o servidor (via `systemd-run --user --scope`, com `MemorySwapMax=0`).
O gerador de carga e os workers ficam de fora. Os workers rodam `elm` e
`elm-test` na mesma máquina e disputam CPU com o servidor; para separar esse
efeito, compare `--grading-workers 0,1 --worker-cpu none,100%`.

O relatório começa com o tempo de um `write` + `fsync` de 4 KiB no diretório do banco; meça o mesmo na VPS
(por exemplo rodando a carga lá, ou `fio --rw=write --bs=4k --fsync=1`) para
comparar. Se o gargalo for o disco, só a VPS confirma.

Rode com a máquina parada: uma suíte de testes rodando junto muda os números
(o relatório mostra a pressão de I/O e a memória da máquina para conferir).

Uma rodada interrompida (Ctrl-C, máquina suspensa) perde só o cenário em
andamento: cada cenário grava `result.json` ao terminar. Retome com as mesmas
opções e `--resume .load/reports/<data>`. Não suspenda a máquina no meio de
um cenário: os alunos seguem o relógio, e o cenário sai distorcido.

## Como ler o relatório

`report.md` (também impresso no fim), `report.html` (gráficos) e
`report.json` (todas as amostras). Cada cenário tem também `server.log`,
`worker-<n>.log`, `probe.jsonl` e o `load.db` final.

- **Tabela de cenários:** compare a mesma coluna entre cenários. Se `monitor`
  já degrada (p95, falhas, atraso do event loop), o suspeito 1 basta; se só
  `queue` degrada, é a fila; se só `combined`, é a soma. `+wal` mostra o ganho
  do WAL.
- **Gerador de carga:** `generator lag max` é o pior atraso do event loop do
  próprio gerador (todos os alunos rodam num processo só). Se passar de
  ~100 ms, as latências medidas no cliente incluem essa espera e não são só do
  servidor; compare com `wall/req` da tabela por rota, medido no servidor.
- **Por action:** `failures` conta 5xx, timeouts (60 s) e conexões recusadas;
  `codes` lista também as recusas de regra (`CONFLICT`, `FORBIDDEN`…), que não
  são falhas do servidor.
- **Atraso do event loop:** p99 por segundo. Centenas de ms significam que o
  processo ficou bloqueado (SQLite síncrono, JSON grande, argon2).
- **Memória:** `rss` que cresce e não volta no `cooldown` indica vazamento;
  swap em uso indica que a memória é o limite.
- **I/O pressure:** `some avg10` de `/proc/pressure/io` da máquina toda. Alta
  com o servidor limitado ao disco aponta o `fsync` do SQLite.
- **Transactions:** o `@prisma/adapter-better-sqlite3` roda uma transação
  por vez (um mutex), e toda operação dos services abre uma (`inTx` em
  `src/db/define-service.ts`). `wait` é a fila por esse mutex, `hold` é
  quanto cada transação o segurou (inclui os `await` no meio dela) e "mutex
  held" é a fração do tempo em que ele esteve ocupado. Perto de 100%, as
  requisições que escrevem fazem fila, mesmo com a CPU sobrando.
- **Server time by route, method and SQL:** onde o servidor gastou o tempo,
  no cenário inteiro e nos 30 s em que ele mais rodou JavaScript.
  - Por rota (`action <nome>` ou a página): requisições, CPU gasta por elas
    (cada fatia do event loop no contexto assíncrono da requisição, via
    `async_hooks`), quanto disso foi SQLite e o tempo médio do lado do
    servidor. `wall/req` muito maior que `cpu/req` é espera (fila, I/O).
  - Por método: os métodos do servidor na pilha assíncrona de cada query,
    do mais interno para fora (`op finish` é a operação `finish` de um
    service), com o número de queries e o tempo no SQLite.
  - Por SQL: `prepare` é compilar a SQL (o adapter não guarda os
    statements) e `run` executá-la; os dois são síncronos.

  O perfil do V8 abaixo não chega a esses métodos: as queries rodam depois de
  `await`, e as amostras só mostram o Prisma e o SQLite. Essa contagem custa
  CPU (uma pilha capturada por query, hooks em toda promise); compare a carga
  com rodadas antigas sabendo disso.
- **CPU profile:** as funções que mais gastaram CPU do servidor, pelo tempo
  próprio (`self`, a função no topo da pilha) e pelo tempo total (com o que
  ela chama), em porcentagem do tempo ocupado. Para ver a árvore inteira,
  abra os `.cpuprofile` de `profile/` no Chrome DevTools (aba Performance →
  carregar perfil) ou em <https://www.speedscope.app>. O profiler é só do
  teste de carga: o servidor de produção não carrega o `probe.mjs`.
- **Correção:** do envio até o poll que viu a nota (resolução de
  `SENDS_POLL_MS`); `not graded` são os envios ainda na fila no fim.
