---
type: spec
status: implemented
tags: [exams, grading, instructor, statistics]
relatedTo: [web-grading, exam-result, grading]
---

# Estatística por questão

## Contexto

A página da prova já mostra, para o professor, uma tabela por questão com
respostas, média e fração de acertos (`questionStats` em
`src/services/grading.ts`, `QuestionStats.astro`). Isso diz se a questão foi
difícil, mas não se ela é boa: uma questão que os melhores alunos erram e os
piores acertam está mal escrita, e uma alternativa errada que ninguém escolhe
não está fazendo papel de distrator.

Este spec acrescenta à tabela o índice de discriminação e, na página de
correção de cada questão objetiva, a distribuição das respostas por
alternativa. Tudo sai dos dados que já existem em `Response`, `Submission` e
`Feedback`; não há tabela nova.

## Glossário

- **Discriminação**: correlação entre a nota de um aluno numa questão e a
  nota dele no resto da prova. Perto de 1, a questão separa quem sabe de quem
  não sabe; perto de 0 ou negativa, não separa. Entra no `GLOSSARY.md`.
- **Distribuição das respostas**: quantos alunos escolheram cada alternativa
  de uma questão objetiva.

## Requisitos

### Cálculo

Funções puras em `src/services/question-stats.ts` (o `questionStats` atual se
muda para lá, com os testes que já existem continuando a passar).

**R1.** População: as tentativas fechadas da prova (`countingAnswers` já
filtra) cujo total está definido, isto é, sem nenhuma questão pendente.
Prática fica fora, como no resto da correção.

**R2.** `discrimination` de uma questão: correlação de Pearson entre a nota
na questão (em [-1, 1]; em branco e "não corrigida" contam 0, como no total)
e a média das outras questões da mesma tentativa (o total corrigido, sem a
própria questão). Resultado `null` quando:

- a população tem menos de 5 tentativas;
- a prova tem uma questão só;
- a variância de uma das duas séries é zero (todos acertaram, por exemplo).

**R3.** O resultado de `questionStats` ganha `discrimination: number | null`
e `blank: number` (tentativas fechadas sem resposta à questão). Os campos
atuais não mudam.

**R4.** `answerDistribution(question, answers): AnswerDistribution` para
`multiple-choice`, `multiple-selection` e `true-false`; `null` para os outros
tipos. Conta só respostas válidas (a resposta que conta de cada tentativa
fechada, a mesma de R1, mas sem exigir total definido: a distribuição não
depende de correção).

- `multiple-choice`: uma linha por alternativa da questão, com `count`, e
  uma linha "em branco".
- `multiple-selection`: uma linha por alternativa, com quantos a marcaram;
  mais "nenhuma marcada".
- `true-false`: uma linha por afirmação, com `true`, `false` e `abstained`.
- Cada linha diz se a alternativa é correta, segundo o gabarito da versão da
  questão fixada na prova (`QuestionsForExam.version`), ou a mais recente
  quando a prova não fixa versão.
- Um id de alternativa que não existe nessa versão (resposta dada a uma
  versão anterior) vira uma linha "Alternativa removida (`<id>`)", sem
  marcação de correta, para a soma bater com o número de respostas.

**R5.** As alternativas aparecem na ordem do enunciado, não na ordem de
frequência.

### Telas

**R6.** Tabela de estatísticas na página da prova (`QuestionStats.astro`):

- Colunas novas "Em branco" e "Discriminação" (duas casas decimais, ou "—"
  quando `null`, com tooltip dizendo por quê: "menos de 5 tentativas
  corrigidas", "todos tiveram a mesma nota").
- Discriminação abaixo de 0,2 ganha badge de alerta (`badge-warning`) e
  abaixo de 0 badge de erro (`badge-error`), com o texto "revisar". Os
  limites são constantes com nome em `question-stats.ts`.
- O título de cada questão vira link para a página de correção dela.
- Uma linha de ajuda embaixo da tabela explica a discriminação em uma frase.

**R7.** Página de correção da questão (`grading/[question].astro`): para
questões objetivas, seção "Distribuição das respostas" acima da lista de
respostas, com uma barra horizontal por alternativa (largura proporcional,
contagem e percentual ao lado), a correta marcada com ícone e cor de
sucesso. Sem biblioteca de gráfico: barras em CSS com DaisyUI/Tailwind.
Um distrator correto e nunca escolhido não é destacado (é informação, não
erro).

**R8.** A página de correção passa a carregar o enunciado e o gabarito da
versão fixada na prova, não a mais recente (hoje ela ignora a versão). Isso
corrige também o gabarito mostrado ao corrigir.

**R9.** Textos em `messages/{en,pt-BR}/`.

### Dados de dev

**R10.** `src/db/bootstrap.ts` ganha em `cs101` uma prova `EXAM` encerrada,
corrigida e com notas liberadas, respondida por pelo menos 7 alunos (crie
alunos de seed novos se faltar), com:

- uma questão de múltipla escolha com um distrator popular e um nunca
  escolhido;
- uma de múltipla seleção e uma de verdadeiro ou falso;
- uma questão com discriminação negativa (os alunos com melhor total erram);
- uma numérica, para mostrar a linha sem distribuição.

A prova `test-01` atual, com 4 alunos, continua mostrando "—" na
discriminação, o que cobre o estado de população pequena.

## Fora do escopo

- Estatística entre provas ou por tag.
- Exportação das estatísticas em CSV.
- Coeficiente de confiabilidade da prova (alfa de Cronbach). Fácil de
  acrescentar depois sobre as mesmas séries.

## Plano de ação

TDD em modo full.

**T1. Cálculo.** `src/services/question-stats.ts`, `src/services/grading.ts`
(remove `questionStats` de lá e ajusta imports). Cobre R1–R5. Pronto quando
`test/question-stats.spec.ts` passa com os casos novos: discriminação
conhecida calculada à mão, população pequena, variância zero, total
corrigido (sem a própria questão), distribuição com alternativa removida,
verdadeiro ou falso com abstenção.

**T2. Versão fixada na correção.** `grading/[question].astro` e o service que
carrega a questão (`question.service.ts`, se precisar de filtro por versão).
Cobre R8. Paralelo a T1. Pronto quando um teste de página mostra o gabarito
da versão fixada, depois de a questão ganhar versão nova.

**T3. Histórias e telas.** História em `docs/user-stories/instructor.md`, e2e
em `test/stories/instructor-grading.test.ts`: o professor abre a prova, vê
"—" na discriminação de uma prova pequena, abre a prova grande, vê o alerta
"revisar" na questão ruim, clica e vê a distribuição com a correta marcada.
Depois as telas (R6, R7, R9) e o seed (R10). Depende de T1 e T2. Pronto
quando o e2e passa.

**T4. Fechamento.** `GLOSSARY.md`, `CHANGELOG.md`, `pnpm exec biome check
--write .`, `pnpm run lint`, suíte inteira.

## Critérios de aceite

- Screenshot da tabela com discriminação e alerta, e da distribuição de uma
  múltipla escolha e de um verdadeiro ou falso.
- Teste com um caso calculado à mão (planilha ou conta no próprio teste) que
  confere o valor da discriminação.
