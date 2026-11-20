---
type: issue
status: todo
tags: [performance, rest, memory, deploy]
relatedTo: [listas-sem-paginacao, metricas-de-performance-no-servidor, custo-por-requisicao-na-prova]
kind: bug
priority: high
created: 2026-11-19
creator: claude
---

# Uma requisição grande estoura o heap e derruba o processo inteiro

Em 2026-11-19, entre 17:15 e 17:38 (horário de Brasília), o processo de prod
caiu cinco vezes com `FATAL ERROR: Reached heap limit Allocation failed -
JavaScript heap out of memory` (`status=6/ABRT`, core dump), e o systemd o
reiniciou. Havia alunos fazendo prova nesse intervalo (`exam.start` às 17:14 e
17:16; `edumorais`, `gabrielmesteves` e `johnaopedro` salvavam respostas sem
parar), e cada queda derrubou todos eles, além do bot de correção.

Quatro das cinco quedas (17:34, 17:35, 17:36 e 17:38) vieram de um professor
baixando as respostas de uma prova pela CLI:

```
GET /api/course/paradigmas/chips_2026-2/response?exam=prova-final-b&acceptingSubmissions=false&practice=false
```

A primeira (17:15) aconteceu antes dessas chamadas, logo depois de um restart
manual às 17:13. A causa mais provável é a `/home` ou a página do curso do
professor, que carregam todas as submissões do curso (ver Medições). Antes disso, de 17:06 a
17:13, as rotas da prova davam 500 e `exam.answer` dava 400 após 2 s com
`Transaction API error: Unable to start a transaction in the given time`.

Logs: `deploy/logs/codehood/codehood-20261119T174521.json`
(`ansible-playbook logs.yml`).

### Prova de 2026-11-18

Na prova final (turma 14h, `prova-final-a`), o processo caiu 17 vezes por
estouro de heap entre 14:50 e 15:59. Em todas as quedas havia uma
`GET /[discipline]/[course]` (15 vezes) ou `GET /home` (4) começada nos 2
minutos anteriores e nunca concluída (ids que aparecem em `slow-service` ou
`stall` sem evento `request`). Os alunos abrem essas páginas durante a prova;
uma delas levou 7 s. Não houve queda na turma 16h, com a gravação do
histórico de edição desligada pelo professor. Nenhuma resposta se perdeu (o
último autosave confere com o histórico) e nenhum envio de código ficou sem
correção. Logs:
`deploy/logs/codehood/codehood-20261119T182932.json`.

## Por que essa rota estoura

- `GET .../response` devolve cada resposta com o array `submissions` inteiro,
  e numa questão discursiva ou de código cada autosave é uma submissão. Só a
  questão discursiva do modelo B tem 7703 autosaves; o banco tem 168515
  submissões.
- A rota não pagina de fato: com `limit=5` a primeira página passou de 7,8 MB
  e a conexão caiu no meio (`IncompleteRead`). O modelo A (77 respostas)
  passou, em 4,9 s; o B (94 respostas) não.
- Não há como filtrar `submissions` por questão ou por `kind` (só a última,
  sem os autosaves).
- `GET .../submission?exam=...&question=...` resolve o caso de uma questão
  (7703 itens, uma página, 10 s), mas não traz o autor; foi preciso um
  `GET .../response/<publicId>` por aluno.

## Por que derruba tudo

- O serviço roda com `MemoryMax=600M` (`deploy/templates/codehood.service.j2`)
  e sem `--max-old-space-size`. O Node deriva o limite do heap do cgroup, e o
  heap morre perto de 300 MB (`Mark-Compact (reduce) 299.7 -> 299.0 MB`).
- Um estouro de heap no V8 é fatal para o processo; não dá para capturar e
  devolver 500 só para a requisição culpada.
- O processo é único (sem cluster ou worker), então uma requisição pesada leva
  junto todas as outras, inclusive as de quem está fazendo prova.

## Uso de memória medido (métricas `event: process` do log)

| Situação                              | RSS        | Heap          |
| :------------------------------------ | :--------- | :------------ |
| Repouso, 17:10 a 17:33                | 233-380 MB | 87-151 MB     |
| Pico do serviço antes do restart      | 509 MB     | -             |
| Na queda                              | -          | ~300 MB (limite) |

O `deploy/README.md` diz que o app usa cerca de 150 MB; o RSS em repouso já é
o dobro disso. Falta medir o pico de uma requisição pesada (ver abaixo).

