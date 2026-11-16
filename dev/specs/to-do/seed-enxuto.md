---
type: spec
status: to-do
tags: [seed, dev, exam, tests]
relatedTo: [bootstrap, answer-edit-seed]
---

# Seed enxuto: menos provas, os mesmos estados

## Contexto

`src/db/bootstrap.ts` tem 4561 linhas e cresceu uma função por feature. Cada
função cria a própria prova: `cs101/ada_<edição>` tem 23 provas, e a home do
aluno lista 7 "provas abertas". A limpeza anterior (commit `a595f8d`) só
encurtou cada função, sem fundir provas, e depois dela entraram mais três
(`test-06`, `simulation-open`, `simulation-done`).

O seed existe para mostrar cada funcionalidade em uso, não para isolar casos
como um teste unitário. Esta spec funde as provas por momento do ciclo de vida
e mantém todos os estados que o seed alcança hoje.

Medido numa cópia do banco semeado (2026-11-16):

| | Hoje | Meta |
| :-- | --: | --: |
| Linhas de `src/db/bootstrap.ts` | 4561 | até 3600 |
| Provas | 23 | 9 (8 em `cs101`, 1 em `cs201`) |
| Questões | 35 | 27 |
| Tentativas | 48 | cerca de 35 |
| Provas abertas na home do aluno | 7 | 2 |
| Tempo do seed | 5,7 s | menor |

A queda em linhas é menor que a queda em objetos: o grosso do arquivo é dado
(enunciados, planos de aula, respostas), e cada estado distinto custa linhas.
O ganho em linhas vem de três lugares: o andaime de 14 provas (criar, fechar,
datar), 8 questões repetidas e o boilerplate de `db.question.create`,
`db.resource.create` e `demoUser`.

## Por que não uma prova só

Uma prova tem um status e uma janela. "Em andamento" exige prova aberta,
"pedido de revisão" exige notas liberadas, e a liberação é recusada enquanto
houver resposta pendente ou exceção em aberto. Por isso a vitrine são três
provas `EXAM` em três momentos, como num curso real na sétima semana:

- `test-01`: notas liberadas há 3 dias;
- `test-02`: encerrada hoje, em correção. É a vitrine principal;
- `test-03`: aberta agora.

## Inventário de hoje

Tudo em `cs101/ada_<edição>`, salvo indicação. "Destino" é a prova ou objeto
que recebe os estados.

