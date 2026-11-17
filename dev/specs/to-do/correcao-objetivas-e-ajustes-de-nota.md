---
type: spec
status: to-do
tags: [grading, exams, ui, audit]
relatedTo: [sancao-de-nota, question-statistics, regrade-requests, rubrica-de-correcao, per-student-exceptions]
created: 2026-11-17
creator: claude
---

# Correção de questões objetivas e ajustes de nota

## Contexto

Duas coisas que se tocam: a tela de correção de uma questão corrigida
automaticamente, e o poder do professor de mudar uma nota depois da correção.

**Parte A.** A página `grading/[question].astro` já pula a rubrica e o botão de
modo para questão automática (commit 8074066: `isAutoGraded` em
`src/utils/question-display.ts`, `responseSummary` e `summaryGroups` em
`src/services/response-summary.ts`, `SummaryDistribution.astro`,
`PassHistory.astro`). Falta a tela em si. O desenho validado está nos mockups
de `src/pages/design/playground/correcao-objetivas/` (commit cc17c2e). Esta spec
transforma os mockups na página real. O princípio é mostrar só a informação
que leva a uma ação: nada de lista resposta por resposta.

**Parte B.** Hoje o professor só reduz nota (`ExamSanction`, spec
`sancao-de-nota`). Faltam três coisas que aparecem em aula:

- "o melhor projeto vale 10 na prova 2";
- "a nota da prova 2 é substituída pela do projeto";
- prova de reposição.

Também falta corrigir uma questão cujo gabarito estava errado sem mexer na
chave de todo mundo, e dar nota a quem não fez a prova. Esta spec generaliza
a sanção em **ajuste de nota** (substituir, multiplicar, somar) e permite
alterar a nota de uma questão pela página do aluno e pelo diálogo da correção.

Esta spec **substitui** as regras de composição da `sancao-de-nota` (R4, R9 a
R13: uma sanção ativa por alvo, "a mais dura vence", fator em `[0, 1)`). O
resto dela (permissões, visibilidade para o aluno, bloqueio de revisão,
telas) segue valendo com o novo nome.

## Glossário

- **Ajuste de nota** (`ExamAdjustment`): decisão do professor que substitui,
  multiplica ou soma a nota de um aluno numa prova, ou multiplica a de uma
  questão. Aplicada por cima de toda correção; revogável. Substitui
  **Sanção**.
- **Sanção**: um ajuste que reduz a nota (penalidade, fator < 1). Deixa de ser
  um model e vira um uso do ajuste. `GLOSSARY.md` muda de acordo (T8).
- **Tentativa vazia**: `Response` criada pelo servidor para um aluno que não
  fez a prova, só para ter onde prender um ajuste.
- **Alteração manual**: questão cujo passe de correção mais novo é humano
  (`Feedback.graderId` preenchido) e que já teve outro antes, ou que o
  professor criou por cima de uma resposta em branco.

## Requisitos

### A. Página de correção de questão objetiva

Rota: `src/pages/[discipline]/[course]/exams/[slug]/grading/[question].astro`.
Vale para toda questão com `isAutoGraded(doc)` (automática e não `code`).

- A1. Título da questão com setas estreitas de anterior e próxima. A de anterior
  fica pendurada na margem (`lg:absolute lg:right-full`), como em
  `_Frame.astro`. As setas encaminham `?view=` para uma questão manual manter
  o seu modo (lista ou uma por vez). Por quê: quem corrige em sequência não
  deve perder o modo ao cruzar uma questão objetiva.
- A2. "Enunciado e gabarito" no topo, num `<details>` fechado: cabeçalho
  `bg-base-200/50`, corpo `bg-base-200/25`, as cores do `QuestionFrame`. O
  corpo é `AnswerKey`. Por quê: o professor já conhece a questão; o gabarito
  é conferência, não leitura.
- A3. Linha de resumo: número de respostas, % corretas, selo "discriminação
  baixa" quando `questionStats` a marca, e "N sem nota" só se N > 0 (âncora
  para "Requer atenção").
- A4. "Requer atenção" só aparece quando não vazia. Dois tipos de linha:
  - **Sem nota**: resposta sem passe de correção, com campo de nota 0 a 100,
    "Marcar como certa" e "Dar nota" (como em `_Frame.astro`).
  - **Revisão pedida**: pedido de revisão aberto (`RegradeRequest` OPEN), com
    botão `message-square-text` ("Ver pedido") que leva a `regrades.astro`.
  Botões de ícone, com `aria-label` e `title`. Detectar resposta suspeita e
  "Ignorar" ficam fora (ver "Fora do escopo"): a página não tem linha de
  suspeita, nem os botões `gavel` e `eye-off`. Por quê: não há detector nem
  lugar para guardar o "ignorado", e a ideia fica registrada em
  `dev/issues/respostas-suspeitas-na-correcao.md`.