## O que fazer

1. Isolar a requisição do processo:
   - limitar o tamanho da resposta das listas (paginação real em `response`,
     contando submissões e não respostas) e recusar com 413/422 o que passar
     do teto;
   - montar a resposta em stream em vez de materializar o JSON inteiro;
   - opcional: mover exportações pesadas para um worker thread com
     `resourceLimits.maxOldGenerationSizeMb`, que morre sozinho sem levar o
     processo principal.
2. Filtros em `GET .../response`: `question`, e omitir autosaves
   (`kind`, ou só a última submissão por questão). Incluir `author` (ou o
   `publicId` da resposta e o autor) em `GET .../submission`.
3. Deploy: definir `--max-old-space-size` explicitamente no `ExecStart`, abaixo
   do `MemoryMax`, e rever os dois depois da medição. Atualizar o
   `deploy/README.md`.
4. Medir antes de dimensionar a VPS: rodar o servidor sobre uma cópia do
   backup de prod (`deploy/backups/codehood/db/codehood-20261119T202706Z.db.gz`)
   e registrar o RSS de pico (`VmHWM` em `/proc/<pid>/status`) e o heap para:
   repouso, `GET /response` de cada prova grande, a página de correção de uma
   questão e uma carga de prova (`exam.answer` concorrente). Com esses números,
   decidir RAM da VPS, `MemoryMax` e `--max-old-space-size`.
5. O chalk faz a mesma chamada: `autograde_exam` em
   `~/git/edu/chalk/chalk/codehood_autograde.py` usa
   `client.list("response", exam=..., acceptingSubmissions=False, practice=False)`
   para achar a submissão mais nova. Trocar por `GET /submission?exam=&question=`
   antes de rodar `chalk codehood autograde` em prod durante uma prova.
6. `/home` e a página do curso do professor: carregam todas as submissões do
   curso (cerca de 600 consultas, ~1 GB de heap) para montar uma página de
   ~60 KB. Trocar por agregações no banco (contagens e últimas submissões),
   sem materializar os autosaves. É o maior consumo medido e cresce a cada
   autosave; mais RAM só adia o problema.
7. Documentar na CLI e no `src/api/README.md` que `GET /response` não serve
   para exportar provas inteiras até o item 1 estar feito.

## Medições

Feitas em 2026-11-19 sobre o build de prod (`deploy/build/codehood-0.6.0.tar.gz`,
`pnpm install --prod`), Node 24.22.0, `ENVIRONMENT=prod`, `NODE_ENV=production`
e uma cópia de `deploy/backups/codehood/db/codehood-20261119T202706Z.db.gz`.
Cada linha é um processo novo: sobe, serve `/`, `/login` e duas rotas leves da
API, espera 3 s e só então faz a requisição medida. RSS de pico é o `VmHWM` de
`/proc/<pid>/status`; heap de pico é o maior valor antes de um GC no
`--trace-gc`. Os tempos são da máquina local (12 núcleos, SSD); em prod a mesma
consulta de submissões levou 17 a 20 s contra 1 a 2 s aqui.

Sem limite prático (`--max-old-space-size=4096`):

| Cenário                                                   | Bytes da resposta | RSS de pico | Heap de pico | Tempo |
| :-------------------------------------------------------- | ----------------: | ----------: | -----------: | ----: |
| Repouso (após subir e servir páginas leves)               |                 - |      352 MB |       140 MB |     - |
| `GET /response?exam=prova-final-a` (78 respostas)         |        35 126 724 |      672 MB |       288 MB | 1,3 s |
| `GET /response?exam=prova-final-b` (96 respostas)         |        59 595 666 |      900 MB |       450 MB | 2,2 s |
| `GET /response?exam=teste2-elm` (145 respostas)           |         6 246 226 |      425 MB |       167 MB | 0,2 s |
| `GET /submission?...&question=lambda-booleanos-de-church-b` |       3 113 728 |      585 MB |       313 MB | 0,7 s |
| Correção de `lambda-booleanos-de-church-b` (7703 subm.)   |           114 173 |      670 MB |       397 MB | 2,7 s |
| Correção de `elm-folha-do-organograma` (13577 subm.)      |         4 795 250 |      772 MB |       463 MB | 3,4 s |
| Correção de `elm-lotacao-do-estacionamento` (16797 subm.) |         4 075 470 |      785 MB |       482 MB | 3,3 s |
| Página da prova `prova-final-b` (professor)               |            61 375 |      652 MB |       390 MB | 3,2 s |
| `GET /home` (professor)                                   |            62 296 |     1296 MB |      1009 MB | 6,4 s |
| `GET /paradigmas/chips_2026-2` (professor)                |            56 623 |     1305 MB |       996 MB | 6,6 s |
| Simultâneas: `response` B + página da prova + correção de `lotacao` | -       |     1100 MB |       733 MB | 8,1 s |
| Simultâneas: `response` B + `/home`                       |                 - |     1351 MB |       998 MB | 8,8 s |

