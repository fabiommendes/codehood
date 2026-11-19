---
type: spec
status: to-review
tags: [assignments, teams, git, submissions, cli]
relatedTo: [0012-conteudo-no-repositorio-dados-do-aluno-no-servidor, 0015-repositorios-servidos-como-git-dumb-http, push-grades, politica-de-atraso]
created: 2026-11-18
creator: claude
---

# Trabalhos entregues por repositório git

## Contexto

Um projeto de programação dura dias ou semanas, costuma ser feito em equipe e
não cabe numa questão de prova. Hoje o Codehood só recebe respostas dentro de
uma `Exam`, e os repositórios que serve por git vão do professor para o aluno,
só leitura.

Esta spec cria o **trabalho**: uma entidade própria, fora de `Exam` e do mdq,
em que cada equipe recebe um repositório git hospedado no servidor. A entrega é
o que estiver na `main` no prazo. Não há correção automática: o professor baixa
as entregas pela CLI, corrige na própria máquina e sobe a nota como coluna de
notas, que já existe.

Hospedar no servidor, e não no GitHub, resolve três problemas: o repositório
fica privado sem o professor virar colaborador de cem repositórios, o servidor
controla em que branch a entrega acontece, e o instante da entrega é o do
servidor.

## Glossário

Entram no `GLOSSARY.md` (T1):

- **Assignment** (pt-BR "trabalho"): trabalho de longa duração de um curso,
  entregue por push num repositório git que o servidor hospeda para cada
  equipe.
- **Team** (pt-BR "equipe"): os alunos que entregam um trabalho juntos, donos
  de um repositório. Trabalho individual tem equipes de um.
- **Team push**: um push aceito na `main` de uma equipe, com quem o fez e
  quando.
- **Delivery** (pt-BR "entrega"): o commit de uma equipe que conta para o
  trabalho. A entrega no prazo é a ponta da `main` no prazo da equipe; a
  entrega atrasada é a ponta da `main` depois dele.

## Requisitos

### Arquitetura git

- R1. O servidor recebe e serve os repositórios das equipes com o binário
  `git`, pelo protocolo smart HTTP (`git receive-pack` e `git upload-pack` com
  `--stateless-rpc`). Cada equipe tem um repositório bare em
  `<storage.repositoryRoot>/<team.id>.git`. O banco não guarda objetos git de
  equipe. O `Repository` do professor continua como no ADR 0015.
- R2. O servidor nunca faz checkout de um repositório de equipe. Lê só com
  comandos de leitura (`rev-parse`, `ls-tree`, `cat-file`, `rev-list`). O
  binário é chamado com `spawn` e lista de argumentos; o caminho do repositório
  vem só do id numérico da equipe.
- R3. Todo repositório bare é criado com `receive.fsckObjects=true`,
  `receive.denyNonFastForwards=true`, `receive.denyDeletes=true`,
  `receive.autogc=false`, `pack.threads=1`, e `HEAD` apontando para
  `refs/heads/main`.
- R4. As regras de um push ficam num hook `pre-receive` único, escrito pelo
  servidor em `<storage.repositoryRoot>/_hooks/` no boot e passado a cada
  chamada com `-c core.hooksPath=`. Os parâmetros (limites, globs, prazo,
  mensagens) chegam por variáveis de ambiente. O hook recusa, com mensagem que
  aparece no terminal do aluno como `remote: ...`:
  - a. qualquer ref que não seja `refs/heads/main`;
  - b. push depois de `closesAt`;
  - c. arquivo novo maior que `maxFileBytes`;
  - d. caminho novo que case com um glob de `deny`;
  - e. push de aluno sem matrícula ativa.
  As mensagens saem no locale da instância. As de (c) e (d) citam o caminho
  recusado. "Novo" é o que chega no push e não é alcançável de nenhuma ref
  que já existia: arquivo grande herdado do template passa, e arquivo
  adicionado num commit e removido em outro do mesmo push é recusado. O hook
  é um `sh` que chama um script Node, sem dependência do projeto.
- R5. O tamanho de um push é limitado por `receive.maxInputSize`, igual ao que
  falta para a equipe chegar em `maxRepoBytes`. Repositório que já passou do
  limite recusa qualquer push com a mensagem do hook.