| Função ou bloco | Prova | O que demonstra | Destino |
| :-- | :-- | :-- | :-- |
| bloco inline | `quiz-01` + `seedReleasedQuiz` | QUIZ que libera ao fechar, resultado antigo, lacuna corrigida uma a uma (`Feedback.blanks`) | fica |
| bloco inline | `midterm` | SCHEDULED com `extraTime` | fica, recebe anexo |
| bloco inline | `final` | DRAFT datado, questão DRAFT | fica, recebe simulação |
| `seedOpenQuiz` | `quiz-02` | aberta, cronômetro por tentativa, um tipo de questão de cada | fica, cresce |
| `seedAttachments` | `quiz-attachments` | anexos de questão (cercado, CSV, PDF) e da prova | `quiz-02` |
| `seedAttachments` | `quiz-scheduled-attachments` | anexo fechado antes de a prova abrir | `midterm` |
| `seedCodeAnswerExams` | `practice-js` | rodar código por padrão em PRACTICE | `practice` |
| `seedCodeAnswerExams` | `quiz-js` | rodar código desligado em QUIZ; histórico desligado sem dados | `quiz-02`, `test-03` |
| `seedCodeAnswerExams` | `test-js` | EXAM com `allowCodeRun` explícito | `test-03` |
| `seedExternalGradingExams` | `test-elm` | fila externa: QUEUED, CLAIMED, DONE parcial e total, PRETEST_FAILED, FAILED, CANCELLED, envios esgotados, só autosave | `test-03` |
| `seedExternalGradingExams` + `seedElmPretestExam` | `practice-elm` | envios repetidos em prática; pré-teste por bloco de exemplos e por módulo | `practice` |
| `seedAnswerEditHistoryExams` | `history-essays` | histórico normal com colagem, com marcador e rebase, incompleto, sem digitação | `test-02` |
| `seedAnswerEditHistoryExams` | `history-off` | histórico desligado depois de gravado | `test-03` |
| `seedGradedExam` | `test-01` | correção: automática, manual com comentário, pendente, will-not-grade, em branco, lacuna e ordenação pendentes, exceção | `test-02` |
| `seedRunnableCodeExam` | `test-runnable` | código JS, Python e Prolog rodado na correção; nota do bot com `notes` | `test-02` |
| `seedRubricExam` | `test-07` | rubrica inicial não copiada, rubrica em uso, passes, bot, pendentes iguais | `test-02` |
| `seedRubricExam` | `test-07` | rubrica vista pelo aluno (notas liberadas) | `test-01` |
| `seedExamExceptions` | `midterm` | tempo extra do aluno de dev em prova futura | fica |
| `seedExamExceptions` | `test-02` | segunda chamada que bloqueia a liberação | `test-02` |
| `seedExamExceptions` | `test-03` | tempo extra com janela pessoal aberta ("Reabrir tentativa") | `test-02` |
| `seedQuestionStatsExam` | `test-04` | estatísticas com 8 alunos | `test-01` |
| `seedRegradeExam` | `test-05` | pedido de revisão aberto, aceito, rejeitado | `test-01` |
| `seedWeightedExam` | `test-06` | pesos 3, 2 e 1 | `test-01` |
| `seedSimulatedExams` | `simulation-open` | simulação em andamento com envio na fila | `final` |
| `seedSimulatedExams` | `simulation-done` | simulação entregue | `practice` |
| `seedRollCalls`, `seedClosedRollCall` | | chamadas: código, manual, aparelho repetido, entrada por check-in | fica |
| `seedReports` | | relatos: 4 tipos, 4 status, com imagem | fica |
| `seedRepositories` | | repositório com 2 commits, sem vínculo com aula, vazio | fica |
| `seedGradeColumns` | | coluna liberada e coluna oculta | fica |
| `seedClassroomInvites` | | convite em uso e expirado | fica |
| recursos, agenda, questões | | um recurso de cada tipo, estados do runner, aulas com e sem descrição | fica, compacta |

Não há estado duplicado nas funções de presença, relatos, repositórios, colunas
e convites: cada objeto ali é um estado. Elas não mudam.

## O seed depois

### Provas de `cs101`

| Slug | Tipo e momento | Questões | Papel |
| :-- | :-- | :-- | :-- |
| `quiz-01` | QUIZ, fechado na semana 4 | como hoje | QUIZ que libera ao fechar. Sem mudança |
| `test-01` | EXAM, encerrada há 3 dias, liberada | as 6 de estatística (pesos 3, 2, 1, 1, 1, 1) e `prolog-caso-base` | resultados, estatísticas, pesos, revisões, rubrica como o aluno vê |
| `test-02` | EXAM, janela terminou há pouco, em correção | ver abaixo | vitrine da correção |
| `test-03` | EXAM, aberta, sem data, `allowCodeRun: true`, histórico desligado | `elm-soma`, `js-double-it` | fila externa ao vivo |
| `quiz-02` | QUIZ, aberto, 45 min por tentativa | um tipo de cada, 3 questões com anexo, anexos da prova | vitrine de responder |
| `midterm` | EXAM, SCHEDULED em 6 dias, `extraTime` | como hoje e `csv-attachments`, com anexo próprio | prova futura |
| `final` | EXAM, DRAFT em 28 dias | `big-o-warmup` (DRAFT), `recursion-basics`, `explain-recursion`, `elm-soma` | rascunho com simulação em andamento |
| `practice` | PRACTICE | `js-double-it`, `ts-sum-of-squares`, `recursion-basics`, `factorial-of-five`, `elm-soma`, `elm-sequences`, `elm-vowels` | prática, com simulação entregue |

O `midterm` passa de 7 para 6 dias. Com 7 dias às 14h, um seed rodado de manhã
deixa a prova fora do horizonte de 7 dias, e o bloco "em breve" da home do
aluno fica vazio (é o que acontece hoje).

### `test-02`, a vitrine