- A5. Um componente de tabela agrupada, reutilizável por todos os tipos
  (`src/components/grading/GroupedAnswers.tsx`, a partir de
  `_GroupedAnswers.tsx`). Colunas:
  1. **Resposta**: radio (escolha única) ou checkbox (seleção múltipla)
     somente leitura, texto e barra proporcional ao maior grupo.
  2. **Alunos**: contagem e %.
  3. **Nota dada**: nota do passe de correção do grupo; "varia" quando os
     membros divergem por alteração manual. É a nota do passe, não o total
     ajustado.
  4. **Marcação**: média dos alunos do grupo nas outras questões da prova,
     com o %, e o rótulo "esperado" ou "revisar" (`diagnosis` presente). "–"
     abaixo de 3 alunos no grupo. Por quê: um distrator escolhido por quem vai
     bem no resto da prova indica gabarito suspeito; com menos de 3 alunos a
     média é ruído.
  5. **Ícone de pessoas**: abre um diálogo (`Dialog.tsx`) com os alunos do
     grupo, ordenável; cada um tem um lápis "Alterar nota" (R12).
- A6. Particularidades por tipo, todas sobre o mesmo componente:
  - **Múltipla escolha**: uma linha por alternativa.
  - **Múltipla seleção**: primeiro por alternativa (quanto foi marcada contra o
    gabarito), depois as combinações mais comuns como caixas A..E (marcada /
    no gabarito) e "outras".
  - **Verdadeiro ou falso**: por afirmação, com a divisão V/F e a coluna
    "Erraram".
  - **Resposta curta**: por texto distinto, com "Aceita?".
  - **Lacunas**: um bloco por lacuna (valor, contagem, "Aceita?").
  - **Numérica**: histograma dos valores com a faixa de tolerância marcada, uma
    janela ampliada e um bloco "fora da janela"; abaixo, os grupos por valor e
    erro típico.
  - **Ordenação**: matriz etapa por posição (diagonal é o gabarito) e as
    ordens inteiras agrupadas.
- A7. "Alteradas à mão (N)": tabela simples, sem colapso, só quando N > 0.
  Colunas: aluno, tipo ("Nota alterada" ou "Sanção"), nota (automática
  riscada e final), comentário, quando. Botões de ícone `pencil` ("Alterar
  nota") e `undo-2` ("Desfazer", que grava um passe que volta à nota
  automática, sem apagar histórico).
- A8. Editar a questão é um FAB (`btn-circle btn-primary`, ícone de lápis) no
  canto, com `aria-label`. Há espaço no fim da página para o FAB não cobrir
  conteúdo.
- A9. Nomes dos alunos sempre visíveis em questão objetiva: o rodízio de
  anonimato (`?names=1`, `wantsNames`) continua só nas questões manuais. Por
  quê: não há viés de correção numa nota que o servidor já deu, e o professor
  precisa saber quem é quem para agir.
- A10. Sem ações em grupo. Corrigir o gabarito passa pela issue
  `dev/issues/repinar-versao-nao-recorrige-objetivas.md`, que esta spec
  atualiza: a recorreção ao fixar outra versão **pula** a resposta cujo passe
  mais novo é humano (`graderId` preenchido e `botId` nulo), e grava um passe
  `auto` novo nas demais, sem apagar o histórico. A implementação da issue
  fica fora desta spec; só o texto da issue muda (T5).
- A11. Enquanto a issue não é implementada, a página mostra a nota fixa
  ("role=note", `alert-info`): fixar uma nova versão **não** corrige de novo
  as respostas existentes; use "Alterar nota".
- A12. Bug conhecido: o `AnswerKey` mostra rótulos em inglês ("Correct order",
  "Blank 1 of 3"). Os textos vêm de `../mdq/mdq-js/src/solid/messages.tsx`,
  que já tem o dicionário `ptBR`; as chamadas do Codehood passam
  `mdqMessages` (`QuestionPreview.tsx`, `AnswerView.tsx`, `AnswerField.tsx`).
  Achar o ramo da chave de resposta que escapa disso e corrigir. Se a causa
  estiver no mdq, a correção é lá e o `.mdq-ref` avança (`pnpm run mdq:bump`).
  Teste: a página de uma questão de ordenação e uma de lacunas, em pt-BR,
  sem as strings inglesas.

### B. Alterar a nota de uma questão

- B1. Na página da tentativa (`attempts/[username].astro`) e no diálogo de
  alunos da correção (A5), cada questão tem "Alterar nota": "Marcar como
  certa" (100) ou outra nota de 0 a 100, mais um comentário. Chama
  `actions.grading.grade`, que grava um passe manual
  (`recordPass`). Por quê: é a ferramenta que já existe, com histórico e
  permissão; o passe mais novo vence, então uma recorreção do bot não
  desfaz (o passe humano é mais novo; a issue da A10 trata o caso inverso).