- R6. Cada chamada do binário tem tempo máximo (60 s, parametrizável) e há um teto de
  operações git simultâneas no servidor (4) e por token (1). Acima do teto, 429
  com `Retry-After`.
- R7. Depois que `receive-pack` termina com sucesso, o servidor lê a `main` e,
  se ela mudou, grava um `TeamPush`. Se a gravação falhar, o próximo acesso ao
  repositório reconcilia: `main` diferente do `newSha` do último `TeamPush`
  gera o registro que falta, sem autor. Equipe sem `TeamPush` compara com
  `Team.baseSha`, para o commit do template não virar push.
- R8. No boot, o servidor confere que `git --version` é 2.30 ou mais novo e
  falha com mensagem clara quando não é.
- R9. ADR novo, `dev/adr/0021-repositorios-de-equipe-em-disco-com-binario-git.md`,
  registra R1 a R8 e os riscos tratados (execução por checkout, objeto
  malformado, esgotamento de recursos, injeção de comando, divergência entre
  banco e disco, token com escrita na URL).
- R9a. O `TeamPush` de um push guarda em `oldSha` a ponta anterior da `main`,
  que no primeiro push de uma equipe semeada é `Team.baseSha`. O protocolo v2
  do git (`Git-Protocol`) não é repassado. A rota git do professor é escrita
  à mão, fora do registro da REST e do OpenAPI, e responde 401 sem
  `WWW-Authenticate` a quem não manda chave.

### Banco

- R10. Models novos em `prisma/schema.prisma`, com relações inversas em
  `Course`, `Repository` e `User`:

  ```prisma
  /// A long-running piece of work a course asks of its students, delivered by
  /// pushing to a git repository the server hosts for each team.
  model Assignment {
    id Int @id @default(autoincrement())

    courseId Int
    course   Course @relation(fields: [courseId], references: [id], onDelete: Cascade)

    /// Natural key: the file name under `assignments/`.
    slug  String
    title String

    /// The statement, in markdown.
    body String

    /// When students start seeing it. Null shows it as soon as it is pushed.
    opensAt  DateTime?
    /// The tip of main at this instant is the on-time delivery.
    dueAt    DateTime
    /// Pushes are refused from this instant on. Null never refuses.
    closesAt DateTime?

    teamMin     Int       @default(1)
    teamMax     Int       @default(1)
    /// Students form and leave teams until this instant. Null means dueAt.
    teamsLockAt DateTime?

    /// The course repository whose head commit each team repository starts from.
    templateId Int?
    template   Repository? @relation(fields: [templateId], references: [id], onDelete: SetNull)

    /// Limits a push must respect. Null takes the instance defaults.
    restrictions Json?

    /// Revision marker supplied by the writer, opaque to the server.
    rev String?

    teams Team[]

    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt

    @@unique([courseId, slug])
  }

  /// The students who deliver one assignment together, and the owner of its
  /// repository. An individual assignment has teams of one.
  model Team {
    id       Int    @id @default(autoincrement())
    publicId String @unique

    assignmentId Int
    assignment   Assignment @relation(fields: [assignmentId], references: [id], onDelete: Cascade)

    name String

    /// Code a student types to join. Null on a team of an individual assignment.
    joinCode String? @unique

    /// Commit the repository was created with, taken from the template. It is
    /// not a push. Null when the repository started empty.
    baseSha String?

    /// Replaces the assignment's dueAt for this team. Server-side state the
    /// course repository must not set.
    dueAt DateTime?

    members TeamMember[]
    pushes  TeamPush[]

    createdAt DateTime @default(now())

    @@unique([id, assignmentId])
    @@unique([assignmentId, name])
  }

  /// One student's place in a team, with the secret of their own clone URL.
  model TeamMember {
    assignmentId Int
    teamId       Int
    team         Team @relation(fields: [teamId, assignmentId], references: [id, assignmentId], onDelete: Cascade)

    username String
    user     User   @relation(fields: [username], references: [username], onDelete: Cascade)

    /// Unguessable secret in this member's clone and push URL.
    token String @unique

    joinedAt DateTime @default(now())

    @@id([teamId, username])
    /// A student belongs to one team per assignment.
    @@unique([assignmentId, username])
  }

  /// One accepted push to a team's main branch.
  model TeamPush {
    id Int @id @default(autoincrement())

    teamId Int
    team   Team @relation(fields: [teamId], references: [id], onDelete: Cascade)

    /// Who pushed. Null once the user is deleted, and on a reconciled push.
    username String?
    user     User?   @relation(fields: [username], references: [username], onDelete: SetNull)

    /// Tip of main before the push. Null on the first one.
    oldSha String?
    newSha String

    createdAt DateTime @default(now())

    @@index([teamId, createdAt])
  }
  ```