Questões, com pesos diferentes: `recursion-basics`, `factorial-of-five`,
`factorial-returns` (ordenação com `unmatched: manual`), `base-case-blanks`
(lacuna manual), `prolog-caso-base` (dissertativa, rubrica em uso),
`js-double-it` (peso 2), `py-count-up`, `prolog-comprimento-de-lista` (rubrica
inicial não copiada) e `elm-soma` (worker externo, peso 3).

A prova fica `ONGOING` com `scheduledAt` 90 minutos atrás e duração de 1 hora.
`COMPLETED` não serve: com esse status a exceção de tempo extra não reabre a
janela pessoal.

| Aluno | Estado |
| :-- | :-- |
| hopper | tudo respondido; dissertativa pela rubrica (folha de grupo e item); histórico normal com colagem e inserção grande; JS corrigido à mão com comentário, sem rubrica; Elm com envio parcial e depois total; lacuna pendente |
| hamilton | objetiva errada; ordenação sem gabarito, pendente; rubrica com `adjustment` e comentário; histórico com marcador, rebase e lacuna final; JS que lança exceção; Python com `NameError`; Elm reprovado no pré-teste |
| liskov | uma questão em branco; passe com o item que depois foi dividido ("rever"); histórico incompleto por limite; JS em laço, Python com saída longa, Prolog que não carrega; exceção de +6 h com a tentativa fechada |
| bob | dissertativa corrigida pelo bot `runner` com itens e `notes`; resposta sem digitação registrada; Prolog corrigido pelo bot; JS com `prompt` |
| knuth, ritchie | a mesma dissertativa a menos de espaços, pendentes; o JS de knuth foi entregue vazio e marcado will-not-grade |
| thompson | dissertativa diferente, pendente |
| student | objetivas e dissertativa entregues, aguardando correção |
| backus | faltou; segunda chamada em 2 dias, que bloqueia a liberação |
| wirth | sem tentativa e sem exceção |

### `test-01`, a liberada

Os 8 alunos das estatísticas e o aluno de dev. Só hopper, hamilton e o aluno de
dev respondem a dissertativa, e os três são corrigidos pela rubrica, para a
liberação passar por `db.exam.releaseGrades` sem carimbo direto no banco. A
rubrica usa a mesma tabela de itens de `test-02`, criada por um helper chamado
nas duas provas.

Revisões: o aluno de dev tem uma aberta, uma aceita com nota nova e uma
resposta sem pedido; a de hopper foi aceita e a de hamilton rejeitada. Os
pedidos aceitos caem na dissertativa, para não mexer nas estatísticas das
objetivas.

### `test-03`, a aberta

Os oito estados de `test-elm`, com os mesmos alunos. O aluno de dev não começou.
Hopper digita o JS com o histórico ligado, e a prova é desligada depois com
`setAnswerHistory(false)`.

### `quiz-02`

Recebe `n-log-n` (múltipla seleção), `js-double-it` (rodar código desligado
pelo padrão de QUIZ), `csv-attachments`, `pdf-attachment`, `csv-versions` na
`v1` (o banco tem a `v2`) e os anexos de `quiz-attachments`. Mantém
`loop-invariants`, que a coleção Bruno usa.

Estado novo: knuth abriu uma tentativa há 2 horas, salvou duas respostas e não
entregou. É a tentativa expirada, que `response.settleExpired` corrige quando
o professor abre a prova. Hoje o seed não tem nenhuma.

### `practice`

Substitui `practice-js` e `practice-elm`. O aluno de dev tem os três envios
corrigidos de `elm-soma`. A simulação entregue da ada fica aqui: objetivas
corrigidas na entrega, JS à espera de correção manual, envio de Elm corrigido
pelo bot. A simulação vale em PRACTICE, então o seed passa a mostrar a prévia
nos dois status em que ela existe.

### `cs201`

Ganha `test-trees`: EXAM encerrada há 2 dias, com `bst-lookup`, respondida por
liskov e bob, corrigida na entrega e não liberada. É o estado "pronta para
liberar" da home do professor, que hoje nenhuma prova alcança (`toRelease`
vazio para ada, alan e instructor). Fica em `cs201` para não somar uma prova à
lista da ada e para dar conteúdo ao segundo curso.