- B2. A nota vale para **a questão inteira**, inclusive lacunas e
  verdadeiro/falso (não há nota por parte nem por lacuna aqui).
- B3. Questão em branco: não há submissão onde pendurar o passe. Uma operação
  nova de service, só do instrutor, cria numa transação:
  - uma `Submission` com `kind: AUTOSAVE`, `payload` nulo e
    `status: GRADED_MANUALLY`, marcada como criada pelo professor (B4);
  - o passe manual.
  O `payload` continua `Json` obrigatório e guarda o JSON `null`
  (`Prisma.JsonNull`). Por quê: `isBlank` e `responseSummary` já tratam
  payload nulo, então não há migração de coluna. Teste: escrever e ler de
  volta o `null`. Se o Prisma recusar `JsonNull` na coluna obrigatória, a
  coluna passa a `Json?` e a spec registra a troca.
  Ela **não** passa por `assertAcceptingSubmissions`, porque a tentativa está
  fechada. Nunca cria `FINAL` nem `SUBMIT`: `examResult` trata essas duas como
  questão `code` enviada e muda o caminho da nota (`codeOutcomeOf`).
- B4. Campo novo `Submission.createdById String?` (relação com `User`,
  `onDelete` restrito como `Feedback.graderId`). Nulo em toda submissão do
  aluno; preenchido só nas do professor. Por quê (contra um booleano): diz
  quem criou, que é o que uma auditoria pergunta, e custa a mesma coluna.
  Campo análogo `Response.createdById String?`, preenchido só na tentativa
  vazia (E1). O que o professor criou, tentativa e submissão, sai das
  estatísticas (`closedAttemptCount`, `questionStats`, `scoreRows`,
  `answerDistribution`, `countingAnswers`, discriminação): não mede a questão,
  mede a decisão do professor. Por quê: só o que o professor criou sai; a
  tentativa do aluno sem submissões continua contada, como hoje.
  Uma alteração de nota sobre resposta real do aluno **continua** nas
  estatísticas: elas descrevem o que o aluno respondeu, e é o que faz a
  correção de gabarito aparecer em "% corretas".
- B4a. Ao fechar uma tentativa, a promoção do último autosave a `FINAL` pula as
  submissões com `createdById` preenchido (`answer-edit.service.ts` e onde mais
  a promoção ocorra). Por quê: a tentativa pode ser reaberta, e a submissão do
  professor não pode virar `FINAL` e entrar no caminho de `code`. Teste:
  alterar nota em branco, reabrir, fechar de novo; a submissão segue
  `AUTOSAVE`.
- B5. Alterar nota exige a mesma condição da B3 para a tentativa estar
  encerrada para o aluno (R17 abaixo), exceto quando já existe resposta real:
  corrigir uma resposta sempre foi possível durante a prova (o passe é um
  `Feedback`, não uma submissão).

### C. Ajuste de nota (`ExamAdjustment`)

Renomeia `ExamSanction` e acrescenta operação e valor.

- C1. Model `ExamAdjustment` em `prisma/schema.prisma`, `ExamSanction`
  removido. Campos mantidos: `publicId`, `responseId`, `questionRefId?`,
  `reason` (para o aluno), `notes` (do professor), `createdById`,
  `revokedAt`/`revokedById`, `createdAt`/`updatedAt` e os índices. Campos
  novos:

  ```prisma
  enum ExamAdjustmentOp {
    /// Replaces the total.
    SET
    /// Multiplies the total, or the score of one question.
    FACTOR
    /// Adds to the total.
    OFFSET
  }

  /// How the operation reads `value`: SET and FACTOR as a fraction of the
  /// exam total (SET in [0, 1], FACTOR in [0, 2]), OFFSET in [-1, 1], not 0.
  op    ExamAdjustmentOp
  value String
  ```

  `factor` sai (o `FACTOR` agora é uma operação). Por quê: um campo `factor`
  não expressa "some 10 pontos" nem "a nota é 80%".
- C2. Sem migração de dados: nenhum deploy tem linha de sanção real. A
  migração do release apaga e recria a tabela, autorizado pelo usuário. O
  `pnpm run release` vai acusar perda de dados e `--allow-data-loss` é
  aceitável (T1 deixa o aviso no commit). Em
  desenvolvimento, `prisma db push` e `pnpm run db:reset`.
- C3. Faixas de `value` (decimal em string, validado no schema Zod e no
  service):
  - `SET`: `[0, 1]`; `FACTOR`: `[0, 2]`; `OFFSET`: `[-1, 1]` e `≠ 0`.
  - Alvo numa questão (`questionRefId` preenchido) só aceita `op: FACTOR`
    com `value < 1` (só reduz). `SET` e `OFFSET` valem só para a prova. Por
    quê: bônus numa questão estouraria a questão sem teto claro; para dar
    mais nota numa questão, o professor altera a nota (B1).