- R11. O token do membro fica em texto, como `Repository.token`, para a página
  mostrar a URL sempre. O aluno pode rotacioná-lo.
- R12. A entrega no prazo e a atrasada não são colunas: saem do `TeamPush`
  (R17). Uma prorrogação dada depois reclassifica os pushes sozinha.
- R13. Apagar uma `Team` ou um `Assignment` remove as pastas dos repositórios
  depois que a transação do banco fecha, nunca dentro dela
  (`dev/issues/io-de-disco-dentro-de-transacao.md`). Pasta que sobrar é
  removida por um comando de gestão (R36).

### Configuração

- R14. Chaves novas em `codehood.config.ts`, lidas a cada boot:

  | Chave                             | Padrão            | Ambiente                  |
  | :-------------------------------- | :---------------- | :------------------------ |
  | `storage.repositoryRoot`          | `./storage/repos` | `REPOSITORY_ROOT`         |
  | `storage.assignment.maxRepoBytes` | `50mb`            | `ASSIGNMENT_MAX_REPO`     |
  | `storage.assignment.maxFileBytes` | `10mb`            | `ASSIGNMENT_MAX_FILE`     |

  O espaço dos repositórios de equipe não entra na cota de blobs do aluno.
- R15. `pnpm run db:reset` apaga `storage.repositoryRoot`. Cada worker de teste
  tem a sua pasta em `test/.tmp/<port>/`.

### Entidades

- R16. `src/core/schemas/assignment.ts` e `src/core/schemas/team.ts`:
  - `assignmentRestrictions`: `{ maxRepoBytes?, maxFileBytes?, deny?: string[], require?: string[] }`.
    `deny` são globs de caminho, com a semântica de `path.matchesGlob` do
    Node (`*.zip` não casa `a/b.zip`; `**/*.zip` casa); `require` são
    caminhos exatos. Os tamanhos não
    passam dos limites da instância.
  - Regras do trabalho: `1 <= teamMin <= teamMax <= 10`; `dueAt <= closesAt`;
    `opensAt <= dueAt`; `teamsLockAt <= dueAt`.
  - `slug` segue a mesma regra do slug de `Repository`.
  - Nome da equipe: 1 a 60 caracteres, único no trabalho.
- R17. Função pura `teamDelivery(pushes, dueAt)` em
  `src/services/assignment-delivery.ts` devolve
  `{ onTime: TeamPush | null, late: TeamPush | null }`: `onTime` é o último
  push com `createdAt <= dueAt`; `late` é o último push depois disso, ou `null`
  quando não houve. `dueAt` é o da equipe, ou o do trabalho quando ela não tem.
- R18. `AssignmentService` (`src/db/services/assignment.service.ts`): `upsert`
  por `(course, slug)`, `findMany`, `findOne`, `remove`. Aluno só lê trabalho
  com `opensAt` nulo ou passado. Mudar `teamMin` ou `teamMax` não mexe nas
  equipes que já existem: as que ficarem fora do intervalo passam a contar
  como exceção (R20).
