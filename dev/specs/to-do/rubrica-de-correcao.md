---
type: spec
status: to-do
tags: [grading, rubric, exams, instructor, cli]
relatedTo: [web-grading, runner-de-correcao, revisao-por-lacuna, regrade-requests, chaves-de-api-com-escopo]
---

# Rubrica de correção

## Contexto

A correção manual de uma questão hoje é uma nota e um comentário livre por
resposta, numa página que lista todas as respostas de uma vez. Com 175 alunos
(Prova 1 de Paradigmas) a página fica inutilizável, a mesma justificativa é
escrita dezenas de vezes e a nota de um mesmo erro varia ao longo da correção.
Esta spec traz uma rubrica por questão da prova, editável durante a correção,
cujas mudanças recalculam as notas já dadas, e uma tela de correção de uma
resposta por vez, guiada pelo teclado. A rubrica também é manipulável pela
REST, para que a CLI, scripts locais com LLMs e os grading bots apliquem
itens e editem a rubrica sem levar essa lógica ao servidor.

A literatura que embasa as escolhas (rubrica analítica e específica da
tarefa, rubrica que evolui na correção com recálculo, ordem por semelhança)
está resumida na conversa que originou esta spec: Brookhart 2018, Jonsson e
Svingby 2007, Messer et al. 2024, Johnson-Yu et al. 2024.

## Glossário

Termos novos no `GLOSSARY.md`: **Rubric** e **Rubric item**. Termos desta
spec:

- **Rubrica inicial**: a que vem no JSON do mdq da questão
  (`privatePayload.rubric`). O push a atualiza; ela não afeta uma rubrica já
  copiada.
- **Começo da correção**: a primeira escrita que envolve a rubrica de uma
  questão numa prova. Copia a rubrica inicial para o banco.
- **Grupo**: o caminho antes do `:` de um item, como `Recursão/Errada/Caso
  base`. O grupo de primeiro nível (`Recursão`) é uma escolha única.
- **Rever**: estado de uma correção que aplicou um item arquivado.

## Requisitos

### Banco

- R1. `Rubric` liga uma `Exam` e uma `QuestionRef`, com `@@unique([examId,
  questionRefId])` e cascata a partir de `Exam`. Não aponta para
  `QuestionsForExam`, porque o push da prova apaga e recria essas linhas
  (`src/db/services/exam.service.ts:352`). Campos: `base` (decimal em
  [0, 1], padrão `"0"`) e `sourceVersion` (versão copiada, nula quando
  começou vazia).
- R2. `RubricItem`: `key` (única na rubrica, nunca reatribuída), `group`
  (caminho ou nulo), `text`, `value` (decimal com sinal em [-1, 1]),
  `comment` (privado), `feedback` (para o aluno), `position`, `retiredAt`.
  Cascata a partir de `Rubric`. Os grupos não são linhas: só caminhos.
- R3. `FeedbackRubricItem(feedbackId, itemId)`, chave composta, cascata dos
  dois lados.
- R4. `Feedback` ganha `rubricId` (nulo; `onDelete: SetNull`) e
  `adjustment` (decimal com sinal, nulo).

### Regras da rubrica

- R5. Profundidade de grupo arbitrária. Segmentos sem `/` nem `:`, com
  espaços nas pontas cortados. Ordem dos grupos: a do primeiro item.
- R6. Uma correção aplica no máximo um item por grupo de primeiro nível.
  Itens sem grupo são independentes.
- R7. Nota de uma correção pela rubrica:
  `min(1, max(0, base + Σ valores aplicados + adjustment))`, gravada em
  `Feedback.score` como decimal exato. Itens arquivados aplicados continuam
  contando.
- R8. Toda mudança de `base`, de `value` de um item, ou o apagamento de um
  item aplicado, recalcula na mesma transação o `score` de toda correção com
  aquele `rubricId`. Apagar remove o item das correções antes de recalcular.
- R9. A mudança é permitida depois da liberação das notas. A tela avisa
  quantas notas liberadas mudam (R22).
- R10. Dividir um item (`split`) arquiva o item e cria os filhos. O grupo
  padrão dos filhos é `<grupo>/<texto>` do item antigo. As correções que o
  aplicavam mantêm a nota e ficam "rever". Uma correção nova não pode
  aplicar item arquivado.
- R11. "Rever" é derivado: a correção vigente aplica algum item com
  `retiredAt`. Não há coluna.
- R12. Começo da correção: toda escrita (R14 a R18 e uma correção com
  `rubric`) copia antes a rubrica inicial da versão em
  `QuestionsForExam.version` (ou a mais nova, se nula), se ainda não houver
  rubrica. Sem rubrica inicial, a rubrica nasce vazia com base 0. As chaves
  vêm do `id` do item no mdq ou, sem ele, da posição (`"1"`, `"2"`...). O
  push posterior não muda a rubrica copiada.
- R13. Rubrica inicial lida de `privatePayload.rubric`: lista de
  `{id?, value, path?, text, comment?, feedback?}` (formato provisório,
  ver a issue `~/git/codehood/mdq/dev/issues/rubrica-de-correcao.md`). Um
  valor malformado é ignorado com aviso no log, sem quebrar a correção.