- C4. Unicidade, garantida pelo service (não por índice único, como na
  `sancao-de-nota`): por tentativa, no máximo um `SET` ativo (um segundo é
  recusado, com a mensagem "edite o existente"); no máximo um ajuste ativo por
  questão; qualquer número de `FACTOR` e `OFFSET` no total da prova. Por quê:
  dois `SET` não têm ordem natural; vários bônus e penalidades se compõem sem
  ambiguidade.
- C5. Ajuste cuja questão saiu da prova num push fica no banco e é ignorado no
  cálculo (herda a R5 da `sancao-de-nota`).
- C6. Formulários recebem **porcentagem** (10 = 10%). A conversão para a
  fração `"0.1"` é na borda do formulário (`src/forms/`), e a REST e as
  Actions recebem a fração. Por quê: o professor pensa em "10%", e o
  armazenamento em fração mantém uma só unidade em `examResult`. Ver Q8 para
  o que "10" significa em cada operação.
- C7. Service `src/db/services/exam-adjustment.service.ts` (renomeado de
  `exam-sanction.service.ts`): `create`, `update`, `revoke`, `findMany`, com
  as recusas da `sancao-de-nota` mais as de C3 e C4.
- C8. `response.delete` recusa (409) tentativa com ajuste ativo, como já fazia
  com sanção ativa. Tentativa vazia só sai com o ajuste revogado.

### D. Composição na nota (`examResult`)

Em `src/services/exam-result.ts`, nesta ordem:

- D1. **Questão**: o `FACTOR` ativo da questão multiplica a nota dela, só se
  positiva (regra de hoje: fator nunca multiplica nota negativa). `QuestionOutcomeStatus` `"sanctioned"` continua, e
  `sanction` na questão vira `adjustment` com `{ op, value, reason,
  original }`.
- D2. **Total**: `base` = `value` do `SET` ativo, se houver; senão o total
  calculado das questões (já com D1).
- D3. Multiplica `base` por todos os `FACTOR` do total, só se `base` é
  positiva; um fator nunca multiplica total negativo, inclusive fator > 1.
  Por quê: multiplicar negativo por fator < 1 melhoraria a nota, contra o
  sentido de uma penalidade.
- D4. Soma todos os `OFFSET`.
- D5. Trava em `[min(base, 0), 1]`: o total não passa de 100% e, se a base já
  era negativa, o resultado não fica abaixo dela. Por quê: nota negativa
  existe no modelo (`[-1, 1]`) e um bônus não deve piorá-la; o teto de 100% é
  decisão do professor.
- D6. **Fator 0 é terminal**: qualquer `FACTOR` com valor 0 dá total 0,
  ignorando `SET` e `OFFSET`. Por quê: é o "zerar" da sanção original, que
  deve continuar zerando.
- D7. Com `SET` ou fator 0, o total é definido mesmo com questões pendentes e
  `pending` vale 0. Sem eles, o total segue `null` com pendência, como hoje.
  Por quê: o professor fixou a nota, então esperar a correção da questão não
  faz sentido; e `exam.release-grades` não pode travar por isso. Com `OFFSET`
  ou `FACTOR` > 0 e questão pendente o total segue `null` e a tela mostra
  "pendente" ao lado dos ajustes: aceito.
- D8a. O pedido de revisão só é bloqueado por ajuste ativo que **reduz**:
  `FACTOR < 1`, no total ou numa questão. Bônus, `SET` e `OFFSET` não
  bloqueiam (blocker `sanctioned` de `regradeBlocker`). Por quê: o bloqueio
  existe para sanção; um bônus ou uma substituição não tira do aluno o
  direito de contestar a correção.
- D8. `ExamResult.sanction` vira `adjustments: { op, value, reason }[]`, em
  ordem de aplicação (SET, depois fatores, depois somas), mais
  `original.total` (o total antes de qualquer ajuste do total).
- D9. `ResultSanction` vira `ResultAdjustment` (`{ question | null, op, value,
  reason }`); `sanctionsByResponse` vira `adjustmentsByResponse`; as 12
  chamadas de `examResult` mantêm o parâmetro obrigatório.

### E. Tentativa vazia

- E1. `examAdjustment.create` e a alteração de nota em branco (B3) criam
  automaticamente, para o aluno sem tentativa, uma `Response` com
  `acceptingSubmissions: false`, `closedAt: now`, `slotKey: 0`,
  `preview: false`, sem submissões e com `createdById` do professor (B4).