- R19. `TeamService` (`src/db/services/team.service.ts`):
  - `create(assignment, { name })`: o aluno cria a equipe e vira membro. Em
    trabalho individual o nome é o username e não há `joinCode`. Cria o
    repositório bare (R21).
  - `join(assignment, { joinCode })`: recusa equipe cheia, aluno já em outra
    equipe e código de outro trabalho.
  - `leave(team)`: remove o membro e o token. O último membro de uma equipe sem
    push apaga a equipe; com push, a saída é recusada (só o professor desfaz).
  - `create`, `join` e `leave` são recusados para o aluno depois de
    `teamsLockAt`.
  - `rotateToken(team)`: troca o token do próprio membro.
  - `findMine(assignment)`: a equipe do leitor, com o `joinCode` (até
    `teamsLockAt`) e só o token dele.
  - O `joinCode` tem 8 caracteres de um alfabeto sem ambíguos, é comparado
    sem distinguir maiúsculas e não é regenerado.
  - Trabalho individual é o que tem `teamMax` 1. O `upsert` recusa trocar
    entre individual e em equipe quando já há equipes.
  - `createFor` recusa aluno que já está em outra equipe: quem move é
    `addMember`. `addMember` é recusado em trabalho individual.
  - `listWithDeliveries` traz `sizeException` de cada equipe: `above`,
    `below`, `empty` ou nulo.
  - Só para quem gerencia o curso, sem a trava de data e sem os limites de
    tamanho (R20):
    - `createFor(assignment, { name, members })`: cria uma equipe com os
      alunos dados, que podem ser nenhum.
    - `addMember(team, username)`: põe na equipe um aluno com matrícula ativa.
      Se ele estava em outra equipe do trabalho, sai dela e troca de token.
      Os pushes que ele fez continuam na equipe de origem, e a entrega dela
      não muda.
    - `removeMember(team, username)`: tira o aluno e apaga o token. A equipe
      continua existindo mesmo sem membros, com o repositório e os pushes.
    - `remove(team)`: apaga a equipe e o repositório (R13).
    - `setDueAt`, `rename`.
    Em trabalho individual só `setDueAt` e `remove` se aplicam.
  - `findByToken(token, slug)`: devolve membro, equipe e trabalho, ou nada.
  - `recordPush(team, { username, oldSha, newSha })`.
  - `listWithDeliveries(assignment)`: equipes, membros e `teamDelivery` de cada.
  - `summary(assignment)`: número de equipes, de alunos com matrícula ativa sem
    equipe, de equipes com entrega no prazo e de equipes só com entrega
    atrasada.
- R20. `teamMin` e `teamMax` limitam só o que o aluno faz: `join` recusa
  equipe com `teamMax` membros ou mais. O professor abre exceção pondo ou
  tirando alunos por conta própria, e a equipe pode ficar acima de `teamMax`,
  abaixo de `teamMin` ou com um membro só. Nenhum tamanho impede clonar ou
  fazer push. Para o aluno, a página avisa quando a equipe está abaixo do
  mínimo; equipe acima do máximo não gera aviso para ele. Para o professor,
  toda equipe fora do intervalo aparece marcada como exceção.
- R21. O repositório nasce com a equipe. Com `template`, recebe o commit atual
  do `Repository` (objetos gravados a partir de `GitObject` e dos blobs) e a
  `main` aponta para ele; esse commit não gera `TeamPush`. Sem `template`,
  nasce vazio. Template sem commit vale como sem template. Mudança posterior do
  template não chega às equipes.
- R22. Matrícula trancada não apaga o membro. O token dele não clona nem faz
  push enquanto a matrícula não estiver ativa.
- R23. Avisos de `require`: `TeamService.missingFiles(team)` lê a árvore da
  `main` e devolve os caminhos de `require` que faltam. Não bloqueia push.

### Rotas git

- R24. A rota `src/pages/git/[token]/[...rest].ts` passa a resolver o token em
  `Repository` e, quando não acha, em `TeamMember`. Para equipe, a URL é
  `/git/<token>/<assignment-slug>.git` e atende:

  | Método | Caminho                                  | Ação                |
  | :----- | :--------------------------------------- | :------------------ |
  | GET    | `info/refs?service=git-upload-pack`      | anúncio para clone  |
  | GET    | `info/refs?service=git-receive-pack`     | anúncio para push   |
  | POST   | `git-upload-pack`                        | clone e fetch       |
  | POST   | `git-receive-pack`                       | push                |

  O corpo é passado em streaming para o processo, aceitando
  `Content-Encoding: gzip`. O protocolo dumb não é servido para equipes.
- R25. Token inválido, slug errado, trabalho ainda não aberto e matrícula
  inativa respondem 404, como no ADR 0015. As recusas de push de R4 não são
  404: saem pelo hook, para o aluno ler o motivo.
