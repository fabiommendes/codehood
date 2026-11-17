---
type: stories
status: to-do
spec: correcao-objetivas-e-ajustes-de-nota
created: 2026-11-17
creator: claude
---

# Histórias de usuário: correção de objetivas e ajustes de nota

Roteiro para o tester escrever os testes de história da spec
`correcao-objetivas-e-ajustes-de-nota.md`. Cada roteiro abaixo é um
`test.step` (ou um grupo deles) dentro do teste de uma história do catálogo
`docs/user-stories/`. O catálogo guarda a promessa em poucas frases; este
arquivo guarda o passo a passo, o estado de partida e os requisitos cobertos.

## Convenções

- **Catálogo em inglês.** `docs/user-stories/instructor.md` e `student.md` já
  são em inglês, e o nome do teste repete o título da história
  (`test("instructor: <title>", ...)`). As histórias novas entraram lá em
  inglês, com `status: todo`. Este roteiro é em português.
- **Arranjo por service, ação pela UI** (`test/stories/README.md`). Os testes
  de história não usam o seed de dev: criam curso, prova e alunos com as
  factories e `FULL_ACCESS`, com nomes únicos por teste. O campo "Seed de dev"
  de cada roteiro diz em qual prova do `src/db/bootstrap.ts` o mesmo estado
  precisa existir para conferência manual (H3); o campo "Arranjo" diz o que o
  teste monta.
- **Apoio.** `test/stories/sanction-support.ts` (`gradedExam`: prova
  encerrada, duas questões de escolha, quatro alunos com 100%) serve de base
  para os roteiros de ajuste e deve virar `adjustment-support.ts` no T6.
  `test/stories/regrade-setup.ts` serve para os pedidos de revisão.
- **Uma falha é um passo, não uma história.** Recusas (faixa, segundo `SET`,
  prova aberta) são `test.step` dentro da história que elas interrompem.
- **Porcentagem na tela.** Os formulários recebem porcentagem (C6, Q8): `SET`
  e `OFFSET` em pontos percentuais, `FACTOR` em "porcentagem da nota que
  fica" (110 = ×1,1).

## Mapa: catálogo e roteiros

| História do catálogo | Arquivo de teste | Roteiros |
| :--- | :--- | :--- |
| instructor: Review an automatically graded question | `test/stories/instructor-grading.test.ts` | P1, P2 |
| instructor: Change the grade of one question | `test/stories/instructor-grading.test.ts` | P3 |
| instructor: Adjust a student's grade (hoje "Sanction a student's grade") | `test/stories/instructor-grading.test.ts` | P4, P5, P7 |
| instructor: Grade a student who did not take the exam | `test/stories/instructor-grading.test.ts` | P6 |
| instructor: Find a student in a large class | `test/stories/instructor-grading.test.ts` | P8 |
| student: See the adjustments to my grade (hoje "See that my grade was sanctioned") | `test/stories/student-exams.test.ts` | A1, A4 |
| student: See a grade for an exam I did not take | `test/stories/student-exams.test.ts` | A2 |
| student: See a question grade my instructor changed | `test/stories/student-exams.test.ts` | A3 |

As duas histórias marcadas "hoje" já existem com teste. Renomear o título
quebra `pnpm run stories --check` até o teste ser renomeado junto, então a
troca fica com a tarefa que mexe no teste (T6 e T7, decisão 15 do plano). O
texto novo delas está em "Textos para as histórias renomeadas", no fim.

## Professor

### P1. Gabarito suspeito numa questão de múltipla escolha

- **Atores:** professor do curso; alunos só como dados.
- **Cobre:** A1, A2, A3, A4, A5, A6 (múltipla escolha), A7, A8, A9, A11, B1,
  B2, G4.
- **Seed de dev:** `test-01` (encerrada, notas liberadas, questão
  `fastest-sort`, pedidos de revisão em todos os estados). O T8 precisa
  deixar ali um distrator com 3 alunos ou mais que vão bem no resto, uma
  resposta sem passe de correção e uma alteração manual.
