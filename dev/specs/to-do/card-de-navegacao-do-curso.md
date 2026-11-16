# Card de navegação do curso

Uniformiza o card de links da sidebar (`src/components/nav/CourseCard.astro`)
em todas as páginas de curso e divide a página da prova do instrutor, que hoje
junta onze blocos.

## Princípio

Toda página responde a duas perguntas:

1. **O que vou fazer aqui?** Uma tarefa, dita num verbo. Página que serve a
   duas tarefas sem relação entre si é candidata a ser dividida.
2. **Como chego aqui querendo fazer X?** Um caminho a partir da aba, sem
   precisar saber a URL: aba → entrada do card → (âncora). Avisos e cards da
   home são atalhos, nunca o único caminho.

A tabela de páginas abaixo registra as duas respostas e serve de critério de
aceitação: página que não cabe numa linha dela está errada.

## Regras do card

- **R1.** O card aparece em toda página de curso, com o curso e a aba. `nav` é
  opcional e só acrescenta links. Hoje o card some quando a página não passa
  `nav` (`src/layouts/AppLayout.astro`), o que acontece em 11 páginas.
  A frequência do aluno, por exemplo, só é alcançável por um link no meio da
  home.
- **R2.** O nível 1 lista as páginas da aba, a mesma lista em todas as páginas
  dela. As âncoras da página atual são filhas da entrada dessa página, nunca
  irmãs de páginas.
- **R3.** Aba de uma página só (schedule, prova vista pelo aluno) sobe as
  âncoras para o nível 1, sem entrada-pai que repete o nome da aba.
- **R4.** A entidade da página (prova, recurso, repositório, questão, chamada)
  vai para `nav.context`, nos dois papéis.
- **R5.** O card desenha um divisor entre seções. Rótulo de seção só agrupa
  listas de entidades (tipos de prova).
- **R6.** `meta` só para contagens e pendências.

## Páginas

Papel: **I** instrutor, **A** aluno. "Card" é o nível 1; entre parênteses, as
âncoras filhas da página atual.

### Home

| Página | Papel | O que faço aqui | Como chego | Card |
| :-- | :-- | :-- | :-- | :-- |
| `index` | I | Ver o que pede atenção no curso agora | aba Início | Início (Agenda, Provas, Recursos) · Reports · Settings |
| `index` | A | Ver o que tenho para fazer agora | aba Início | Agenda · Notas · Frequência (R3: âncoras no nível 1, só as seções que existem) |
| `reports` | I | Tratar os problemas que os alunos reportaram no conteúdo | Início → Reports | igual ao `index` I |
| `settings` | I | Mudar dados, matrícula e acesso via CLI do curso | Início → Settings | igual, com (Curso, Matrícula, CLI) |

### Agenda

| Página | Papel | O que faço aqui | Como chego | Card |
| :-- | :-- | :-- | :-- | :-- |
| `schedule` | I, A | Ver o que acontece em cada semana | aba Agenda | semanas (R3), como hoje |
| `roll-call/[week]/[timeSlot]` | I | Fazer a chamada de uma aula | Agenda → semana → aula | igual a `schedule`, com links de volta para a página da agenda; "Semana N · horário" no `context` |

`roll-call` passa a pertencer à aba Agenda (`TAB_OF_PAGE`): os links para
ela saem da agenda (`ScheduleWeek`) e da home.

### Recursos

| Página | Papel | O que faço aqui | Como chego | Card |
| :-- | :-- | :-- | :-- | :-- |
| `resources` | I, A | Achar um material do curso | aba Recursos | Recursos (grupos, com contagem) · Repositórios (contagem) |
| `resources/[slug]` | I, A | Ler um material | Recursos → grupo → item | igual; título no `context` |
| `repositories` | I, A | Achar um repositório | Recursos → Repositórios | igual |
| `repositories/[slug]/[...path]` | I, A | Ler o código de um repositório | Repositórios → item | igual; nome no `context` |

### Provas