- E2. Condições, todas recusadas com erro claro:
  - só o instrutor do curso (`course.update-contents`);
  - o aluno precisa estar matriculado;
  - nunca em prova `PRACTICE`;
  - a prova não pode estar aberta nem por abrir **para aquele aluno**: vale o
    que `examPhase(attemptTiming(...))` diz com a exceção do aluno
    (`ExamException`) aplicada. Por quê: o ajuste não pode adiantar a
    nota de quem ainda pode responder.
- E3. A tentativa vazia segue a regra de unicidade `(autor, prova, slotKey)`:
  se o aluno já tem tentativa, ela é usada, não se cria outra.
- E4. Dinâmicas que motivam: "o melhor projeto vale 10 na prova 2",
  "substituir a nota da prova 2 pela do projeto" (`SET` com o valor do
  projeto), prova de reposição (`SET`).

### F. O que o aluno vê

Depois da liberação das notas (mesma regra de `feedback.read` da
`sancao-de-nota`), em `exams/[slug].astro` e na revisão:

- F1. O total original, uma linha por ajuste com o motivo, e o total final.
  Textos:
  - `SET`: "Nota substituída por 80%";
  - `FACTOR` > 1: "Bônus ×1,1";
  - `OFFSET` > 0: "Bônus +10";
  - `OFFSET` < 0: "Penalidade −10";
  - `FACTOR` < 1: "Penalidade ×0,5".
- F2. Tentativa vazia: "Você não fez esta prova", mais as linhas de ajuste.
- F3. Questão com ajuste mostra o selo na questão (hoje "Zerada"; passa a
  "Penalidade ×0,5", com "Zerada" para fator 0).
- F4. Textos novos em `messages/pt-BR` e `messages/en`; chaves renomeadas de
  `sanction` para `adjustment`.

### G. Telas do professor

- G1. Página da tentativa, como no mockup `aluno-bonus` do playground
  `correcao-objetivas`:
  - as questões aparecem como na prova aplicada (`QuestionFrame`, "Qn" e
    pontos ao lado) e uma barra Q1…QN fixa no topo leva a cada questão, com a
    cor do estado (certa, parcial, errada, em branco, alterada à mão);
  - à direita do nome do aluno, três botões de ícone: "Sancionar" (alvo prova
    ou questão, zerar ou porcentagem que fica, motivo), "Adicionar bônus"
    (somar pontos, multiplicar ou substituir a nota, motivo e prévia do total)
    e "Lista de alunos";
  - "Lista de alunos" abre um diálogo com todos os alunos da prova, busca e
    colunas ordenáveis (aluno, matrícula, usuário, total, situação: pendente,
    sem tentativa, ajustada, entregue). A busca também casa a matrícula
    (`User.schoolId`, "—" quando ausente), que os alunos lembram melhor que o
    nome de usuário. As setas anterior/próximo ficam como
    atalho: com 80 alunos, passar um a um não serve para achar alguém;
  - por questão, o lápis "Alterar nota" (B1);
  - o resumo "Ajustes de nota" lista o total original, um ajuste por linha
    (alterar, remover) e o total final.
- G2. `sanctions.astro` vira `adjustments.astro`: lista ativos e revogados;
  criação em lote por nomes de usuário, **inclusive de aluno sem tentativa**
  (E1); edita e revoga. Item no `examNav` com o contador de ativos.
- G3. Tabelas de resultados e de notas mostram o efeito líquido (total
  original riscado e total final) com link para a página de ajustes.
- G4. Na correção de uma questão, selo só para ajuste cujo alvo é a questão.
- G5. `results.astro`: o botão "Sancionar selecionados" vira "Ajustar
  selecionados".

### H. REST, CLI e dados de dev

- H1. Rotas renomeadas de `.../exam/[slug]/sanction` para
  `.../exam/[slug]/adjustment` (e `/adjustment/[id]`, `/adjustment/[id]/revoke`).
  Permissões `exam-sanction.*` viram `exam-adjustment.*` (mesma tabela, só o
  instrutor do curso, `system: false`, bot nunca ajusta). Actions
  `exam-sanction.ts` viram `exam-adjustment.ts`.
- H2. Corpo de criação: `usernames`, `question?`, `op`, `value`, `reason?`,
  `notes?`. Regerar com `pnpm run openapi:cli` **na mesma tarefa**; a CLI não
  envia estado só de servidor (`createdById` de submissão não existe nos
  corpos de criação e atualização).
- H3. Seed (`src/db/bootstrap.ts`), só em provas que já existem
  (`quiz-01`, `test-01` a `test-03`, `quiz-02`, `midterm`, `final`,
  `practice`, `cs201/test-trees`), conforme a regra do `CLAUDE.md`:
  - um ajuste de cada operação (`SET`, `FACTOR` de bônus, `FACTOR` de
    penalidade, `OFFSET` positivo e negativo);
  - uma tentativa vazia;
  - uma alteração de nota em questão em branco;
  - os estados que a tela objetiva precisa (A4: sem nota, revisão pedida;
    A7: alteradas à mão), numa prova encerrada com questões objetivas.
  Os exemplos atuais de sanção (linhas ~2082, ~3146, ~3156, ~3797 a ~3828)
  passam a `FACTOR < 1` ou `FACTOR 0`.