- **Arranjo:** prova encerrada com três questões, a primeira de múltipla
  escolha com chave A e a segunda manual (dissertativa). Oito alunos: quatro
  marcaram B na primeira e acertaram o resto; dois marcaram A; um marcou C e
  errou o resto; um tem a resposta sem passe de correção. Um dos alunos de B
  tem pedido de revisão aberto nessa questão. Outro aluno tem sanção só nessa
  questão.
- **Passos e resultados:**
  1. Abre a correção da questão 1 com `?names=0`. Vê os nomes dos alunos
     mesmo assim, e não vê lista resposta por resposta nem botão de modo.
  2. "Enunciado e gabarito" está fechado; ao abrir, mostra o enunciado e a
     alternativa certa.
  3. A linha de resumo diz 8 respostas, a % corretas, e "1 sem nota", que
     leva a "Requer atenção".
  4. "Requer atenção" tem duas linhas: a resposta sem nota, com campo de 0 a
     100, "Marcar como certa" e "Dar nota"; e a revisão pedida, com "Ver
     pedido", que leva à página de pedidos de revisão.
  5. Dá nota 0 à resposta sem nota. A linha some, e "1 sem nota" some do
     resumo.
  6. Na tabela agrupada, a linha B mostra 4 alunos, 50%, nota dada 0% e a
     marcação "revisar"; a linha A mostra "esperado"; a linha C, com um
     aluno, mostra "–" na marcação.
  7. Não há botão de ação em grupo. A nota fixa da página avisa que fixar
     outra versão da questão não corrige de novo as respostas existentes.
  8. Abre os alunos da linha B pelo ícone de pessoas. O diálogo lista os
     quatro, ordenável por nome e por total. O aluno sancionado nessa questão
     aparece com o selo da penalidade.
  9. No lápis de um aluno, escolhe "Marcar como certa" com um comentário e
     confirma. Fecha o diálogo: a linha B mostra "varia" em "Nota dada", a %
     corretas do resumo sobe, e "Alteradas à mão (1)" aparece com o aluno, o
     tipo "Nota alterada", a nota automática riscada, 100% e o comentário.
  10. Em "Alteradas à mão", "Desfazer" devolve a nota automática. A tabela
      some (N = 0), a linha B volta a 0% e o histórico da resposta guarda os
      três passes (visível na página da tentativa do aluno).
  11. A seta "próxima", vinda de `?view=list`, abre a questão 2 (manual) ainda
      em modo lista; a seta "anterior" volta. O botão flutuante de lápis leva
      à edição da questão.

### P2. Os outros tipos de questão objetiva

- **Atores:** professor.
- **Cobre:** A5, A6 (múltipla seleção, verdadeiro ou falso, resposta curta,
  lacunas, numérica, ordenação), A12.
- **Seed de dev:** `test-02` (objetivas de vários tipos, tentativas
  encerradas) e `quiz-01` (`base-case-blanks`, `factorial-of-five`). O T8
  confere que os sete tipos têm respostas numa prova encerrada.
- **Arranjo:** uma prova encerrada com uma questão de cada tipo e pelo menos
  quatro respostas por questão, com duas respostas iguais em cada uma. O
  ambiente do teste roda em pt-BR para o passo de A12.
- **Passos e resultados**, um `test.step` por tipo, sempre na página de
  correção da questão:
  1. Múltipla seleção: uma linha por alternativa, com quantos marcaram
     contra o gabarito; abaixo, as combinações mais comuns e "outras".
  2. Verdadeiro ou falso: uma linha por afirmação, com a divisão V/F e a
     coluna "Erraram".
  3. Resposta curta: uma linha por texto distinto, com "Aceita?".
  4. Lacunas: um bloco por lacuna, com valor, contagem e "Aceita?". A chave
     de resposta não mostra "Blank 1 of 3" nem outro rótulo em inglês.
  5. Numérica: o histograma com a faixa de tolerância marcada, o bloco "fora
     da janela" e os grupos por valor.
  6. Ordenação: a matriz etapa por posição e as ordens inteiras agrupadas. A
     chave de resposta não mostra "Correct order".
  7. Em todos, o ícone de pessoas de um grupo abre o diálogo com os alunos
     daquele grupo e o lápis "Alterar nota".

### P3. Desafio em sala: uma questão errada vira certa