Perde 3 dos 4 recursos e a questão `stack-vs-queue`. Um recurso basta para a
tela do admin mostrar que o segundo curso tem material.

### Questões que saem

`js-sum-of-evens` (o epílogo e o link do enunciado vão para `js-double-it`),
`essay-base-case`, `code-factorial`, `prolog-factorial-with-is` (as respostas
que não carregam e que usam CLP(FD) viram respostas de
`prolog-comprimento-de-lista`), `weighted-base-case`, `weighted-call-stack`,
`weighted-tail-call` e `stack-vs-queue`.

### O que continua separado

| Objeto | Motivo |
| :-- | :-- |
| `quiz-01` | só um QUIZ fechado libera sem `releaseGrades` |
| `test-01`, `test-02`, `test-03` | liberada, em correção e aberta não cabem numa prova |
| `quiz-02` | cronômetro por tentativa e tentativa expirada pedem prova aberta com duração e sem data |
| `midterm` | prova futura, anexos fechados |
| `final` | DRAFT, simulação em andamento |
| `practice` | PRACTICE muda os padrões de rodar código e de histórico |
| `cs201/test-trees` | pronta para liberar exige prova sem pendência e sem exceção |

### Âncoras que não mudam

- Contas: `admin`, `instructor`, `student`, `ada`, `alan` e os alunos, com a
  senha igual ao usuário.
- Cursos: `cs101/ada_<edição atual>`, `cs201/alan_<edição atual>`,
  `cs101/ada_<edição passada>` (só com hopper).
- Tokens `dev-ada-cli`, `dev-runner-bot`, `dev-student-calendar` e a
  disciplina `pyxel101`, de que `scripts/seed-cli.ts` depende.
- O que a coleção Bruno cita: `quiz-01`, `quiz-02` com `loop-invariants`,
  recurso `toolchain`, coluna `assignments`, horário `mon`.

`test-01`, `test-02` e `test-03` mudam de papel. `test-01` hoje é a prova em
correção e passa a ser a liberada.

## Matriz estado × objeto

| Estado | Hoje | Depois |
| :-- | :-- | :-- |
| DRAFT datado, com questão DRAFT | `final` | `final` |
| SCHEDULED em até 7 dias, `extraTime` | `midterm` | `midterm` |
| aberta, aluno ainda não começou | `quiz-02` | `quiz-02`, `test-03` (student) |
| aberta, tentativa em andamento | `test-elm` | `test-03` |
| tentativa expirada sem entrega | nenhum | `quiz-02` (knuth) |
| entregue, aguardando correção | `test-01` | `test-02` |
| faltou | várias | `test-02` (wirth) |
| pronta para liberar | nenhum | `cs201/test-trees` |
| liberada há menos de 7 dias | `test-04` a `test-07` | `test-01` |
| QUIZ liberado ao fechar | `quiz-01` | `quiz-01` |
| PRACTICE | `practice-js`, `practice-elm` | `practice` |
| um tipo de questão de cada | `quiz-02` | `quiz-02` |
| rodar código: padrão PRACTICE, padrão QUIZ, EXAM explícito | `practice-js`, `quiz-js`, `test-js` | `practice`, `quiz-02`, `test-03` |
| anexos de questão e de prova | `quiz-attachments` | `quiz-02` |
| anexo fechado antes de abrir | `quiz-scheduled-attachments` | `midterm` |
| questão com duas versões, CSV diferente | `csv-versions` | `csv-versions`, `v1` em `quiz-02` |
| pré-teste Elm por exemplos e por módulo | `practice-elm` | `practice` |
| fila externa, 8 estados | `test-elm` | `test-03` |
| envios repetidos em prática | `practice-elm` | `practice` |
| envios corrigidos em tentativa fechada | só na simulação | `test-02` |
| simulação em andamento, envio na fila | `simulation-open` | `final` |
| simulação entregue | `simulation-done` | `practice` |
| correção automática, manual, pendente, will-not-grade, em branco | `test-01` | `test-02` |
| lacuna pendente, ordenação pendente | `test-01` | `test-02` |
| lacuna corrigida uma a uma | `quiz-01` | `quiz-01` |
| nota do bot com `notes` | `test-runnable`, `test-07` | `test-02` |
| código rodado na correção (JS, Python, Prolog) | `test-runnable` | `test-02` |
| rubrica inicial não copiada | `test-07` | `test-02` |
| rubrica em uso: grupos, item negativo, item dividido | `test-07` | `test-02` |
| passes: folha e item, ajuste, rever, bot | `test-07` | `test-02` |
| respostas pendentes iguais e uma diferente | `test-07` | `test-02` |
| rubrica vista pelo aluno | `test-07` | `test-01` |
| histórico: normal com colagem, marcador e rebase, incompleto, sem digitação | `history-essays` | `test-02` |
| histórico desligado depois de gravado | `history-off` | `test-03` |
| prática sem histórico | `practice-elm` | `practice` |
| exceção: tempo extra em prova futura | `midterm` | `midterm` |
| exceção: segunda chamada bloqueia a liberação | `test-02` | `test-02` (backus) |
| exceção: janela pessoal aberta, reabrir | `test-03` | `test-02` (liskov) |
| estatísticas: distrator popular, opção nunca escolhida, discriminação negativa, sem variância | `test-04` | `test-01` |
| pesos 3, 2 e 1, total diferente da média | `test-06` | `test-01` |
| revisão aberta, aceita, rejeitada, resposta sem pedido | `test-05` | `test-01` |
| home do aluno: abertas, em breve, hoje, resultados, revisões | 7, vazio, sim, sim, sim | 2, `midterm`, sim, `test-01`, `test-01` |
| home do professor: em andamento, a corrigir, revisões, relatos, hoje | ada | ada |
| home do professor: a liberar | nenhum | alan |
| home do professor vazia | alan, instructor | instructor |
| "Esta semana" do curso | aulas e 5 provas | aulas, `test-02`, a segunda chamada de backus e, conforme o dia, `test-01` |