### Service

- R14. `rubricService.findOne({course, exam, question})`: a rubrica
  gravada ou, se não houver, a inicial com `initial: true`, sem gravar
  (`transaction: false`). Cada item traz `uses`, e a rubrica traz `review`
  (quantas correções vigentes estão em "rever").
- R15. `update(pk, {base})`, `createItem(pk, item)` (chave opcional; a
  gerada é `i<n>`, um acima do maior `i<n>` existente, arquivados
  incluídos; uma chave apagada só volta se o chamador a mandar), `updateItem(itemPK, patch)`,
  `deleteItem(itemPK)` (repetir não falha).
- R16. `splitItem(itemPK, {children})`, com R10.
- R17. `renameGroup(pk, {from, to})`: troca o prefixo `from` por `to` em
  todos os itens do grupo e dos subgrupos. Avisa (não recusa) quando o
  destino difere de um grupo existente só em maiúsculas ou espaços.
- R18. `preview(pk, change)`: aplica a mudança numa transação desfeita e
  devolve `{passes, released}`, as correções cuja nota muda e quantas delas
  já foram liberadas.
- R19. `feedbackCreate` e `feedbackUpdate` ganham `rubric?: string[]`
  (chaves) e `adjustment?`. Com `rubric`, o servidor calcula `score` (R7) e
  grava `rubricId`; mandar `score` junto é 400. Chave inexistente,
  arquivada, ou dois itens no mesmo grupo de primeiro nível (R6): 400. Sem
  `rubric`, nada muda em relação a hoje. `rubric: []` é uma correção pela
  rubrica sem itens (nota = base + ajuste). Só a chave arquivada que a
  correção ainda não tinha é recusada: reenviar uma que ela já aplica é
  aceito. Um `update` com `score` numa correção pela rubrica a torna
  manual: limpa `rubricId`, itens e `adjustment`. Um `update` só com
  `adjustment` ou `feedback` mantém os itens e recalcula.
- R19a. A nota calculada é racional exata: sai como decimal quando o
  denominador só tem fatores 2 e 5 (`0.35`), senão como `n/d` reduzida
  (`2/3`).
- R19b. "Rever" e as contagens de R14 consideram só o veredito (a
  correção mais nova por `updatedAt`) da resposta que conta, como em
  `src/services/grading.ts`.
- R20. A saída do feedback traz `rubric` (chaves), `adjustment` e `review`.
  Para o aluno (só depois da liberação, como hoje), traz os itens aplicados
  com `group`, `text`, `value` e `feedback`, sem `comment` e sem os itens
  não aplicados, filtrado em `present()` como `notes`.

### REST e permissões

- R21. Rotas sob `/api/course/[discipline]/[course]/exam/[slug]/question/[question]`:
  `GET /rubric`, `PATCH /rubric`, `POST /rubric/item`,
  `PUT|PATCH|DELETE /rubric/item/[key]`, `POST /rubric/item/[key]/split`,
  `POST /rubric/rename-group`, `POST /rubric/preview`. Questão fora da
  prova: 404. `PUT /submission/[publicId]/feedback/[ref]` aceita R19.
- R22. `rubric.read` e `rubric.write`: `isCourseOwner`, sem ramo de admin
  nem de aluno, como `feedback.create`. Chaves `BOT` podem escrever (a
  restrição fica para o RFC de chaves com escopo).

### Telas

- R23. `grading/[question]` passa a ser a tela de uma resposta por vez:
  resposta à esquerda (com a correção do bot embaixo, se houver), painel da
  rubrica à direita, ajuste, comentário livre, nota calculada ao vivo e
  "Salvar e próxima". Cabeçalho com "Resposta i de N", pendentes, "rever",
  e enunciado e gabarito recolhíveis. Anônima por padrão, como no R5 de
  `web-grading`.
- R24. Ordem: pendentes, depois "rever", depois corrigidas. Dentro de cada
  bloco, as respostas com o mesmo texto normalizado (espaços colapsados e
  aparados) ficam juntas, e os blocos seguem a ordem de envio da primeira
  resposta de cada um.
- R25. Teclado, desligado com o foco num campo de texto: `1`-`9` escolhem
  o grupo ou alternam o item solto; `a`, `b`, `c`... escolhem a opção do
  grupo (as folhas numeradas em sequência, em qualquer profundidade);
  `Enter` salva e vai à próxima pendente; `j`/`k` próxima e anterior; `n`
  cria um item já aplicado; `e` modo de edição; `?` ajuda.
- R26. Só `Enter` (ou o botão) grava. O painel começa com os itens da
  correção vigente, ou do bot quando só ele corrigiu.
- R27. Modo de edição no próprio painel: criar, editar, dividir, apagar
  itens, mudar a base e renomear grupos, com sugestão de caminhos
  existentes. Antes de gravar uma mudança que mexe em notas, mostra na
  página (sem `confirm()`) o resultado de `preview`: "muda a nota de N
  respostas, M já liberadas".
