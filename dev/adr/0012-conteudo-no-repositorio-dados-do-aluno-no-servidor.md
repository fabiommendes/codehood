---
type: adr
status: accepted
tags: [arquitetura, conteudo, cli, web]
created: 2026-11-03
decided: 2026-08-27
creator: claude
---

# Conteúdo no repositório, dados do aluno no servidor

O conteúdo do curso nasce num repositório Git e chega ao servidor pelo CLI. Os
dados do aluno (respostas, submissões, notas, matrículas) nascem no servidor e
só existem lá. A web lê o primeiro e é a única que escreve o segundo.

## Contexto

É a ideia que organiza o resto do projeto, fixada com os primeiros requisitos
(commit `f81cff2`, 2026-08-27). O README já diz que o servidor não modifica o
conteúdo e por isso não há `codehood pull` (`README.md:29`); o glossário
repete em CLI.

## Decisão

- Conteúdo (questões, provas, calendário, recursos, repositórios) é escrito
  no Git e enviado pelo CLI (ADR 0011). O servidor nunca o modifica nem o
  devolve ao autor. Para alunos ele é só leitura.
- A web nunca cria conteúdo: sem editor de questão, montador de prova ou
  editor de calendário. As ações em `src/actions/` mexem em estado e em dados
  do aluno (status, liberação de notas, correção, matrícula), não em conteúdo.
- O servidor nunca executa código enviado por aluno. Questões de código são
  corrigidas fora do processo por um worker com sandbox próprio (fila
  `GradingJob`, `dev/rfc/fila-de-correcao-externa.md`). Rodar código de
  aluno no mesmo processo que guarda as notas e as chaves de API não tem
  sandbox que compense.
- O servidor nunca mescla conflitos de conteúdo. Dois instrutores que
  compartilham um banco de questões se acertam no Git antes do push.

| Actor     | Chega por                 | Pode escrever                                     |
| :-------- | :------------------------ | :------------------------------------------------ |
| Aluno     | Web                       | Próprias respostas, rascunhos, perfil, matrícula  |
| Instrutor | Web e CLI                 | Próprios cursos: conteúdo pelo CLI, operação pela web |
| Admin     | Web e `manage`            | Disciplinas, edições, contas                      |
| CLI       | REST, chave `CLI`         | Conteúdo do curso, como seu dono                  |
| Bot       | REST, chave `BOT`         | Notas                                             |
| `SYSTEM`  | No processo               | Tudo: seeds, `manage`, transações internas        |

`SYSTEM` não é usuário; é o actor sentinela de quem não tem pessoa por trás e
ignora as regras de permissão por projeto (ADR 0005).

### Nota do curso

- O servidor não calcula a nota final do curso e não tem linguagem de
  fórmula. O instrutor a calcula na própria máquina, com uma função Python que
  a CLI chama, e a CLI envia o resultado como colunas de nota (`GradeColumn`).
- Motivo: uma fórmula no `codehood.toml` avaliada pelo servidor exigiria
  gramática, avaliador, mensagens de erro e uma versão a manter compatível, e
  ainda não cobriria casos reais (prova substitutiva, trabalhos corrigidos fora
  do codehood, menção UnB, critério mínimo que sobrepõe a menção). Uma função
  Python cobre todos. O preço: a coluna só está tão atual quanto o último push.
- A coluna é número ou rótulo, sem escala própria no servidor, e não existe
  marcador de "nota final": o título da coluna diz o que ela é. A web não edita
  valores; só libera a coluna para os alunos, como os resultados de uma prova.
- O contrato da função do instrutor está em
  `cli/dev/specs/to-review/push-grades.md`.

### Datas do curso

- `Course.startDate`/`endDate` e `Edition.startDate`/`endDate` são datas do
  calendário, gravadas como `String` `YYYY-MM-DD` (schema `isoDate`, tipo
  `IsoDate`), não instantes. O sufixo `*At` fica reservado para instantes.
- A data não tem fuso. O fuso do servidor só entra ao transformar "dia +
  horário" num instante (`slotInstant`) e ao comparar com agora: uma data vale
  o dia inteiro no fuso do servidor, com fim inclusivo (`todayIn` em
  `src/utils/schedule-time.ts`). Nada de `new Date("YYYY-MM-DD")` solto.
- A semana 0 é a semana ISO (segunda a domingo) que contém `startDate`.
  `courseWeekZero(startDate)` não recebe fuso nem faz heurística. A CLI conta
  igual (`cli/codehood/push/calendar.py`), e as duas regras precisam continuar
  iguais: a CLI numera as semanas do `calendar.md` e o servidor as mostra.
- Motivo: gravar instante obrigava a escolher um fuso para saber "que dia é",
  e meia-noite local e meia-noite UTC no mesmo banco faziam a agenda pular uma
  semana conforme a hora do dia.

## Consequências

- Backup do servidor importa só pelos dados do aluno; o conteúdo se recupera
  com um novo push.
- Estado que a web controla não pode ser gravável pelo push (ADR 0011).
- Hoje a chave `BOT` age como o instrutor que a emitiu: nenhuma checagem de
  `ApiKeyKind` restringe o que ela escreve (`src/middleware.ts:74` só guarda o
  `kind`). O plano para fechar isso está em `dev/specs/to-do/permissions-actor.md`.