Estado que sai do seed, de propósito: o link "mais N provas abertas", que
exige 4 provas abertas. A história
`test/stories/student-finding-course-material.test.ts` cobre.

Lacunas que já existem e ficam fora desta spec: prova `ARCHIVED` e questão com
problema de validação na home do professor (a escrita pelo service recusa a
questão inválida).

## Testes afetados

Medido rodando a suíte inteira num clone com `ensureDemoCourses` desligado e
`ensureDevAdmin` ligado: 3611 de 3620 testes `unit` e 931 de 931 `e2e`
passaram.

| Teste | Dependência | O que fazer |
| :-- | :-- | :-- |
| `test/answer-edit-seed.spec.ts` (9 testes) | lê uma cópia do banco semeado e procura cada estado do histórico pelo que ele é, sem slug | manter. Continua verde se os estados continuarem no seed |
| o resto da suíte | nenhuma. As ocorrências de `cs101`, `ada_2026-2`, `midterm` e `test-02` em `test/` são literais de funções puras ou dados criados por factory | nada |
| `test/bruno/*.yml` | coleção de uso manual contra o dev server; `test/bruno.spec.ts` só a confere com o OpenAPI | manter as âncoras citadas acima |
| `cli/tests`, `test:runner`, `test:plugins` | nenhuma | nada |

Não há teste para desacoplar. O problema é o contrário: fora do histórico de
edição, nada confere que o seed alcança os estados, e `test/run.ts` só
garante que ele roda. A primeira tarefa cria essa rede.

## Tarefas

Cada tarefa termina com `rtk pnpm run test:unit` verde (o runner roda o seed
antes) e `pnpm run typecheck` com saída 0. O `e2e` não depende do seed e roda
uma vez, em S8.

- S1. Rede de proteção (`sonnet`). Criar `test/seed-states.spec.ts`, `unit`,
  nos moldes de `test/answer-edit-seed.spec.ts`: lê uma cópia de
  `TEST_SEEDED_DB_PATH` e tem um teste por linha da matriz, que procura o
  estado pelo que ele é (tipo, status, datas, estados de submissão e de
  trabalho, exceções, pedidos), nunca por slug. Extrair a cópia do banco para
  um arquivo de apoio usado pelos dois specs. Os estados novos (tentativa
  expirada, pronta para liberar, "em breve" do aluno de dev) entram como
  `test.fixme`. Inclui as homes: `loadStudentHome` para `student` e
  `loadInstructorHome` para `ada`. Pronto quando passa sobre o seed de hoje.