## Fora do escopo

- Implementar a recorreção ao fixar outra versão (issue
  `repinar-versao-nao-recorrige-objetivas.md`); aqui só se atualiza o texto.
- Detectar respostas suspeitas e "Ignorar" na correção objetiva
  (`dev/issues/respostas-suspeitas-na-correcao.md`).
- Anular questão para a turma (`dev/issues/anular-questao.md`).
- Ações em grupo na página objetiva.
- Comandos de ajuste na CLI.
- Histórico geral de alterações de nota (`dev/issues/historico-de-notas.md`).
- Migração de sanções existentes (não há).

## Questões em aberto

Nenhuma. Q8 (unidade do formulário) foi aceita pelo usuário: `SET` e
`OFFSET` em pontos percentuais (10 = 0,10 do total); `FACTOR` em
"porcentagem da nota que fica" (50 = ×0,5; 110 = ×1,1), com rótulo no campo.

## Plano de ação

Ordem: T1, depois T2. T3 e T4 em paralelo depois de T2. T5 pode começar depois
de T1 (usa os selos). T6 depende de T3 e T4. T7 depende de T2 e T4. T8 por
último. Todos para implementadores `sonnet`, com TDD: escrever primeiro os
testes listados (de preferência `unit`).

### T1. Renomear, model e regras do service (sozinha)

Toca tudo; nenhuma outra tarefa roda junto. Sem mudança de cálculo (a conta
continua a de fator até T2).

- Testes primeiro: adaptar `test/exam-sanction-service.spec.ts` para
  `exam-adjustment-service.spec.ts` com as recusas de C3 e C4 (segundo `SET`,
  bônus em questão, fora de faixa, `OFFSET` 0); `exam-sanction-form-schema.spec.ts`
  vira `exam-adjustment-form-schema.spec.ts` com porcentagem (C6).
- Arquivos: `prisma/schema.prisma` (model, enum, relações em `Response`,
  `QuestionRef`, `User`), `src/core/schemas/exam-adjustment.ts`,
  `src/db/services/exam-adjustment.service.ts`, `src/db/active-adjustments.ts`,
  `src/db/index.ts`, `src/auth/permissions/index.ts`, `src/actions/index.ts`
  e `src/actions/exam-adjustment.ts`, `messages/{pt-BR,en}/*.json`.
- Aceite: `pnpm run db:reset`, `pnpm run typecheck` e `pnpm run test:unit`
  saem 0; `grep -ril sanction src prisma messages test` só acha o termo
  "sanção" como texto de penalidade (e `ExamSanction` em lugar nenhum).
- Raio de ação (de `grep -rli sanction`, fora `node_modules`, `.git`,
  `.claude/skills`):
  - `prisma/schema.prisma`;
  - `src/db/`: `bootstrap.ts`, `index.ts`, `active-sanctions.ts`,
    `services/exam-sanction.service.ts`, `exam.service.ts`,
    `grading-job.service.ts`, `regrade-request.service.ts`,
    `response.service.ts`;
  - `src/core/schemas/`: `all.ts`, `exam-sanction.ts`, `grade-column.ts`;
  - `src/auth/permissions/index.ts`; `src/actions/`: `exam-sanction.ts`,
    `index.ts`; `src/api/`: `index.ts`, `registry/route-patterns.json`;
  - `src/services/`: `exam-result.ts`, `grades-table.ts`, `grading.ts`,
    `regrade.ts`;
  - `src/utils/`: `course-grades.ts`, `exam-nav.ts`, `load-attempt-view.ts`,
    `load-exam-staff.ts`, `load-grading.ts`, `load-instructor-home.ts`,
    `load-review.ts`, `load-student-home.ts`;
  - `src/components/`: `exam/ExamAttempt.tsx`, `grading/ExamResults.tsx`,
    `grading/GradesTable.astro`, `grading/SanctionActions.tsx`,
    `grading/SanctionDialog.tsx`, `grading/SanctionModal.tsx`;
  - páginas em `src/pages/[discipline]/[course]/exams/`: `index.astro`,
    `[slug].astro`, `[slug]/attempts/[username].astro`,
    `[slug]/exceptions.astro`, `[slug]/grading/[question].astro`,
    `[slug]/preview.astro`, `[slug]/results.astro`, `[slug]/sanctions.astro`;
  - `messages/{pt-BR,en}/`: `errors.json`, `exams.json`, `forms.json`,
    `grades.json`;
  - `cli/codehood/api/generated.py`, `cli/resources/openapi/codehood.json`
    (T3 regera);
  - testes: `test/api-exam-sanction.spec.ts`, `bruno/exam-sanction/*`,
    `conditional-write-sweep.spec.ts`, `course-grades-sanction.spec.ts`,
    `exam-nav.spec.ts`, `exam-release-grades.spec.ts`,
    `exam-result-code.spec.ts`, `exam-result.spec.ts`,
    `exam-sanction-form-schema.spec.ts`, `exam-sanction-service.spec.ts`,
    `exam-state.spec.ts`, `fill/fill.ts`, `grades-table.spec.ts`,
    `grading-results.spec.ts`, `regrade-request-service.spec.ts`,
    `regrade.spec.ts`, `response-service.spec.ts`,
    `stories/instructor-grading.test.ts`, `stories/sanction-support.ts`,
    `stories/student-exams.test.ts`;
  - docs: `CHANGELOG.md`, `GLOSSARY.md`, `docs/user-stories/{coverage,instructor,student}.md`,
    `dev/specs/to-review/sancao-de-nota.md` (fica como história).