- R26. Depois de `closesAt` o clone e o fetch continuam funcionando.

### REST e permissões

- R27. Rotas novas, declaradas em `src/api/index.ts` (ADR 0007), com chave de
  API (ADR 0008):

  | Método | Rota                                                             | Uso                                   |
  | :----- | :--------------------------------------------------------------- | :------------------------------------ |
  | GET    | `/api/course/[d]/[c]/assignment`                                 | lista                                 |
  | GET    | `/api/course/[d]/[c]/assignment/[slug]`                          | um trabalho                           |
  | PUT    | `/api/course/[d]/[c]/assignment/[slug]`                          | upsert (push da CLI)                  |
  | DELETE | `/api/course/[d]/[c]/assignment/[slug]`                          | apaga; 409 com equipes, salvo `?force=true` |
  | GET    | `/api/course/[d]/[c]/assignment/[slug]/team`                     | equipes, membros e entregas           |
  | POST   | `/api/course/[d]/[c]/assignment/[slug]/team`                     | cria uma equipe com os alunos dados   |
  | PATCH  | `/api/course/[d]/[c]/assignment/[slug]/team/[team]`              | `dueAt`, `name`                       |
  | DELETE | `/api/course/[d]/[c]/assignment/[slug]/team/[team]`              | apaga a equipe e o repositório        |
  | PUT    | `/api/course/[d]/[c]/assignment/[slug]/team/[team]/member/[username]` | põe o aluno na equipe, tirando-o de outra |
  | DELETE | `/api/course/[d]/[c]/assignment/[slug]/team/[team]/member/[username]` | tira o aluno da equipe           |
  | GET, POST | `/api/course/[d]/[c]/assignment/[slug]/team/[team]/git/[...rest]` | `upload-pack` só leitura, para o professor clonar |

  `[team]` é o `publicId`. `template` viaja como slug do `Repository`.
  `Team.dueAt` não existe no corpo do PUT do trabalho (ADR 0011).
- R28. A rota git do professor autentica pela chave de API no cabeçalho
  `Authorization`, não por token na URL, e nunca aceita `receive-pack`.
- R29. Permissões, sem permissão nova:

  | Ação                                         | Quem                                        |
  | :------------------------------------------- | :------------------------------------------ |
  | Ler trabalho aberto                          | `course.read-contents`                      |
  | Ler trabalho ainda não aberto, criar, apagar | `course.update-contents`                    |
  | Criar equipe, entrar, sair, rotacionar token | aluno com matrícula ativa, sobre si mesmo   |
  | Ver membros, pushes e URL de uma equipe      | os membros dela e `enrollment.manage`       |
  | Listar equipes, mover, prorrogar, clonar     | `enrollment.manage`                         |

  O `joinCode` e os tokens só saem para os membros da equipe. A listagem do
  professor não traz tokens.
- R30. Regenerar o snapshot OpenAPI e o cliente da CLI
  (`pnpm run openapi:cli`).

### Telas e fluxos

O aluno forma a equipe e acompanha a entrega pela web. O professor compõe as
equipes pela web ou pela CLI; baixar as entregas e prorrogar são só da CLI.

- R31. `/[discipline]/[course]/assignments`: lista dos trabalhos visíveis, com
  prazo e a situação do leitor (sem equipe, sem push, entregue no prazo,
  atrasado, encerrado). Pertence à aba Avaliações e aparece no card do curso
  na sidebar quando há algum trabalho.
