---
type: adr
status: accepted
tags: [ui, navegacao, paginas, curso, provas]
created: 2026-11-17
creator: claude
---

# Navegação do curso pelo card da sidebar

Toda página de curso mostra na sidebar o card de navegação
(`src/components/nav/CourseCard.astro`), montado por `AppLayout.astro` a
partir do curso, da aba e de um `nav` opcional.

## Princípio

Toda página responde a duas perguntas:

1. **O que vou fazer aqui?** Uma tarefa, dita num verbo. Página que serve a
   duas tarefas sem relação é candidata a ser dividida (por isso a prova do
   instrutor virou `exams/[slug]`, `preview`, `exceptions`, `grading`,
   `regrades`, `sanctions`, `results` e `attempts/[username]`).
2. **Como chego aqui querendo fazer X?** Por um caminho a partir da aba, sem
   saber a URL: aba → entrada do card → (âncora). Avisos e cards da home são
   atalhos, nunca o único caminho.

Página nova que não responde às duas está errada.

## Regras do card

- **R1.** O card aparece em toda página de curso, com o curso e a aba, mesmo
  sem `nav`. `nav` só acrescenta links. A aba vem do primeiro segmento da URL
  depois do curso, traduzido por `TAB_OF_PAGE` em
  `src/layouts/AppLayout.astro` para páginas que pertencem a outra aba
  (`grades` e `attendance` → Alunos, `repositories` → Recursos, `roll-call` →
  Agenda, `reports` e `settings` → Início). Página nova fora da aba do próprio
  segmento entra nessa tabela.
- **R2.** O nível 1 lista as páginas da aba, a mesma lista em todas as páginas
  dela. As âncoras da página atual são filhas da entrada dessa página, nunca
  irmãs de páginas.
- **R3.** Aba de uma página só (agenda, prova vista pelo aluno) sobe as
  âncoras para o nível 1, sem entrada-pai que repete o nome da aba.
- **R4.** A entidade da página (prova, recurso, repositório, questão, chamada)
  vai para `nav.context`, nos dois papéis.
- **R5.** O card desenha um divisor entre seções. Rótulo de seção só agrupa
  listas de entidades (tipos de prova).
- **R6.** `meta` só para contagens e pendências.

## Card da prova do instrutor

`examNav` (`src/utils/exam-nav.ts`) devolve a mesma lista em todas as páginas
da prova; `markCourseNav` marca onde o leitor está. Ordem: Visão geral,
Prévia, Exceções, Correção (pendentes), Revisões (abertas), Sanções (ativas),
Resultados (Por questão, Por aluno). Prova `PRACTICE` mostra só Visão geral e
Prévia. O aluno vê as seções da página da prova como âncoras (R3).

Em `results`, a estatística por questão vem antes dos resultados por aluno: a
tabela menor primeiro evita rolar a maior.

## Consequências

- `src/utils/course-tabs-nav.ts` e `src/utils/exam-nav.ts` são o único lugar
  que define as entradas; páginas passam o mesmo valor e não montam links à mão.
- A frequência do aluno é uma seção da home (`index#attendance`), não página
  própria.