- **Atores:** professor; dois alunos que resolveram o desafio.
- **Cobre:** B1, B2, B3, B4 (efeito nas estatísticas), B5, G1 (lápis por
  questão, barra Q1…QN, resumo).
- **Seed de dev:** `quiz-01` (encerrado, `factorial-of-five` com passe manual
  de hamilton). O T8 acrescenta ali uma alteração de nota em questão em
  branco.
- **Arranjo:** prova encerrada de três questões objetivas, sendo a terceira
  de lacunas. Aluno X errou a questão 2. Aluno Y deixou a questão 2 em
  branco (sem submissão) e acertou as outras. Uma segunda prova, ainda
  aberta, em que o aluno X não respondeu a questão 1.
- **Passos e resultados:**
  1. Abre a tentativa do aluno X. A barra Q1…Q3 marca a Q2 como errada.
  2. No lápis da Q2, "Marcar como certa" com o comentário "Resolveu o
     desafio em sala". A Q2 passa a 100%, a barra a marca como alterada à
     mão, e o total sobe.
  3. Abre a tentativa do aluno Y. A Q2 aparece em branco. No lápis, dá 100
     com o mesmo comentário. A questão continua mostrando resposta em
     branco, agora com 100% e o comentário, e o total sobe.
  4. Na Q3 (lacunas) do aluno Y, altera a nota para 50. O formulário pede uma
     nota só, da questão inteira, sem campo por lacuna.
  5. Uma nota fora de 0 a 100 é recusada com mensagem e nada muda.
  6. Na correção da questão 2, a % corretas conta a resposta do aluno X como
     certa. A resposta em branco criada pelo professor para Y não entra na
     contagem de respostas nem em nenhum grupo; Y aparece só em "Alteradas à
     mão".
  7. Na prova ainda aberta, o lápis da questão em branco do aluno X recusa a
     alteração e explica que a prova ainda está aberta para ele. Nada é
     gravado.

### P4. Bônus e substituição no total da prova

- **Atores:** professor.
- **Cobre:** C3 (faixas), C4 (um `SET`; vários `FACTOR` e `OFFSET`), C6, D2,
  D3, D4, D5 (teto), D7 (pendência), D8, G1 (botão de bônus, prévia, resumo
  "Ajustes de nota"), G3.
- **Seed de dev:** `test-01` (um ajuste de cada operação, pelo T8) e
  `test-02` (aluno com dissertativa pendente, para o passo 7).
- **Arranjo:** prova encerrada de quatro questões iguais. Aluno A com 50%, B
  com 75%, C com 100%, D com 25% e E com uma dissertativa pendente.
- **Passos e resultados:**
  1. Na tentativa de A, "Adicionar bônus", operação "Somar", valor 10, motivo
     "Participação". A prévia mostra 60% antes de salvar. Depois, o resumo
     "Ajustes de nota" lista o total original 50%, a linha "Bônus +10" e o
     total final 60%.
  2. Na tentativa de B, operação "Multiplicar", valor 110. A prévia e o total
     final dão 82,5% (exibido como a tela arredonda); a linha lê "Bônus ×1,1".
  3. Na tentativa de C (100%), soma 10. O total final fica em 100%, e o
     resumo ainda mostra a linha do bônus.
  4. Na tentativa de D, "Substituir", valor 100, motivo "Melhor projeto vale
     10 na prova". O total final é 100%, com o original 25% riscado.
  5. Ainda em D, um segundo "Substituir" é recusado com a mensagem que manda
     editar o existente. Editar o existente para 80 funciona e o total vai a
     80%.
  6. Recusas, sem gravar nada: somar 0; substituir por 120; multiplicar por
     250.
  7. Na tentativa de E, soma 10. O total continua "pendente", com o ajuste
     listado ao lado.
  8. A tabela de resultados da prova mostra, para A, B e D, o total original
     riscado e o final, com link para a página de ajustes. As notas do curso
     mostram o total final.

### P5. Penalidade que convive com bônus, e o zero que encerra

- **Atores:** professor.
- **Cobre:** C3 (alvo em questão só reduz), C4 (um ajuste por questão), D1,
  D3, D4, D6, D7 (fator 0 com pendência), G1 (sanção da prova, sanção da
  questão), G4.