- R28. `grading/[question]?view=list` mantém a lista atual, com os itens
  aplicados em cada resposta.
- R29. A fila `grading/` mostra "N rever" por questão.
- R30. A revisão da tentativa (aluno, depois da liberação) e a tentativa do
  aluno (professor) mostram os itens aplicados com valor e feedback, e
  depois o comentário livre. O professor vê também o `comment` de cada
  item.

### CLI

- R31. As rotas de R21 entram em `ENDPOINTS` de `cli/codehood/api/generate.py`
  e `cli/codehood/api/generated.py` é regerado. Nenhum comando novo.

### Dados de dev

- R32. `src/db/bootstrap.ts` semeia a prova `test-07` (COMPLETED) com uma
  questão de código e uma dissertativa, cobrindo:
  - rubrica inicial não copiada (questão de código com
    `privatePayload.rubric` e nenhuma correção pela rubrica);
  - rubrica em uso na dissertativa: base 0, grupo `Recursão` com folhas em
    profundidade 3, dois itens soltos, um negativo, um item arquivado por
    `split`;
  - hopper e hamilton corrigidos pela rubrica (hamilton com `adjustment`);
  - liskov em "rever";
  - bob corrigido pelo bot `runner` com itens;
  - duas respostas pendentes com o mesmo texto e uma diferente;
  - notas liberadas para a prova, para a visão do aluno de hopper.

## Fora do escopo

- Rubrica escrita no mdq (`[rubric]`): issue no repositório do mdq. O
  servidor só lê o formato provisório de R13.
- De-duplicação de verdade (aplicar a mesma correção a várias respostas de
  uma vez) e detecção de cola.
- Respostas âncora por item, calibração entre corretores, monitores como
  corretores.
- Rubrica nas lacunas de fill-in (continua o `blanks`).
- chalk aplicando itens da rubrica a partir dos testes.
- Comandos de rubrica na CLI.
- Escopo de chaves `BOT`.

## Plano de ação

- T1. Banco (`haiku`). `prisma/schema.prisma` (R1 a R4), `db push`,
  `src/db/branding.ts` se couber. Pronto quando `pnpm run db:reset` roda e
  `pnpm run typecheck` sai 0.
- T2. Rubric service (`sonnet`, TDD). `src/core/schemas/rubric.ts`,
  `src/db/services/rubric.service.ts`, registro em `src/db/`, um módulo puro
  em `src/services/rubric.ts` para R5 a R7 e R11 (parse de caminho, nota,
  exclusão por grupo). Requisitos R5 a R18. Depende de T1. Pronto quando os
  testes do projetista passam: cópia na primeira escrita, recálculo em
  base/valor/apagamento, split mantendo nota e marcando "rever",
  renameGroup, preview sem efeito.
- T3. Feedback com rubrica (`sonnet`, TDD). `src/core/schemas/feedback.ts`,
  `src/db/services/feedback.service.ts`, `src/services/grading.ts`.
  Requisitos R19, R20. Depende de T2. Pronto quando os testes provam nota
  calculada, as recusas de R19 e a visão filtrada do aluno.
- T4. Permissões e REST (`sonnet`, TDD). `src/auth/permissions/`,
  `src/api/index.ts`, `test/bruno/`. Requisitos R21, R22. Depende de T3.
  Pronto quando um teste REST com chave `BOT` cria item, aplica e lê a nota,
  um aluno leva 403 e uma questão fora da prova dá 404.
- T5. Seed (`haiku`). `src/db/bootstrap.ts`, R32. Depende de T4. Pronto
  quando `pnpm run db:reset` roda e `GET /rubric` da questão de código
  devolve `initial: true`.
- T6. Histórias e e2e (`sonnet`). `docs/user-stories/instructor.md`,
  `docs/user-stories/student.md`, `test/stories/`. Uma história longa do
  professor (corrige pelo teclado, cria item no meio, divide, vê "rever",
  muda valor com aviso) e uma do aluno (vê os itens aplicados, não vê o
  comentário privado). Depende de T5. Pronto quando falham porque a tela
  não existe.
- T7. Telas (`sonnet`). `grading/[question].astro`, componentes novos em
  `src/components/grading/`, `grading/index.astro`, as vistas de tentativa,
  mensagens en e pt-BR. Requisitos R23 a R30. Depende de T6. Pronto quando
  as histórias de T6 passam.
- T8. CLI (`sonnet`). `cli/codehood/api/generate.py`, `generated.py`, R31.
  Depende de T4. Pronto quando `rtk uv run pytest` passa em `cli/`.
- T9. Fechamento (coordenador). `pnpm exec biome check --write .`,
  `pnpm run lint`, testes afetados, seed conferido no dev server, glossário
  (já feito), changelog, spec para `to-review/`.

## Critérios de aceite

- Testes de T2 a T4 passando, com saída.
- Histórias de T6 passando.
- URL do dev server com a `test-07` para o humano corrigir pelo teclado:
  criar um item no meio, dividir, mudar um valor e ver o aviso e o
  recálculo.
- Visão do aluno hopper com os itens aplicados e sem o comentário privado.