- R32. `/[discipline]/[course]/assignments/[slug]`: enunciado, prazos e o
  painel da equipe, que muda com o estado:

  | Estado                                   | O que o painel mostra                                              |
  | :--------------------------------------- | :----------------------------------------------------------------- |
  | Sem equipe, trabalho em equipe           | criar equipe (nome) ou entrar com código                           |
  | Sem equipe, trabalho individual          | botão "Criar meu repositório"                                      |
  | Sem equipe, depois de `teamsLockAt`      | aviso para procurar o professor                                    |
  | Em equipe, sem push                      | membros, código da equipe, URL de clone, como fazer o primeiro push |
  | Equipe incompleta                        | o mesmo, com aviso do tamanho mínimo                               |
  | Com push, dentro do prazo                | "Entregue no prazo" com commit, autor e hora; lembrete de que novos pushes atualizam a entrega |
  | Depois do prazo, com entrega no prazo    | entrega no prazo fixada; entrega atrasada ao lado quando houver    |
  | Depois do prazo, sem entrega no prazo    | "Sem entrega no prazo"; entrega atrasada quando houver             |
  | Depois de `closesAt`                     | pushes encerrados; clone ainda disponível                          |

  "Depois do prazo, sem entrega no prazo" cobre também a equipe que nunca fez
  push. A ordem da página é: situação da entrega, painel da equipe, prazos,
  enunciado.

  Em todo estado com equipe: histórico de pushes (quem, quando, commit),
  avisos de arquivos obrigatórios que faltam e rotacionar o token. A URL de
  clone usa o `CloneBox` existente, que ganha props para trocar a nota (a URL
  é pessoal e só a `main` é aceita) e esconder o zip.
  - a. "Sair da equipe" aparece antes de `teamsLockAt` em trabalho em equipe.
    Fica desabilitado, com o motivo, quando o aluno é o último membro de uma
    equipe com push (R19). Trabalho individual não tem o botão.
  - b. O código da equipe aparece para os membros até `teamsLockAt`.
  - c. Equipe prorrogada vê o prazo dela, marcado como prorrogado, com o prazo
    original ao lado.
  - d. Em trabalho individual a página nunca fala em equipe: o painel é "Seu
    repositório", a situação sem repositório é "Sem repositório" (na lista
    também), e não há membros, código, nome nem "sair". Os textos de entrega e
    de prazo dizem "sua entrega" e "seu prazo", não "da equipe".
- R33. Para quem gerencia o curso, a mesma rota mostra, no lugar do painel da
  equipe:
  - a. A contagem de equipes, de alunos matriculados sem equipe, de equipes
    com entrega no prazo e só com entrega atrasada
    (`TeamService.summary(assignment)`), e os comandos da CLI que listam e
    baixam.
  - b. A tabela das equipes: nome, membros, tamanho com a marca de exceção
    quando fora do intervalo (R20), prazo quando prorrogado, entrega no prazo
    e atrasada (commit e hora).
  - c. Em cada equipe: tirar um membro, adicionar um aluno (busca entre os
    matriculados; quem já está em outra equipe aparece com o nome dela e a
    ação vira "mover", com confirmação), renomear e apagar a equipe (com
    confirmação que cita os pushes que serão perdidos).
  - d. A lista dos alunos sem equipe, cada um com "adicionar a uma equipe", e
    "criar equipe".
  - e. Em trabalho individual a tabela é de alunos, não de equipes: aluno,
    prazo quando prorrogado e entregas. Não há ações de composição, e quem
    ainda não criou o repositório aparece como "sem repositório". Prorrogar
    é pela CLI, como nos trabalhos em equipe.
  - f. Na tabela das equipes, as duas entregas dividem uma coluna e as ações
    de cada equipe ficam num menu, para a tabela caber sem rolagem lateral no
    container padrão do `AppLayout`. A exceção de tamanho é o número com um
    ícone e uma cor (seta para cima acima do máximo, seta para baixo abaixo
    do mínimo, outra cor e ícone para equipe sem membros); a frase completa
    fica no tooltip e no texto para leitor de tela. As páginas de trabalho não usam
    `width="wide"`, como as outras páginas do curso.
- R34. As ações do aluno e do professor são Astro Actions finas sobre o
  `TeamService`. Textos em `messages/`, em inglês e pt-BR.

### CLI

- R35. `codehood push` lê `assignments/<slug>.md`: frontmatter com `title`,
  `due`, `closes`, `opens`, `team: { min, max, lock }`, `template` (slug de
  `repositories/`), `restrictions`; o corpo é o enunciado. Datas no mesmo
  formato das datas de prova, mas `due`, `closes` e `team.lock` exigem hora:
  um prazo só com a data seria lido como meia-noite. Sem `team`, o trabalho é
  individual; `team: { min: 2 }` sem `max` vale `max = min`. Os tamanhos de
  `restrictions` aceitam `"10mb"`. A sincronização é em três vias com `rev`,
  como a das provas. Arquivo com prefixo `_` não é enviado. Trabalho
  que existe no servidor e sumiu do disco gera `WarnAssignmentKept` e só é
  apagado com `--drop-assignments`; com equipes, a CLI pede confirmação antes
  de mandar `force=true`. O `template` precisa existir em `repositories/`, e os
  repositórios sobem antes dos trabalhos.