- **Seed de dev:** `test-01` (fator 0 no total para dois alunos, fator 0 em
  `fastest-sort` para outro) e `quiz-01` (hopper zerada em
  `factorial-of-five`).
- **Arranjo:** o de P4, com o aluno A já com "Bônus +10" (60%) e o aluno D
  com `SET` de 80%.
- **Passos e resultados:**
  1. Na tentativa de A, "Sancionar" a prova com 50% da nota que fica e motivo
     "Consulta não autorizada". O resumo lista o bônus e a penalidade, na
     ordem em que se aplicam (penalidade ×0,5, depois bônus +10), e o total
     final é 35%.
  2. Na tentativa de D, "Sancionar" a prova com "Zerar". O total vai a 0%,
     apesar do `SET` de 80% e de qualquer bônus, que continuam listados.
  3. Na tentativa de B, o martelo da Q1 aplica 50% da nota que fica. A Q1
     mostra o selo "Penalidade ×0,5", e o total cai de acordo.
  4. O diálogo de sanção da questão só oferece zerar ou reduzir: não há como
     dar bônus numa questão. Uma segunda sanção na mesma Q1 é recusada.
  5. Na tentativa de E (dissertativa pendente), "Zerar" a prova. O total
     passa a 0% e deixa de constar como pendente.
  6. Na correção da Q1, o aluno B aparece com o selo da penalidade; os alunos
     com ajuste só no total da prova não têm selo ali.

### P6. Nota para quem não fez a prova

- **Atores:** professor; um aluno matriculado sem tentativa; um aluno com
  prova de reposição marcada.
- **Cobre:** E1, E2, E3, E4, C7 (criação em lote), D7 (`SET` sem
  correção), G2, G5.
- **Seed de dev:** `test-01` (uma tentativa vazia com `SET`, pelo T8) e
  `midterm` (agendada, com a exceção de tempo do aluno de dev) para a
  recusa.
- **Arranjo:** prova encerrada com três alunos matriculados: F fez a prova,
  G não tem tentativa, H não tem tentativa e tem uma exceção com nova data no
  futuro. Um usuário que não está matriculado. Uma prova `PRACTICE`.
- **Passos e resultados:**
  1. Nos resultados da prova, G aparece como "sem tentativa". Seleciona F e
     G e usa "Ajustar selecionados": "Substituir", 70, motivo "Nota do
     projeto substitui a prova 2".
  2. A página de ajustes lista dois ajustes ativos, e o item da navegação da
     prova mostra o contador 2. Nos resultados, G passa a ter total 70% e a
     situação "ajustada".
  3. Abre a tentativa de G: não há respostas, todas as questões aparecem sem
     resposta, e o resumo mostra o `SET` e o total 70%.
  4. Um segundo ajuste para G (somar 10) usa a mesma tentativa: o total vai
     a 80% e G continua com uma linha só nos resultados.
  5. Para H, cuja janela pessoal ainda não abriu, o ajuste é recusado com a
     mensagem de que a prova ainda está aberta ou por abrir para o aluno. H
     continua "sem tentativa".
  6. Um nome de usuário não matriculado na criação em lote é recusado, e
     nenhum ajuste do lote é gravado.
  7. A prova `PRACTICE` não oferece ajuste de nota.
  8. A liberação das notas não é impedida pela tentativa de G.

### P7. Revogar um ajuste e voltar atrás numa alteração

- **Atores:** professor.
- **Cobre:** A7 (desfazer), C7 (`update`, `revoke`), G1 (alterar e remover no
  resumo), G2 (ativos e revogados), G3.
- **Seed de dev:** `test-01` (sanção revogada em `n-log-n`).
- **Arranjo:** o de P4, com A tendo "Bônus +10" e "Penalidade ×0,5", e G de
  P6 com `SET` numa tentativa vazia.