| Página | Papel | O que faço aqui | Como chego | Card |
| :-- | :-- | :-- | :-- | :-- |
| `exams` | I, A | Escolher uma prova | aba Provas | seções por tipo, como hoje |
| `exams/[slug]` | A | Fazer a prova ou ver minha nota | Provas → prova | âncoras direto (R3); título no `context` |
| `exams/[slug]` | I | Ver o estado da prova e mudá-lo (liberar notas, histórico de respostas) | Provas → prova | ver "Card da prova" |
| `exams/[slug]/questions` | I | Conferir as questões como o aluno as vê | prova → Questões | idem |
| `exams/[slug]/exceptions` | I | Dar tempo extra ou outra data a um aluno | prova → Exceções | idem |
| `exams/[slug]/grading` | I | Escolher a questão a corrigir | prova → Correção | idem |
| `exams/[slug]/grading/[question]` | I | Corrigir as respostas de uma questão | Correção → questão | idem, Correção atual |
| `exams/[slug]/regrades` | I | Responder pedidos de revisão | prova → Revisões | idem |
| `exams/[slug]/results` | I | Ver como a turma foi, por aluno e por questão | prova → Resultados | idem, com (Por aluno, Por questão) |
| `exams/[slug]/attempts/[username]` | I | Ver a tentativa de um aluno | Resultados → aluno | idem, Resultados atual; aluno no `context` |

### Alunos

| Página | Papel | O que faço aqui | Como chego | Card |
| :-- | :-- | :-- | :-- | :-- |
| `roster` | I | Ver e matricular alunos | aba Alunos | Turma · Notas · Frequência |
| `grades` | I | Ver e lançar notas da turma | Alunos → Notas | igual |
| `attendance` | I | Ver a frequência da turma | Alunos → Frequência | igual |
| `attendance` | A | (deixa de existir) | aba Início → Frequência | redireciona para `index#attendance`; a frequência do aluno é uma seção da home |


### Questões

| Página | Papel | O que faço aqui | Como chego | Card |
| :-- | :-- | :-- | :-- | :-- |
| `questions` | I | Achar uma questão do banco | aba Questões | sem links |
| `questions/[slug]` | I | Ver uma questão e onde é usada | Questões → item | sem links; título no `context` |

## Divisão da prova do instrutor

Hoje `exams/[slug].astro` mostra ao instrutor: cabeçalho, descrição,
instruções, anexos, três avisos, o switch do histórico de respostas, a
liberação de notas, os resultados por aluno, as exceções, a estatística por
questão e o preview das questões. Vira:

| Rota | Conteúdo |
| :-- | :-- |
| `exams/[slug]` Visão geral | cabeçalho, descrição, instruções, anexos, avisos, histórico de respostas, liberação de notas |
| `exams/[slug]/questions` | preview das questões |
| `exams/[slug]/exceptions` | `ExamExceptions` |
| `exams/[slug]/results` | `ExamResults` (`#by-student`) e `QuestionStats` (`#by-question`), com link para a liberação de notas na visão geral |
| `grading`, `regrades`, `attempts/[username]` | como hoje |

A visão do aluno não muda.

### Card da prova

Título da prova no `context`, duas seções sem rótulo:

```
Visão geral
Questões
─────────
Exceções
Correção        3
Revisões        1
Resultados
  Por aluno
  Por questão
```

A primeira seção é a prova em si; a segunda, o que acontece depois de
aplicada. PRACTICE mostra só a primeira, como hoje já esconde as outras.

## Correção junto

A lista de provas decide "instrutor" por `course.update-contents` e o detalhe
por `enrollment.manage`. Passa a ser `enrollment.manage` nas duas.

## Tarefas

- **T1. Card e navs.** R1 a R6 em `CourseCard.astro`, `AppLayout.astro`,
  `src/utils/course-tabs-nav.ts` e `src/utils/exam-nav.ts`; todas as páginas
  das tabelas recebem o card descrito; a permissão da lista de provas.
- **T2. Divisão da prova.** As rotas novas, o card da prova e o ajuste das
  stories que usam `#exceptions` e `#questions`. Depende de T1.

## Critérios de aceitação

- Toda página das tabelas mostra o card, com curso e aba, nos dois papéis.
- Em cada aba, todas as páginas mostram o mesmo nível 1.
- Nenhuma âncora aparece como irmã de uma página no card.
- Entre duas seções do card há um divisor.
- Cada página do instrutor sob `exams/[slug]` é alcançável pelo card da prova.
- O seed (`src/db/bootstrap.ts`) tem uma prova com correções pendentes,
  revisões abertas e exceções, para o card mostrar as contagens.