### T2. Matemática em `exam-result` e tabela de composição

- Testes primeiro: blocker de revisão só com `FACTOR < 1` (bônus, `SET` e
  `OFFSET` não bloqueiam); tabela de casos em `test/exam-result.spec.ts` (e
  `exam-result-code.spec.ts`): `SET` sozinho; `SET` com `FACTOR` e `OFFSET`;
  vários `FACTOR`; vários `OFFSET`; teto de 100%; base negativa com bônus;
  fator 0 terminal (ignora `SET` e `OFFSET`); `SET` e fator 0 com questão
  pendente (total definido, `pending` 0); `OFFSET` com pendência (total
  `null`); `FACTOR` de questão sobre nota negativa; questão `code`;
  ajuste de questão que saiu da prova.
- Arquivos: `src/services/exam-result.ts` (D1 a D9), `src/services/regrade.ts`
  (blocker, D8a), `src/services/grading.ts` (`attemptRows`),
  `src/services/grades-table.ts`, `src/services/exam-state.ts`.
- Aceite: a tabela passa; `pnpm run test:unit` e `typecheck` saem 0; as 12
  chamadas de `examResult` seguem com o parâmetro obrigatório.
- Raio de ação: os arquivos de `src/services/` acima, mais os que chamam
  `examResult` (a lista da R9 da `sancao-de-nota`).

### T3. API, `openapi:cli` e bruno (paralela a T4)

- Testes primeiro: `test/api-exam-adjustment.spec.ts` (e2e) com instrutor,
  aluno antes e depois da liberação e chave de bot; `test/openapi-snapshot.spec.ts`
  e `cli/tests/test_generated_in_sync.py`.
- Arquivos: `src/api/index.ts` e `registry/route-patterns.json` (rotas de
  H1), `test/bruno/exam-adjustment/*` (renomeado), `pnpm run openapi:cli`,
  corpos de H2.
- Aceite: os três specs passam; a CLI não tem campo só de servidor nos
  corpos.
- Raio de ação: `src/api/`, `cli/resources/openapi/codehood.json`,
  `cli/codehood/api/generated.py`, `test/bruno/`.

### T4. Tentativa vazia, alteração em branco, marcador e estatísticas

- Testes primeiro (`unit`): ida e volta do JSON `null` no `payload`; promoção a `FINAL` pula
  submissão com `createdById` (alterar em branco, reabrir, fechar); tentativa
  e submissão do professor fora de `closedAttemptCount`, `questionStats`,
  `scoreRows` e discriminação, tentativa do aluno sem submissões ainda
  contada; tentativa vazia criada pelo `create` e pela
  alteração em branco; recusas de E2 (prova aberta, por abrir, com exceção,
  `PRACTICE`, aluno não matriculado, não instrutor); alteração em branco cria
  submissão `AUTOSAVE` com `createdById` e passe manual numa transação (falha
  no meio não deixa submissão); estatísticas ignoram submissão com
  `createdById` e mantêm a alteração sobre resposta real.
- Arquivos: `prisma/schema.prisma` (`Submission.createdById`, `Response.createdById`),
  `src/db/services/submission.service.ts` (operação só do instrutor, sem
  `assertAcceptingSubmissions`), `src/db/services/response.service.ts`
  (criar tentativa vazia), `src/services/question-stats.ts` (`scoreRows`,
  `questionStats`, `countingAnswers`, `answerDistribution`),
  `src/db/services/objective-grading.ts` (não tocar submissão do professor).
- Aceite: specs `unit` passam; nenhuma submissão `FINAL` ou `SUBMIT` é criada.
- Raio de ação: `submission.service.ts`, `response.service.ts`,
  `question-stats.ts`, `objective-grading.ts`, `answer-edit.service.ts`
  (promoção de autosave, B4a).