- **Passos e resultados:**
  1. Na página de ajustes, edita o bônus de A para 20 e o motivo. O total de
     A muda de acordo.
  2. Revoga a penalidade de A depois da confirmação. Ela continua listada
     como revogada, com quem revogou, e o total de A volta a ser só o bônus.
  3. Na tentativa de A, "remover" no resumo "Ajustes de nota" revoga o bônus.
     O resumo some e o total volta ao original, sem riscado nos resultados.
  4. Revoga o `SET` de G. G volta a "sem tentativa" ou a 0% na tabela (o que
     a tela definir para tentativa vazia sem ajuste), e o ajuste fica listado
     como revogado.
  5. Na tentativa de X (P3), desfaz a alteração da Q2 pela correção da
     questão ("Desfazer" em "Alteradas à mão"): a Q2 volta a errada e o total
     cai.

### P8. Achar um aluno numa turma de 80

- **Atores:** professor.
- **Cobre:** G1 (lista de alunos, busca por matrícula, colunas ordenáveis,
  setas anterior e próximo, barra Q1…QN).
- **Seed de dev:** `test-02` (a maior turma do seed). O T8 confere que há
  alunos com e sem `schoolId`.
- **Arranjo:** prova encerrada de dez questões e 80 alunos criados em laço,
  com matrículas distintas, um deles sem matrícula, um sem tentativa, um com
  ajuste e um com resposta pendente.
- **Passos e resultados:**
  1. Na tentativa de um aluno qualquer, "Lista de alunos" abre o diálogo com
     os 80 e as colunas aluno, matrícula, usuário, total e situação.
  2. Digitar a matrícula de um aluno deixa uma linha só; o aluno sem
     matrícula mostra "—" e é achado pelo nome.
  3. Ordenar por total põe o menor em primeiro e, no segundo clique, o
     maior. Ordenar por situação junta "pendente", "sem tentativa",
     "ajustada" e "entregue".
  4. Clicar numa linha abre a tentativa daquele aluno.
  5. As setas anterior e próximo passam para o aluno vizinho.
  6. A barra Q1…Q10 fica visível ao rolar a página, cada item com a cor do
     estado da questão, e um clique em Q7 leva à questão 7.

## Aluno

### A1. Ver os ajustes da minha nota

- **Atores:** aluno; o professor só no arranjo.
- **Cobre:** F1 (os cinco textos), F3, F4, D5, D6, D8.
- **Seed de dev:** `test-01` (notas liberadas, com um ajuste de cada
  operação pelo T8).
- **Arranjo:** prova encerrada com cinco alunos e um ajuste em cada: `SET`
  80%; `FACTOR` 1,1; `OFFSET` +0,1 sobre 100%; `OFFSET` −0,1; `FACTOR` 0,5
  no total mais `FACTOR` 0 numa questão. Um sexto aluno com `SET` 80% e
  `FACTOR` 0. Todos com motivo e com notas privadas.
- **Passos e resultados:**
  1. Antes da liberação, a página da prova de cada aluno não mostra nota nem
     sinal de ajuste.
  2. Depois da liberação, cada aluno vê o total original, uma linha por
     ajuste com o motivo e o total final. Os textos: "Nota substituída por
     80%", "Bônus ×1,1", "Bônus +10", "Penalidade −10", "Penalidade ×0,5".
  3. O aluno do bônus sobre 100% vê o total final 100%, não 110%.
  4. O aluno com a questão zerada vê o selo "Zerada" na questão; uma questão
     com fator 0,5 leria "Penalidade ×0,5".
  5. O sexto aluno vê total 0%, com as duas linhas.
  6. Nenhum aluno vê as notas privadas do professor.
  7. Depois que o professor revoga um ajuste, a linha some e o total volta.

### A2. Ver a nota de uma prova que não fiz

- **Atores:** aluno sem tentativa.
- **Cobre:** F2, E1.
- **Seed de dev:** `test-01` (a tentativa vazia do T8).
- **Arranjo:** o de P6 depois do passo 1, com as notas liberadas.
- **Passos e resultados:**
  1. A lista de provas do aluno mostra a prova com a nota 70%.
  2. A página da prova diz "Você não fez esta prova", mostra a linha "Nota
     substituída por 70%" com o motivo e o total, e não mostra respostas.
  3. Antes da liberação, a mesma página não mostra nota nem ajuste.

### A3. Ver a nota de uma questão que o professor alterou