Com o limite de prod (`systemd-run --user --scope -p MemoryMax=600M`, sem
`--max-old-space-size`): o Node 24 deriva `heap_size_limit` = 348 MB do
cgroup, e o old space morre em ~300 MB, igual a prod.

| Cenário                                                | Resultado  | RSS de pico | Heap de pico |
| :----------------------------------------------------- | :--------- | ----------: | -----------: |
| `GET /response?exam=prova-final-b`, sozinha            | 200, 2,8 s |      668 MB |       289 MB |
| Duas `GET /response?exam=prova-final-b` simultâneas    | 200, 7,7 s |      668 MB |       286 MB |
| Correção de `elm-lotacao-do-estacionamento`            | 200, 4,1 s |      477 MB |       274 MB |
| Página da prova `prova-final-b` (professor)            | 200, 3,3 s |      484 MB |       279 MB |
| `GET /home` (professor)                                | **morre** (`Mark-Compact (reduce) 299.0 -> 298.6 MB`, a mesma linha de prod) | - | 299 MB |
| `response` B + página da prova + correção, simultâneas | **morre** em 8,3 s | -   |       290 MB |

`GET /home` do professor com outros limites de heap: morre com
`--max-old-space-size=512`; passa com 768 (RSS 1012 MB) e com 1024 (RSS 1117 MB).

### O que os números dizem

- O repouso já é ~300 MB de RSS com 85 a 130 MB de heap. A diferença
  (~200 MB) é código, módulos nativos e buffers, e se soma a qualquer pico.
- `GET /response` de uma prova sozinha cabe no limite atual, raspando: o V8
  coleta mais cedo quando o teto é baixo. Em prod ela morreu porque não estava
  sozinha (alunos em prova, heap de repouso maior, consultas 10 vezes mais
  lentas mantendo mais objetos vivos). Duas ou três rotas pesadas ao mesmo tempo
  derrubam o processo localmente também.
- O pior caso não é o `GET /response`: são `/home` e a página do curso para o
  professor. As duas carregam todas as submissões do curso (`response.findMany`,
  ~600 consultas) para montar uma página de ~60 KB, precisam de 512 a 768 MB
  de heap e morrem sozinhas com o limite atual. É um candidato forte para a
  queda das 17:15, que não teve `GET /response` antes. Esse custo cresce com
  cada autosave, então não se resolve só com RAM.
- O RSS de pico fica perto de heap + 350 MB em todos os cenários.
- `pnpm install --prod --frozen-lockfile` com store vazio teve pico de 588 MB
  de RSS (soma da árvore de processos, pnpm 12 local; prod usa 11.28.4). No
  deploy ele roda enquanto a versão antiga ainda serve.

### Recomendação

- VPS de 4 GB. Com 2 GB, o professor abrindo `/home` (~1 GB de RSS) junto com
  um `pnpm install` (~600 MB), Caddy, SQLite e o sistema já não cabe sem swap.
- `ExecStart=/usr/bin/node --max-old-space-size=1536 dist/server/entry.mjs`:
  cobre o pior caso medido (`/home` + `response` B simultâneos, ~1 GB de heap)
  com ~50% de folga.
- `MemoryMax=2304M` (1536 + ~350 de RSS fora do heap + folga). O heap tem de
  estourar antes do cgroup, para a queda vir com `heap out of memory` no log
  e não com um OOM kill sem mensagem.
- Sobram ~1,7 GB para o sistema, Caddy, cache de página do SQLite e o
  `pnpm install` do deploy, que deixa de depender de swap.
- Isso só empurra o limite. Os itens 1 e 2 continuam necessários, e a mesma
  correção precisa cobrir `/home` e a página do curso do professor, que
  materializam todas as submissões.
