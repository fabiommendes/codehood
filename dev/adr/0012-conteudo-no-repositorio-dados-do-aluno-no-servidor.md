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
  corrigidas fora do processo por um bot com sandbox próprio
  (`dev/specs/to-review/auto-grading.md`, "Out of scope"). Rodar código de
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

## Consequências

- Backup do servidor importa só pelos dados do aluno; o conteúdo se recupera
  com um novo push.
- Estado que a web controla não pode ser gravável pelo push (ADR 0011).
- Hoje a chave `BOT` age como o instrutor que a emitiu: nenhuma checagem de
  `ApiKeyKind` restringe o que ela escreve (`src/middleware.ts:74` só guarda o
  `kind`). O plano para fechar isso está em `dev/specs/to-do/permissions-actor.md`.