- **Atores:** alunos X e Y de P3.
- **Cobre:** B1, B2, B3 (o que o aluno vê).
- **Seed de dev:** `quiz-01` (alteração em resposta real e em questão em
  branco).
- **Arranjo:** o de P3 depois do passo 3, com as notas liberadas.
- **Passos e resultados:**
  1. O aluno X vê a própria resposta na Q2, marcada conforme o gabarito, com
     a nota 100% e o comentário do professor.
  2. O aluno Y vê a Q2 sem resposta, com a nota 100% e o comentário. Nada na
     tela sugere que ele respondeu.
  3. O total dos dois inclui a questão alterada.

### A4. Pedir revisão de uma prova com ajuste

- **Atores:** três alunos.
- **Cobre:** D8a.
- **Seed de dev:** `test-01` (pedidos de revisão e ajustes na mesma prova).
- **Arranjo:** prova com notas liberadas dentro do prazo de revisão. Aluno
  com "Bônus +10"; aluno com `SET`; aluno com "Penalidade ×0,5" no total;
  aluno com penalidade só na Q1.
- **Passos e resultados:**
  1. Os alunos do bônus e do `SET` pedem revisão de uma questão normalmente.
  2. O aluno com penalidade no total não tem como pedir revisão de nenhuma
     questão, e a página diz por quê.
  3. O aluno com penalidade na Q1 não pode contestar a Q1 e pode contestar a
     Q2.
  4. Depois que o professor revoga a penalidade do total, aquele aluno pode
     pedir revisão.

## Requisitos sem história

Ficam com os specs `unit` e de API do plano, porque não têm tela ou a tela
não mostra a diferença:

- **A10:** só muda o texto da issue de recorreção.
- **B4a:** promoção a `FINAL` pula a submissão do professor (T4, `unit`).
- **C1, C2:** model e migração.
- **C5:** ajuste de questão que saiu da prova num push (T2, `unit`).
- **C8:** `response.delete` recusa tentativa com ajuste ativo (T1, `unit` e
  API).
- **D9:** renomes internos.
- **H1, H2:** rotas REST, permissões, corpo de criação e CLI (T3).
- **H3:** o seed em si; cada roteiro diz o que ele precisa ter.
- **Parcial, D3 e D5 com base negativa:** nota negativa não aparece em prova
  objetiva montada por história; fica com a tabela de `exam-result.spec.ts`.
- **Parcial, F4:** os roteiros conferem os textos em pt-BR; as chaves em
  inglês ficam com `scripts/i18n-check.ts`.

## Textos para as histórias renomeadas

Trocar junto com o nome do teste (T6 e T7).

`docs/user-stories/instructor.md`, no lugar de "Sanction a student's grade":

```md
### Adjust a student's grade

    status: implemented
    url: /<discipline>/<course>/exams/<exam>/attempts/<username>

Instructor changes what a student got on an exam after the grading: a bonus
for class participation, the project's grade in place of the exam's, or a
penalty for cheating that a regrade must not undo. From the student's attempt,
or for several students at once from the exam's results, they add points,
multiply the grade or replace it, with a reason the student reads and private
notes only instructors read; a preview shows the new total before they save.
A value out of range, a second replacement on the same attempt and a bonus on
a single question are refused and nothing is saved.

Adjustments add up: a penalty and a bonus on the same student both apply, the
total never passes 100%, and zeroing the exam gives zero whatever else was
granted. A single question can only be reduced or zeroed, from the question
itself. The results show the original total struck through beside the final
one, and the exam's Adjustments page lists every adjustment, active and
revoked, where they edit or revoke one and the student gets the earlier total
back.
```

`docs/user-stories/student.md`, no lugar de "See that my grade was
sanctioned":

```md
### See the adjustments to my grade

    status: implemented
    url: /<discipline>/<course>/exams/<exam>

Student's grade on an exam was changed by the instructor: replaced, raised by
a bonus or reduced by a penalty. Before the grades are released the exam page
shows no sign of it. Afterwards it shows the original total, one line per
adjustment with the reason the instructor wrote, and the final total, which
never passes 100%; a question that was zeroed or reduced is marked. The
instructor's private notes are never shown. A grade under a penalty cannot be
contested with a regrade request, while one with only a bonus or a
replacement still can.
```