- R36. Comandos novos:
  - `codehood assignment status <slug>`: tabela de equipes, membros, entrega no
    prazo e atrasada (commit, hora, autor).
  - `codehood assignment clone <slug> [--late] [--dest <dir>]`: clona cada
    equipe em `submissions/<slug>/<equipe>/` e deixa no commit da entrega no
    prazo, com `HEAD` destacado e sem branch local; `--late` usa a entrega
    atrasada, ou a no prazo quando não houve atraso. Rodar de novo atualiza,
    achando a pasta pelo `publicId` gravado em `git config codehood.team`.
    Pasta com alteração local fica intocada, com aviso. Equipes sem
    entrega são listadas no fim. A chave de API vai por `http.extraHeader` no
    ambiente do processo git, nunca gravada no `.git/config`.
  - `codehood assignment extend <slug> <equipe> <data>` e
    `codehood assignment move <slug> <aluno> <equipe>`.
  - `pnpm run manage prune-team-repositories [--dry-run]`: remove pastas de
    repositório sem equipe no banco.
  - `status` não mostra os alunos sem equipe: a REST não tem essa lista, e a
    contagem está na página do professor.
- R37. A nota do trabalho usa o fluxo de colunas de nota que já existe
  (`cli/dev/specs/to-review/push-grades.md`), sem mudança.

### Dados de dev

- R38. `src/db/bootstrap.ts` semeia em `cs101`, com repositórios bare de
  verdade e pushes feitos pelo binário git:

  | Trabalho          | Forma                                             | Estados alcançados                                                   |
  | :---------------- | :------------------------------------------------ | :------------------------------------------------------------------- |
  | `projeto-final`   | equipes de 2 a 3, template `lab-calculadora`, prazo futuro | aluno sem equipe; equipe incompleta sem push; equipe com entrega no prazo; arquivo obrigatório faltando |
  | `lab-git`         | individual, sem template, prazo passado, `closesAt` futuro | entrega no prazo e atrasada; só atrasada; sem repositório; equipe prorrogada |
  | `trabalho-zero`   | individual, encerrado                              | pushes recusados, clone disponível                                   |
  | `projeto-surpresa`| `opensAt` futuro                                   | invisível para aluno, visível para o professor                        |

## Fora do escopo

- Correção automática e qualquer ligação com `GradingJob`, mdq ou `Exam`.
- Nota e comentário por equipe, navegador de arquivos e diff na web.
- Prorrogar o prazo e baixar as entregas pela web (são da CLI).
- Outras branches, tags e pull requests.
- Atualizar as equipes quando o template muda.
- Copiar as equipes de um trabalho anterior.
- Política de atraso com desconto (`dev/issues/politica-de-atraso.md`): a v1
  só separa a entrega no prazo da atrasada.
- Prazo do trabalho na agenda e no feed de calendário.
- Questão de upload (`dev/issues/questao-de-upload.md`) e questão `code` com
  vários arquivos.

## Plano de ação

T0 está feita: o humano validou as telas no playground em 2026-11-18 e a spec
já traz o que saiu de lá. O playground é a referência visual de T7.