### T5. Página de correção de objetivas (Parte A)

Pode começar depois de T1.

- Testes primeiro: `test/stories/instructor-grading.test.ts` (história do
  professor numa objetiva: resumo, requer atenção (sem nota e revisão
  pedida), agrupadas, alterar nota
  pelo diálogo, desfazer); spec `unit` das funções puras que montam as linhas
  (agrupamento, média das outras questões, "–" abaixo de 3, "esperado" ou
  "revisar"); spec das setas encaminhando `?view=`; página de ordenação e de
  lacunas sem texto em inglês (A12).
- Arquivos: `src/pages/[discipline]/[course]/exams/[slug]/grading/[question].astro`,
  `src/components/grading/GroupedAnswers.tsx` (e `Dialog.tsx`, `Members.tsx`,
  `SortTable.tsx`, `Overrides.tsx` trazidos de
  `src/pages/design/playground/correcao-objetivas/`), os componentes
  por tipo (histograma numérico, matriz de ordenação), a função de resumo em
  `src/services/` (nova, pura), `messages/{pt-BR,en}/exams.json`,
  `dev/issues/repinar-versao-nao-recorrige-objetivas.md` (A10) e o ponto de
  A12.
- Aceite: os mockups de cada tipo têm equivalente na página real com o
  seed (T8); sem lista por resposta; `?names=1` não esconde nomes em
  objetiva; prev/next mantém `?view=` em manual; screenshots de cada tipo
  para o relatório. Nada do playground fica além do `index.astro` (o
  `pnpm run release` recusa).
- Raio de ação: `src/pages/design/playground/correcao-objetivas/` (some ao
  fim), `grading/[question].astro`, `src/components/grading/`.

### T6. UI do professor para ajustes e alterações

Depende de T3 e T4.

- Testes primeiro: história do professor (ajustar nota na página da
  tentativa com cada operação; alterar nota de questão em branco; ajuste em
  lote para aluno sem tentativa; revogar; ver o efeito líquido nas tabelas),
  e `test/exam-adjustment-form-schema.spec.ts`.
- Arquivos: `src/components/grading/AdjustmentDialog.tsx` (de
  `SanctionDialog`), `AdjustmentActions.tsx`, `AdjustmentModal.tsx`,
  `ExamResults.tsx`, `GradesTable.astro`,
  `attempts/[username].astro`, `adjustments.astro`, `src/utils/exam-nav.ts`.
- Aceite: G1 a G5; histórias passam.
- Raio de ação: a lista de componentes e páginas de T1.

### T7. UI do aluno

Depende de T2 e T4.

- Testes primeiro: história do aluno (antes da liberação, nada; depois, o
  total original, cada linha de ajuste, o total final e "Você não fez esta
  prova"; não consegue pedir revisão conforme D8a).
- Arquivos: `exams/[slug].astro`, `src/components/exam/ExamAttempt.tsx`,
  `src/utils/load-review.ts`, `src/utils/load-student-home.ts`,
  `messages/{pt-BR,en}/exams.json`.
- Aceite: F1 a F4; texto de cada operação bate com os exemplos da F1.

### T8. Seed, glossário, changelog e fechamento

- Arquivos: `src/db/bootstrap.ts` (H3), `GLOSSARY.md` (entradas **Ajuste de
  nota** e **Tentativa vazia**; **Sanção** redefinida como ajuste que reduz),
  `CHANGELOG.md`, `docs/user-stories/*`.
- Aceite: `pnpm run db:reset` e cada estado visível no dev server;
  `pnpm exec biome check --write .`, `pnpm run lint` e `rtk pnpm test` saem
  0; spec movida para `dev/specs/to-review/`.

## Critérios de aceite

- Os mockups de `correcao-objetivas/` têm página real equivalente para os
  sete tipos objetivos, com dados do seed, e "Requer atenção" só aparece
  quando há o que atender.
- Uma tabela de composição de `examResult` cobre D1 a D8 e passa, incluindo
  `SET` com questão pendente.
- Ajuste de nota por todas as operações pela UI, pela REST e pela Action,
  com a mesma recusa em cada borda (faixa, duplicidade de `SET`, bônus em
  questão).
- Aluno sem tentativa recebe um ajuste e vê "Você não fez esta prova" e o
  total; nenhuma recusa de E2 deixa linha no banco.
- Alterar a nota de uma questão em branco cria a submissão do professor e o
  passe numa transação, e a submissão do professor não entra em "% corretas"
  nem na discriminação da questão.
- Os rótulos de ordenação e lacunas da chave de resposta saem em português.
- `pnpm run openapi:cli` regerado; `test/openapi-snapshot.spec.ts` e
  `cli/tests/test_generated_in_sync.py` passam.
- `pnpm run lint` e `rtk pnpm test` saem 0.