- S2. Lado de responder (`sonnet`). `practice`, `quiz-02`, `midterm`, `final`.
  Apaga `practice-js`, `quiz-js`, `practice-elm`, `quiz-attachments`,
  `quiz-scheduled-attachments`, `simulation-open` e `simulation-done`.
  `test-js`, `test-elm` e a questão `js-sum-of-evens` ficam até S5. Tira o
  `fixme` da tentativa expirada e do "em breve".
- S3. `test-02`, a vitrine (`sonnet`). Funde `test-01`, `test-runnable`,
  `test-07` (a parte de correção), `history-essays`, `test-02` e `test-03`
  antigas. Vem antes de S4 porque libera o slug `test-01`.
- S4. `test-01`, a liberada (`sonnet`). Funde `test-04`, `test-05`, `test-06` e
  a visão do aluno de `test-07`. Conferir na página de estatísticas que
  `pivot-trap` segue com discriminação negativa e `stack-top` sem variância.
- S5. `test-03`, a aberta (`sonnet`). Funde `test-elm`, `test-js` e
  `history-off`, e apaga `js-sum-of-evens`.
- S6. `cs201` (`haiku`). `test-trees`, corte dos recursos e de
  `stack-vs-queue`. Tira o `fixme` de "pronta para liberar".
- S7. Compactar sem mudar dados (`sonnet`). Helpers `question()` e `exam()`,
  tabela única para os recursos `CODE` e para os usuários. Pronto quando a
  contagem de registros por tabela do banco semeado é igual antes e depois, e o
  arquivo tem até 3600 linhas.
- S8. Fechamento (`sonnet`). `pnpm exec biome check --write .`,
  `pnpm run lint`, `rtk pnpm test`, `CHANGELOG.md`, spec para `to-review/`.
  Trocar a regra do seed em `AGENTS.md` ("Workflow") e no item 6 de
  `.claude/skills/new-feature/SKILL.md`: um estado novo entra numa prova que
  já existe, e uma prova nova só nasce quando o estado não cabe em nenhuma,
  com o motivo escrito na spec. Rodar `pnpm run db:reset` e conferir as telas
  dos critérios de aceite.

Cuidados para S2 a S5:

- As respostas entram com a prova aberta e sem data. A data e a janela são
  postas depois, como o seed já faz.
- `db.gradingJob.claim` pega o trabalho mais antigo da fila. Os envios que
  ficam `QUEUED` (`test-03`, simulação de `final`) são feitos por último, ou
  o `claim` leva o filtro `exam`.
- O histórico de edição exige abrir a tentativa, recuar o `createdAt`, mandar
  os lotes, salvar a resposta e só então entregar. Em `test-02` isso vale para
  hopper, hamilton, liskov e bob.
- Os textos digitados no histórico são as respostas da dissertativa e do JS
  de `test-02`, não os de `essay-base-case`.

## Critérios de aceite

- `test/seed-states.spec.ts` e `test/answer-edit-seed.spec.ts` passam, sem
  `fixme`.
- `cs101/ada_<edição>/exams` lista 8 provas, e `cs201/alan_<edição>/exams`, 1.
- `student`/`student`: a home mostra 2 provas abertas, o `midterm` em breve, o
  resultado e as revisões de `test-01`. A home do curso mostra "Esta semana"
  com aulas e `test-02`, e "Provas abertas" com `test-03` e `quiz-02`.
- `ada`/`ada`: a home mostra `test-03` e `quiz-02` em andamento, `test-02` a
  corrigir e com 2 janelas pessoais, a revisão aberta de `test-01`, o relato
  aberto e as aulas de hoje.
- `alan`/`alan`: a home oferece liberar as notas de `test-trees`.
- Em `test-02`, a fila de correção, a rubrica, o histórico de edição, o código
  executável, os envios de Elm e a página de exceções mostram os estados da
  tabela de alunos.