| T   | Tarefa                                                                                   | Arquivos                                                                 | Cobre          | Depende | Modelo |
| :-- | :--------------------------------------------------------------------------------------- | :----------------------------------------------------------------------- | :------------- | :------ | :----- |
| T0  | Protótipo das telas do aluno e do professor, com dados de fixture                                        | `src/pages/design/playground/assignments/`                               | R31 a R33      | —       | sonnet |
| T1  | Schema, configuração, glossário e ADR 0021                                                | `prisma/schema.prisma`, `codehood.config.ts`, `src/core/constants.ts`, `GLOSSARY.md`, `dev/adr/0021-*.md` | R9, R10, R14, R15 | T0 aprovado | haiku |
| T2  | Repositório bare: criar, semear do template, `receive-pack`, `upload-pack`, leitura, hook | `src/services/git/bare.ts`, `src/services/git/hook.ts`, specs unit       | R1 a R6, R8, R21 | T1    | sonnet |
| T3  | Schemas Zod, `teamDelivery`, `AssignmentService`, `TeamService`                           | `src/core/schemas/{assignment,team}.ts`, `src/services/assignment-delivery.ts`, `src/db/services/{assignment,team}.service.ts`, specs unit | R11 a R13, R16 a R23 | T1, T2 | sonnet |
| T4  | Rotas git de equipe e do professor                                                        | `src/pages/git/[token]/[...rest].ts`, rota da API, spec e2e com o binário git | R7, R24 a R26, R28 | T3 | sonnet |
| T5  | REST, permissões, OpenAPI e cliente gerado                                                | `src/api/index.ts`, `src/auth/permissions/`, `cli/resources/openapi/`, `cli/codehood/api/generated.py` | R27, R29, R30 | T3 | sonnet |
| T6  | Histórias do aluno e do professor, e e2e                                                  | `docs/user-stories/{student,instructor}.md`, `test/stories/{student,instructor}-assignments.test.ts` | R31 a R34    | T3      | sonnet |
| T7  | Páginas e actions, a partir do playground                                                 | `src/pages/[discipline]/[course]/assignments/`, `src/actions/`, `src/components/assignment/`, `messages/` | R31 a R34 | T4, T6 | sonnet |
| T8  | `codehood push` de trabalhos                                                              | `cli/codehood/push/assignment.py` e vizinhos                              | R35            | T5      | sonnet |
| T9  | Comandos `codehood assignment` e `manage prune-team-repositories`                                | `cli/codehood/cli/`, `src/commands/`                                      | R36            | T4, T5  | sonnet |
| T10 | Seed                                                                                      | `src/db/bootstrap.ts`                                                     | R38            | T3      | sonnet |
| T11 | README ("Deploying": git, backup da pasta, proxy), changelog, apagar o playground         | `README.md`, `CHANGELOG.md`, `src/pages/design/playground/assignments/`   | —              | todas   | haiku  |

Critério de pronto de cada tarefa:

- T0: as páginas abrem em `/design/playground/assignments/...`, uma por estado
  de R32, e `pnpm run lint` sai 0.
- T1: `pnpm run db:reset` e `pnpm run typecheck` saem 0.
- T2: specs unit contra o binário git: repositório criado com a configuração
  de R3; cada recusa de R4 e R5 devolve a mensagem esperada; repositório
  semeado de um template clona com o mesmo sha do `Repository`.
- T3: `pnpm run test:unit` passa, com casos para `teamDelivery` (sem push, só
  no prazo, só atrasado, os dois, prorrogação que reclassifica) e para cada
  recusa de R19.
- T4: spec e2e que usa `git` de verdade: clona, faz push na `main`, lê o
  `TeamPush`; push em outra branch, force-push, arquivo grande, caminho
  proibido e push depois de `closesAt` falham com a mensagem; token de aluno
  trancado dá 404; o professor clona pela rota da API e não consegue fazer
  push.
- T5: `test/openapi-snapshot.spec.ts` e `cli/tests/test_generated_in_sync.py`
  passam; spec e2e da tabela de R29.
- T6: os e2e existem e falham porque as telas não existem.
- T7: os e2e de T6 passam, e `pnpm run test:tour` alcança as rotas novas com
  aluno e professor, sem componente `.astro` de trabalho fora da cobertura.
- T8 e T9: `rtk uv run pytest` em `cli/` passa.
- T10: cada estado da tabela de R38 abre no dev server sem arrumar nada à mão.
- T11: `pnpm exec biome check --write .`, `pnpm run lint` e `rtk pnpm test`
  saem 0.

## Critérios de aceite

- Screenshots de cada estado de R32 no dev server, com os dados do seed.
- Sessão de terminal de um aluno: `git clone`, commit, `git push`, e as
  recusas (branch errada, force-push, arquivo grande, prazo encerrado) com a
  mensagem `remote:`.
- Sessão de terminal do professor: `codehood push` criando um trabalho,
  `codehood assignment status` e `codehood assignment clone` com e sem
  `--late`.
- Saída de `rtk pnpm test` e de `rtk uv run pytest`.
