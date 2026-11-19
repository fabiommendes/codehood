---
type: adr
status: accepted
tags: [trabalhos, equipes, git, seguranca]
relatedTo: [0012-conteudo-no-repositorio-dados-do-aluno-no-servidor, 0015-repositorios-servidos-como-git-dumb-http, trabalhos-com-repositorio]
created: 2026-11-18
creator: claude
---

# Repositórios de equipe em disco, com o binário git

Num trabalho, cada equipe entrega por `git push` num repositório que o
servidor hospeda. O servidor precisa receber packfiles, validar objetos e
recusar pushes com uma mensagem que o aluno leia no terminal. O `Repository`
do professor (ADR 0015) é só leitura e gerado do banco, o que não serve para
receber push.

## Decisão

- **Binário git, protocolo smart HTTP.** O servidor chama `git receive-pack` e
  `git upload-pack` com `--stateless-rpc` e passa o corpo da requisição em
  streaming. Cada equipe tem um repositório bare em
  `<storage.repositoryRoot>/<team.id>.git`. O banco não guarda objetos git de
  equipe. O ADR 0015 continua valendo para o `Repository` do professor, que
  segue sem binário.
- **Sem biblioteca em TypeScript.** Receber push exige ler packfile com
  deltas, validar objetos e checar fast-forward. As implementações de servidor
  em JavaScript achadas em 2026-11-18 não servem de base:
  `@fusebit/cloud-git` só traz armazenamento em memória e deixa a validação do
  push por conta de quem usa; `chr33s/git` não é publicado como pacote e se
  declara instável. `isomorphic-git` é cliente. O binário faz tudo isso e é o
  que os clientes dos alunos esperam do outro lado.
- **O servidor só lê.** Nunca há checkout de repositório de equipe. A leitura
  usa `rev-parse`, `ls-tree`, `cat-file` e `rev-list`.
- **Configuração fixa por repositório.** `receive.fsckObjects=true`,
  `receive.denyNonFastForwards=true`, `receive.denyDeletes=true`,
  `receive.autogc=false`, `pack.threads=1`, e `HEAD` em `refs/heads/main`.
- **Um hook `pre-receive` para todos.** O servidor escreve o hook em
  `<storage.repositoryRoot>/_hooks/` no boot e o passa em cada chamada com
  `-c core.hooksPath=`. Os parâmetros chegam por variáveis de ambiente. O hook
  recusa ref que não seja `refs/heads/main`, push depois do encerramento,
  arquivo acima do limite, caminho proibido e aluno sem matrícula ativa. A
  mensagem sai como `remote: ...`, no locale da instância.
- **Limites.** `receive.maxInputSize` é o que falta para a equipe chegar no
  limite do repositório. Cada chamada do binário dura no máximo 60 s. Há no
  máximo 4 operações git simultâneas no servidor e 1 por token; acima disso,
  429 com `Retry-After`.
- **O push vira `TeamPush` depois do `receive-pack`.** O servidor lê a `main`
  e grava o registro quando ela mudou. Se a gravação falhar, o próximo acesso
  compara a `main` com o último `TeamPush` e cria o registro que falta, sem
  autor.
- **Git 2.30 ou mais novo**, conferido no boot. O servidor não sobe sem ele.

## Riscos tratados

| Risco                          | Tratamento                                                                 |
| :----------------------------- | :------------------------------------------------------------------------- |
| Execução de código do aluno    | Sem checkout, sem hooks do repositório: `core.hooksPath` aponta para fora dele. |
| Objeto malformado              | `receive.fsckObjects=true`.                                                 |
| Esgotamento de disco, CPU e memória | `receive.maxInputSize`, limite por arquivo, `pack.threads=1`, `receive.autogc=false`, tempo máximo e teto de operações simultâneas. |
| Injeção de comando             | `spawn` com lista de argumentos, sem shell; o caminho vem só do id numérico da equipe. |
| Banco e disco divergentes      | Reconciliação da `main` com o último `TeamPush`; pastas apagadas depois da transação, e as que sobram por `manage prune-team-repositories`. |
| Token com escrita na URL       | Um token por membro, rotacionável; toda falha de acesso é 404; matrícula inativa bloqueia o token. |

## Consequências

- O servidor passa a depender do binário `git` em produção, e a imagem de
  deploy precisa trazê-lo.
- `storage.repositoryRoot` entra no backup junto com o banco. Um sem o outro
  perde as entregas.
- A pasta nunca é servida pelo proxy, ao contrário de `storage.resourceRoot`.
- O proxy precisa aceitar corpo grande e requisição longa em `/git/`.
- O espaço dos repositórios de equipe não entra na cota de blobs do aluno.