- `src/db/bootstrap.ts` tem até 3600 linhas.

## Decisões da implementação

- S1: a home e as estatísticas são verificadas num processo filho
  (`test/seed-reports.ts`), porque os loaders usam o `prisma` global.
- S1: a linha "Esta semana" da home do curso fica só para o e2e.
- S2: `quiz-02` nasce depois de `seedQuestionStatsExam`, porque `n-log-n` é
  criada ali, e depois de `seedAttachments` e `seedRunnableCodeExam`
  (`csv-attachments`, `pdf-attachment`, `js-double-it`). `seedAttachments` só
  cria as questões e põe o anexo do `midterm`.
- S2: `practice` e as duas simulações ficam numa função só
  (`seedPracticeAndSimulations`), depois de `elm-soma` e dos trabalhos de
  `test-elm`. O `claim` desses envios leva o filtro `exam`, porque a fila de
  `test-elm` ainda tem trabalhos `QUEUED`. S3 a S5 devem manter o filtro ou
  mover esta função para depois da fila.
- S2: o `final` ganha as questões da simulação por `db.exam.update`, depois de
  `elm-soma` existir.
- S2: o histórico de `quiz-js` (desligado, sem dados) sai com a prova. O caso
  de histórico desligado fica por conta de `test-03` (S5).
- S3: `seedGradingShowcase` junta num bloco só os aspectos de `test-02`, depois
  de `seedExternalGradingExams` (precisa de `elm-soma`), com o `claim` filtrado
  por `exam`. `explain-recursion` e `factorial-returns` nascem ali.
- S3: o peso 2 de `js-double-it` e o 3 de `elm-soma` estão nas próprias questões
  (`weight`), então valem em todas as provas que as usam.
- S3: a exceção de +15 min de bob em `test-01` antigo some: a tabela de alunos
  da spec não a tem.
- S3, provisório até S4 e S5: `test-07` sobrevive reduzido a uma prova liberada
  com a dissertativa corrigida pela rubrica (hopper, hamilton), e usa a mesma
  função de itens de `test-02` (`seedEssayRubric`). `history-off` sobrevive em
  `seedHistoryOffExam` com `explain-recursion`. S4 e S5 apagam as duas.
- S4: `seedReleasedExam` (ex-`seedQuestionStatsExam`) cria `test-01` com os nove
  alunos. Os pesos 3 e 2 estão em `fastest-sort` e `n-log-n`, e `stack-facts`
  ganhou `weight: 1` explícito, porque a rede procura 3, 2 e 1 no payload.
- S4: o pedido aceito do aluno de dev cai na dissertativa (nota 0,8), e o
  aberto numa objetiva (`stack-facts`), que não muda nota nem estatística.
  `test-07`, `seedWeightedExam` e `seedRegradeExam` saíram, e com eles as
  questões `weighted-*`.

## Riscos

- `test-02` concentra seis fluxos. Um erro de ordem (resposta depois da
  janela, `claim` do trabalho errado) derruba o seed inteiro, e com ele toda
  rodada de teste. Manter um helper por aspecto (respostas, rubrica,
  histórico, envios, exceções) dentro da função da prova.
- A segunda chamada era semeada numa prova `COMPLETED` e passa a uma `ONGOING`
  com a janela vencida. Conferir que o bloqueio "exception-open" continua.
- Estados que vencem com o relógio: a janela pessoal de liskov dura 6 horas
  depois do seed (já é assim), e um seed rodado antes de 1h30 da manhã põe
  `test-02` no dia anterior.
- As estatísticas de `test-01` foram desenhadas para 8 alunos. O nono aluno e
  a dissertativa mudam os números.
- Quem valida como `ada` não vê "a liberar": precisa entrar como `alan`.
- As specs em `dev/specs/to-review/` e o changelog citam slugs que somem
  (`test-07`, `history-essays`, `simulation-open`). São registro histórico e
  não mudam.

## Fora do escopo

- Dividir `bootstrap.ts` em módulos.
- Semear prova `ARCHIVED` e questão com problema de validação.
- Mexer em presença, relatos, repositórios, colunas de nota e convites.
