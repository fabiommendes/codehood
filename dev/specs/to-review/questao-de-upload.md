---
type: spec
status: to-review
tags: [questions, submissions, blobs, mdq, exams]
relatedTo: [questao-de-upload, anexos-de-questoes-e-provas, limite-de-taxa-nos-uploads, 0010-blobs-publicos-e-permanentes, 0016-mdq-e-a-fonte-da-verdade-do-formato-de-questao]
created: 2026-11-19
creator: claude
---

# Questão de upload

## Contexto

Toda resposta de prova hoje é digitada na página. O aluno não consegue
responder com um arquivo (PDF de relatório, foto de um diagrama feito à mão,
planilha). Esta spec cria o tipo de questão `upload` no mdq-spec, nas duas
implementações (mdq-py e mdq-js) e no codehood, do documento do professor até
a correção manual. Fecha a issue `dev/issues/questao-de-upload.md`.

A fonte da verdade do formato é `../mdq/docs/question-types/upload.md` e
`../mdq/schema/upload.yaml` (ADR 0016). Esta spec não repete o formato: só
diz o que cada frente faz com ele.

## Requisitos

### Formato (mdq-spec)

- **R1.** Tipo novo `upload`, com tag `[upload]` sem dois-pontos, frontmatter
  `maxFiles` (inteiro ≥ 1, padrão 1), `maxSize` (bytes inteiros ou texto
  `5 MB`, potências de 1024, conta decimal exata, até 2⁵³ − 1) e `extensions`
  (extensões em minúsculas, com `.`; o nome do arquivo é comparado dobrando
  só `A-Z`),
  `## [answer-key]` opcional como no essay. Automação `manual`. Não é uma
  variante do essay: a resposta do essay continua sendo sempre uma string.
- **R2.** A resposta é uma lista de 1 a `maxFiles` itens `{name, path, size}`.
  `path` é opaco para o MDQ: cada host põe ali o que localiza o arquivo. A
  questão pulada é `null`, nunca `[]`. A resposta é malformada quando fere
  forma, `maxFiles`, `maxSize`, `extensions` ou repete `name` (comparação
  exata de code points).
- **R3.** A forma pública mantém `maxFiles`, `maxSize` (na forma em que foi
  escrito) e `extensions`. `answerKey` é privado.
- **R4.** O texto da spec propaga o tipo novo para todos os lugares que
  listam tipos: `docs/responses.md`, `docs/public-form.md`,
  `docs/question-types/question-base.md` (tabela de tags, `TYPE_NAME`,
  inferência de tipo, automação), `docs/exam.md` (tipos sem `grading`),
  `docs/lint-codes.md` (colunas de tipos), `schema/exam.yaml` (`oneOf` da
  entrada), a descrição de `schema/question-base.yaml`, as listas de tipos de
  `scripts/schema_bundle.py` e `scripts/spec_audit.py`, o bundle gerado
  (`schema/mdq.schema.json` e as cópias nos subtrees, por
  `uv run scripts/spec_audit.py`), o skill
  `skills/mdq-questions/` e o `CHANGELOG.md` da raiz em `[Unreleased]`.
- **R5.** Corpus compartilhado em `examples/`: válidos em
  `examples/valid/upload/` (mínimo, todos os campos, `maxSize` inteiro e
  texto, answer key com e sem `## [attachments]`, YAML e JSON
  equivalentes), inválidos em `examples/invalid/upload-*` (um por linha da
  tabela "Additional Rules"), casos em `examples/public.yaml` e o arquivo de
  vetores `examples/grading/upload.yaml` (pendente, cada caso de malformada,
  limites exatos: tamanho igual a `maxSize`, `maxFiles` itens, extensão
  composta, nome que é só a extensão, nome com letra acentuada maiúscula,
  `maxSize` com três casas decimais, `0.5 B` e acima de 2⁵³ − 1).
- **R6.** `r2 check-spec` passa (sem `r2` instalado:
  `uv run scripts/inexact_tables.py --check && uv run scripts/spec_audit.py --check`).
  O schema não descreve a resposta; a forma dela fica na prosa e nos vetores
  de `examples/grading/upload.yaml`.

### mdq-py

- **R7.** Modelo, parser, validação, forma pública, `automation`, lint e
  correção (resposta válida é `pending`, as outras são `ResponseError`) do
  tipo `upload`, passando o corpus de R5.
- **R8.** Funções públicas para o host conferir um arquivo antes de guardar,
  com os mesmos nomes nas duas implementações e aceitando a forma pública da
  questão (é só ela que o componente recebe):
  `maxSizeBytes(question) -> number | null` / `max_size_bytes` (bytes, ou
  nenhum limite) e `matchesExtensions(question, name) -> boolean` /
  `matches_extensions`. A conta de `maxSize` é exata (BigInt no JS,
  `Decimal`/`Fraction` no Python); o dobramento troca só `A-Z`, nunca com
  `toLowerCase`/`str.lower`. Onde ficam na superfície pública segue a ADR
  0014 do mdq.
- **R9.** Conversor Moodle XML:
  - importar: `essay` com `responseformat` `noinline` e `attachments` > 0
    vira `upload`. `attachments` vira `maxFiles`; `-1` (sem limite) vira
    `maxFiles: 10`, com aviso no relatório. Antes de fixar, confirmar no
    código do Moodle os valores que `attachments` aceita.
    `maxbytes` > 0 vira `maxSize` inteiro; `0` (limite do site) omite
    `maxSize`. `filetypeslist` vira `extensions` quando são extensões; grupos do
    Moodle (`image`, `document`...) são ignorados com aviso.
    `graderinfo` vira o answer key, como no essay;
  - importar: `essay` com texto na página (qualquer outro `responseformat`) e
    `attachments` > 0 continua `essay`, com aviso de que os anexos do aluno
    foram descartados (o MDQ não tem tipo misto);
  - exportar: `upload` vira `essay` com `responseformat` `noinline`,
    `responserequired` 0, `attachments` = `maxFiles` (ou `-1`, com aviso,
    quando `maxFiles` passa do maior valor finito do Moodle; a ida e volta
    só preserva `maxFiles` dentro desse limite), `attachmentsrequired` 1, `maxbytes` em bytes (0 quando omitido) e `filetypeslist` com as
    extensões separadas por vírgula;
  - importar: `filetypeslist` só com grupos ou tipos MIME deixa
    `extensions` vazio, o que aceita qualquer arquivo; avisa. Um
    `attachmentsrequired` > 1 não tem equivalente; avisa. `noinline` com
    `attachments` 0 continua essay, como hoje;
  - os outros formatos (GIFT e Aiken) recusam `upload` ao exportar, pelo
    `supports` que já recusa um tipo que não representam.

### mdq-js

- **R10.** O mesmo que R7 e R8 na mdq-js, passando o mesmo corpus.
- **R11.** Componente SolidJS `upload` em `mdq/solid`, seguindo a ADR 0016
  do mdq (CSS semântico, i18n por prop). O componente não envia nada: recebe
  do host um callback que guarda um arquivo e devolve o item da resposta,
  outro que remove um item, e uma função que dá a URL de download de um
  item. `upload(file)` e `remove(name)` devolvem um resultado discriminado
  (`{ok: true, value}`, `{ok: false, busy: true, retryAfterMs?}` para 429,
  `{ok: false, message}`), sem lançar classe de erro, e o `value` é a
  **lista nova inteira**, que o componente adota como valor. Uma prop
  opcional `normalizeName(name)` do host dá o nome que o servidor vai gravar;
  o componente compara nomes e confere `extensions` sobre ele (um nome igual
  substitui o item, mesmo com `maxFiles` cheio). Confere `maxFiles`, `maxSize` e `extensions` antes de chamar o host e
  mostra o motivo da recusa. Envia um arquivo por vez, em série, nunca em
  paralelo. Quando o host recusa por excesso de envios simultâneos (o
  codehood responde 429), tenta de novo com espera crescente e mostra que
  está aguardando. Tem modo só leitura (correção, resultado), que
  lista os arquivos com nome, tamanho e link.

### Banco (codehood)

- **R12.** `QuestionType` ganha `UPLOAD`, ligado a `upload` em
  `src/core/schemas/question.ts`.
- **R13.** `AttachmentOwner` ganha `RESPONSE` (com a variante em
  `src/core/schemas/attachment.ts` e o caso em `attachmentSource`). O dono de um arquivo do aluno
  é a tentativa (`attachedToId = Response.id`), não a submissão: autosaves
  que repetem a mesma lista não criam linhas novas. `uploaderId` é quem
  enviou. Nenhuma coluna nova.
- **R13a.** Cota (decisão do humano): um anexo `RESPONSE` conta na cota de
  quem enviou (`BLOB_QUOTA_BY_ROLE`) só enquanto a tentativa aceita
  submissões (`Response.acceptingSubmissions`). Depois de fechada, o
  arquivo fica guardado e sai da conta. Uma tentativa reaberta volta a
  contar; isso pode passar do teto, e só bloqueia envios novos. O disco
  total fica limitado por `maxFiles × maxSize` por questão e tentativa, que
  o professor controla. Se o instrutor envia pelo aluno, a cota cobrada é a
  do instrutor (o `uploaderId` vem do ator).
- **R14.** No codehood, `path` de cada item da resposta é o sha256 do
  arquivo. É um detalhe do codehood; nada fora dele lê o campo.

### Services (codehood)

- **R15.** Envio de arquivo. Um método do service da tentativa (junto de
  `response.answer`) recebe curso, prova, questão, nome e bytes de **um**
  arquivo, e:
  - **antes de gravar qualquer byte**, confere sem transação que a tentativa
    está aberta e é do ator, que a questão é `upload` da prova, e que
    tamanho, extensão, `maxFiles` e cota cabem. Assim um usuário não enche
    o disco fora da cota enquanto o GC de 24 h não passa;
  - **antes da transação**, grava os bytes por um `blob.storeBytes` novo, sem
    transação: grava o arquivo, depois faz upsert da linha `Blob`, e traz de
    volta um blob marcado como apagado. Se o GC marcar o blob entre esse
    passo e o anexo, o `attach` lança `NotFound`; o service repete o
    `storeBytes` e o `attach` uma vez, com os bytes que já estão em memória,
    antes de devolver erro. Hoje `attachment.create` chama `blob.create`
    dentro da transação e não serve. Este passo calcula o hash
    (escrever bytes dentro da transação segura o lock de escrita do SQLite
    durante o `fsync`; ver `dev/issues/lentidao-na-prova-de-2026-11-18.md`).
    Um blob gravado e não usado é recolhido pelo GC que já existe;
  - **numa transação de escrita** (que toma o lock antes de ler a lista atual,
    para que dois envios da mesma tentativa não se percam):
    - confere de novo, agora sob o lock, tudo o que `answer` confere (tentativa aberta, janela, questão
      da prova, autor);
    - confere a questão: é `upload`; o arquivo não está vazio (0 bytes é
      recusado no codehood, embora o MDQ o aceite); o tamanho cabe em `maxSize` e no teto
      do servidor `MAX_UPLOAD_BYTES`; o nome **sanitizado** casa com
      `extensions`; a lista nova cabe em `maxFiles`. Usa as funções de R10,
      não reimplementa;
    - solta o arquivo substituído antes de anexar o novo, e confere a cota
      (R13a) sem ele; a pré-checagem fora da transação faz a mesma conta.
      Nenhum desconto vem do cliente;
    - cria (ou reaproveita) o `Attachment` com dono `RESPONSE` por
      `attachment.attach`, que só grava linhas e guarda o nome já preparado
      por `uploadFilename` (que preserva a extensão aceita, como `.tar.gz`)
      sem sanitizar de novo;
    - grava uma submissão `AUTOSAVE` com a lista atual mais o arquivo. Um
      arquivo com nome que já está na lista substitui o item;
    - solta os arquivos que deixaram de ser citados (R17).
  O nome gravado é o nome sanitizado do `Attachment`, e a unicidade de
  `name` é conferida sobre ele. O MDQ aceita nomes com quebra de linha e
  outros caracteres de controle; `sanitizeFilename` precisa removê-los antes
  de o nome chegar ao `Content-Disposition` (teste em T-C2b). O método devolve a lista nova e o `publicId`
  da submissão gravada, porque a página precisa dele para os links de R21.
- **R16.** Remover um arquivo é uma operação por nome, no mesmo service: o
  servidor calcula a lista nova a partir da atual, na mesma transação de
  escrita de R15, e grava `null` quando a lista fica vazia. A página nunca
  manda a lista inteira, para que uma lista velha não apague um envio mais
  novo. `response.answer` numa questão `upload` só aceita `null` (pular) ou a
  lista atual sem mudança (o autosave e a promoção a `FINAL`); qualquer outra
  lista é erro 400 (ADR 0016). `null` tira todos os arquivos da resposta
  (o botão "limpar" da página, que pede confirmação na `upload`); os que
  uma submissão corrigida ou com pedido de revisão cita continuam guardados
  (R17).
- **R17.** Limpeza (decisão do humano: atual e corrigidos). Depois de cada
  gravação numa questão `upload` (envio, remoção e `answer`; uma questão
  sem `worker` nunca recebe `FINAL`), o service solta os `Attachment` com dono `RESPONSE` dessa
  tentativa que não são citados por:
  - a submissão mais nova **do aluno** (`createdById` nulo) de cada questão
    `upload` da tentativa;
  - qualquer submissão com `Feedback` ou `RegradeRequest`.
  Soltar segue `detachExcept` (sem tombstone; o GC de 24 h recolhe o blob),
  não `attachment.delete`, que apaga os bytes na hora. O `detachExcept` de
  hoje recebe `Record<nome, hash>` e guarda um hash por nome; a tentativa
  pode ter `relatorio.pdf` com dois hashes (corrigido e atual, ou duas
  questões). A operação recebe a lista de pares `(hash, nome)` a manter,
  com teste desse caso. Um autosave antigo pode
  citar um arquivo solto: a rota de download responde 410.
- **R18.** Apagar uma tentativa solta os anexos `RESPONSE` dela, porque o
  dono polimórfico não tem cascata. Hoje só `remove` e `restartPreview` em
  `response.service.ts` apagam tentativas. Como rede de segurança,
  `deleteOrphanAttachments` em `blob.service.ts` passa a reconhecer o dono
  `RESPONSE`.
- **R19a.** Pontos que listam tipos ou mostram respostas e ganham o caso
  `upload`: `src/mdq/public-schema.ts`, `question-display.ts` (rótulo),
  `response-summary.ts` (nomes dos arquivos; `answer-text.ts` não ganha o
  caso, para a correção usar a view do componente, que tem os links),
  `question-list-query.ts`, `src/mdq/factory.ts`, `src/mdq/fixtures.ts`, e
  `grading/[question].astro` (`hasKey` exclui `upload` como exclui `essay`).
- **R19.** O histórico de edição (`AnswerEditField`) ignora questões
  `upload`, porque a resposta não é texto digitado. A questão `upload` nunca
  vai para um worker.

### Sigilo e servir arquivos (codehood)

- **R20.** Adendo à ADR 0010 (decisão do humano): em produção o proxy serve
  a pasta de blobs direto do disco, então `/files/<hash>` não passa pelo
  servidor e o sigilo de um arquivo de aluno é o hash, como nos anexos de
  questão e de prova. O hash de um arquivo de aluno só chega ao autor e a
  quem corrige a prova: nenhum read model, página ou cabeçalho (ETag
  incluso) visto por outro aluno o contém, e as páginas usam a rota de R21,
  que endereça por nome, nunca o link `/files/<hash>`. O `serve` do
  servidor não muda. Um anexo `RESPONSE` nunca cria o link com nome ao lado
  dos bytes no disco: o proxy serviria `/files/<hash>/x.html` como HTML na
  origem do app, e o autor conhece o hash do próprio arquivo.
- **R21.** Rota de download autenticada, como endpoint Astro em
  `src/pages/api/course/...` (o modelo das rotas de anexo da prova, porque o
  registro REST só devolve JSON), com o helper de URL em
  `src/urls/attachments.ts`:
  `GET /api/course/<discipline>/<course>/exam/<exam>/submission/<submission>/file/<name>`,
  com o `publicId` da submissão. A rota identifica a submissão, e não só a
  questão, porque o arquivo corrigido e o atual podem ter o mesmo nome com
  hashes diferentes.
  Acessa o autor da tentativa e quem pode corrigir a prova; o aluno nunca
  lê a tentativa `preview` do instrutor. Para quem não pode ler, a rota
  responde 404, não 403, para não confirmar que a submissão existe. A rota
  lê os bytes por stream, sem carregar o arquivo inteiro na memória. `<name>` é comparado ao nome
  sanitizado. Serve qualquer arquivo que a submissão cita e que ainda está
  anexado à tentativa; 410 só quando o arquivo foi solto (R17). Cabeçalhos: `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `Cache-Control: private`, e
  `Content-Security-Policy: sandbox; default-src 'none'` em tudo que não for
  PDF. `Content-Disposition: inline` só para PNG, JPEG, GIF, WebP e PDF, por
  uma lista própria desta rota (não o `isInlineMimeType` atual, que trabalha
  por prefixo); qualquer outro tipo vai como `attachment`, para que um HTML
  ou SVG do aluno nunca rode na origem do codehood. T-C3 confere no Chrome
  e no Firefox que o PDF abre; se o visor exigir, o PDF vai como download.
- **R22.** Transporte (decisão do humano): o envio é uma rota REST
  `POST /api/course/<discipline>/<course>/exam/<exam>/question/<question>/file`,
  `inMultipart: true`, um arquivo por requisição, sem campo de autor (a
  cota é sempre de quem envia), aceita com a sessão do
  navegador (basta a sessão; a chave de API também serve, como no resto do
  registro). `readMultipart` perde `File.name`, então o nome vai numa parte
  de texto `name` do `in`. A resposta traz a lista e o `publicId` da
  submissão (R15). Passa por
  `acquireUploadSlot` e `readLimited` (`MAX_UPLOAD_BYTES`), e responde 429
  acima dos slots. A remoção é
  `DELETE .../question/<question>/file/<name>`, pela mesma regra de R16. Uma
  action do Astro não serve: `actionBodySizeLimit` é 8 MiB, global, e as
  actions não alcançam os slots. Se a mudança alterar a OpenAPI,
  `pnpm run openapi:cli`.

### Telas (codehood)

- **R23.** Página da prova: a questão `upload` usa o componente de R11. O
  envio e a remoção chamam as rotas de R22. O "limpar" da `upload` remove cada
  arquivo pela rota DELETE, em série, e nunca passa pela fila de autosave
  nem pelo histórico de edição: um `null` atrasado na fila apagaria um envio
  feito depois. Sessão perdida (401) segue o mesmo caminho do autosave. O `onChange` da `upload` não
  passa pela fila de autosave de `ExamAttempt.tsx`: um `answer` com a lista
  velha, chegando depois de um envio, seria recusado (R16). O motivo de uma recusa do
  servidor aparece no componente, e um 429 vira nova tentativa com espera.
  O callback de envio do host converte erro de rede em `busy`, porque o
  componente só tenta de novo nesse caso. O gabarito vai pela prop
  `answerKey` do componente (as respostas corretas do upload vêm vazias), e
  o CSS das classes `.mdq-upload*` fica em `src/styles/mdq.css`.
- **R24.** Correção (`exams/[slug]/grading/[question].astro`), tentativa do
  aluno (`attempts/[username].astro`), revisões (`regrades.astro`, que
  passa a ter a submissão para montar o link), resultado e simulação mostram os
  arquivos em modo só leitura, com links da rota de R21. A nota é manual com
  a rubrica, como no essay.
- **R25.** Mensagens novas em `messages/en` e `messages/pt-BR`.

### CLI (codehood)

- **R26.** A CLI envia questões `upload` pelo push (mdq-py de R7) e as mostra
  onde lista tipos. Baixar os arquivos dos alunos pela CLI fica fora do
  escopo. Se a OpenAPI mudar (enum de tipo), `pnpm run openapi:cli`.

### Dados de dev

- **R27.** Uma questão `upload-diagram` no cs101 (`maxFiles: 2`,
  `maxSize: 5 MB`, `extensions: [".pdf", ".png", ".jpg"]`, com answer key),
  em provas que já existem no seed:
  - `quiz-02` (prova aberta): o aluno de dev envia arquivos; é o estado
    "ainda pode enviar";
  - `test-02`: enviado e pendente (ritchie, PDF e PNG), corrigido com
    comentário (hopper), pulou (thompson) e entregue (liskov). A tentativa de
    liskov não é reaberta, porque o seed já usa a janela pessoal dele para o
    estado "uma exceção mantém a janela aberta depois do fim da prova".
  Os arquivos saem de `minimalPdf` e `solidPng`, que já existem.

## Decisões registradas

- **J1.** `upload` é tipo próprio, não `essay` com `content: file`
  (conversa de 2026-11-19). O Moodle usa o essay com anexos; o conversor do
  mdq-py traduz (R9).
- **J2.** `path` na resposta, sem hash: o endereçamento por conteúdo é
  detalhe do codehood (R14).
- **J3.** Dono `RESPONSE` em vez de `SUBMISSION`: a cota é por linha de
  `Attachment` (`usageBytes` soma `blob.size` de cada linha), e
  `attachment.create` reaproveita a linha com o mesmo `(hash, nome, dono)`.
  Reenviar o mesmo arquivo com o mesmo nome na mesma tentativa não gasta
  cota de novo.
- **J4.** Ficam guardados só o arquivo da resposta atual e os de submissões
  corrigidas ou com pedido de revisão (R17), para que versões substituídas
  não comam a cota do aluno.
- **J5.** Um arquivo por requisição. Vários arquivos são várias chamadas, o
  que mantém a memória por requisição no teto de `MAX_UPLOAD_BYTES`.
- **J6.** `maxSize` usa potências de 1024 e unidades em maiúsculas, como
  `parseByteSize` do codehood e o Moodle.
- **J7.** A versão do mdq não é publicada nesta tarefa. O codehood lê
  `../mdq/mdq-js` por `link:`; `.mdq-ref` é atualizado com
  `pnpm run mdq:bump` só depois de o humano commitar o mdq. Até lá,
  `check:siblings` avisa no `lint` e falha no CI e no release.
- **J8.** O campo de extensões é `extensions`, não `accept`, porque `accept`
  já é o gabarito privado de short-answer, fill-in e ordering (decisão do
  humano).
- **J9.** Transporte REST (R22), limpeza "atual e corrigidos" (R17) e cota só
  de tentativas abertas (R13a): decisões do humano em 2026-11-19, depois da
  revisão do advisor.

## Fora do escopo

- Baixar pela CLI os arquivos enviados pelos alunos.
- Pré-visualizar outros tipos de arquivo na página (planilha, código).
- Conferir o conteúdo do arquivo (assinatura de PDF, antivírus).
- Cota por curso.
- Questão mista (texto e arquivo na mesma questão).

## Plano de ação

Coordenação: o coordenador escreve o formato (`upload.md`, `upload.yaml`) e
esta spec; um advisor revisa spec e plano antes do código. Cada frente tem um
sub-coordenador que revisa sua parte desta spec e despacha implementadores.

### Frente mdq-spec (coordenador)

- **T-S1. Propagação na spec** (R4). Arquivos: os de R4. Modelo `sonnet`.
  Pronto: `r2 check-spec` passa.
- **T-S2. Corpus** (R5). Arquivos: `examples/`. Modelo `sonnet`. Depois de
  T-S1, em série: o audit regenera os mesmos bundles. Pronto: `r2 check-spec`
  passa com os exemplos novos.

Depois de T-S2, `docs/`, `schema/` e `examples/` ficam com o coordenador. As
frentes mdq-py, mdq-js e mdq-vscode não editam esses diretórios: um defeito
achado neles volta ao coordenador, que corrige e avisa as frentes.

### Frente mdq-py (sub-coordenador)

- **T-P1. Tipo `upload`** (R7, R8). Depende de T-S1 e T-S2. TDD pelo
  corpus. Pronto: `r2 check-py` passa e nenhum exemplo de `upload` fica
  fora dos testes.
- **T-P2. Conversor Moodle XML** (R9). Depende de T-P1. Pronto: testes de
  ida e volta do conversor, `r2 check-py`.

### Frente mdq-js (sub-coordenador)

- **T-J1. Tipo `upload`** (R10). Depende de T-S1 e T-S2. Pronto:
  `r2 check-js` e nenhum exemplo de `upload` em `tests/not-ported.ts`.
- **T-J2. Componente `upload`** (R11). Depende de T-J1. Pronto: teste do
  componente (recusa por tamanho, extensão e quantidade; chama o host; modo
  só leitura), `r2 check-js`, e o build que o codehood importa atualizado.

### Frente mdq-vscode (sub-coordenador da mdq-js)

- **T-V1. `mdq-vscode`**: `src/webview/grade.ts` e testes (upload sempre
  pendente) depois de T-J1, em haiku; o Preview com callbacks falsos depois
  de T-J2, em sonnet. Pronto:
  `cd mdq-vscode && pnpm test && pnpm typecheck && pnpm lint && pnpm build`.

### Frente codehood (sub-coordenador)

Pré-condição: o humano commitou as mudanças pendentes em
`prisma/schema.prisma` e `src/db/services/response.service.ts`, que são de
outro trabalho.

Tarefas que não dependem da mdq-js começam assim que a pré-condição for
cumprida; as outras esperam T-J1. `openapi:cli` roda em série (T-C1a, T-C1b,
T-C4). `messages/*` é de T-C2b e depois de T-C6, nunca ao mesmo tempo.

- **T-C1a. Dono `RESPONSE`** (R13). Sonnet. `schema.prisma`,
  `src/core/schemas/attachment.ts`, `attachment.service.ts`,
  `pnpm run openapi:cli`. Antes da mdq-js. Pronto: `pnpm run db:generate`,
  `pnpm run lint`.
- **T-C2a. Cota, blobs e limpeza** (R13a, R17 na parte de
  `attachment`, R18, `blob.storeBytes`,
  `attach` por pares). TDD: projetista opus, escritor e implementador
  sonnet. `attachment.service.ts`, `blob.service.ts`, `response.service.ts`
  (só `remove` e `restartPreview`), specs `unit`. Depende de T-C1a. Pronto:
  `rtk pnpm run test:unit`.
- **T-C1b. Tipo `UPLOAD`** (R12, R19a). Sonnet. Depende de T-J1. Os
  arquivos de R19a, `pnpm run openapi:cli`. Pronto: `pnpm run lint`.
- **T-C2b. Envio, remoção e `answer`** (R14 a R17, R19). TDD com o mesmo
  projetista. `response.service.ts`, `src/core/schemas/response.ts`,
  mensagens de erro. Depende de T-C2a e T-C1b. Pronto: specs `unit` novas,
  incluindo dois envios concorrentes e a ordem cota/substituição.
- **T-C3. Rota de download** (R21). Sonnet. Endpoint Astro e helper em
  `src/urls/attachments.ts`. Depende de T-C4 (o e2e precisa enviar um
  arquivo por HTTP). Pronto:
  adendo na ADR 0010 (R20); e2e com 403 para outro aluno e para a `preview`,
  200 para autor e instrutor, `attachment` para `.html`, PDF abrindo no
  Chromium e no Firefox.
- **T-C4. Rotas de envio e remoção** (R22). Sonnet. `src/api/index.ts`,
  `pnpm run openapi:cli`. Depende de T-C2b. Pronto: e2e de 429, de corpo
  acima do teto e de envio só com a sessão.
- **T-C5. Histórias de usuário** (aluno envia, troca, remove e é recusado;
  instrutor corrige e abre o arquivo). Sonnet. `docs/user-stories/*`,
  `test/stories/*`. Depende de T-C4 e T-CH1 (as histórias usam o seed
  final). Pronto: falham porque a tela não existe.
- **T-CH1. Seed** (R27): questão `upload-diagram` no cs101, em `quiz-02`
  (prova aberta, "uma questão de cada tipo") e em `test-02`
  (`seedGradingShowcase`: enviado e pendente, corrigido com comentário,
  pulou, e `liskov` com janela pessoal aberta). Arquivos de `minimalPdf` e
  `solidPng`, que já existem. Sonnet. Depende de T-C2b. Pronto:
  `pnpm run db:reset`, os estados vistos no dev server e `rtk pnpm test`
  inteiro (uma questão a mais nessas provas pode quebrar specs que contam
  questões ou notas).
- **T-C6. Telas** (R23 a R25). Sonnet. `src/components/{exam,grading,question}`,
  páginas, `messages/*`, CSS `mdq-upload-*` em `src/styles/mdq.css`. Depende
  de T-J2, T-C3, T-C4, T-C5. Pronto: as histórias de T-C5 passam e
  `pnpm run test:tour` sem componente órfão.
- **T-C7. CLI** (R26). Sonnet. `cli/`. Depende de T-P1 e T-C1b. Pronto:
  `rtk uv run pytest` em `cli/`.
- **T-C8. Fechamento.** `pnpm exec biome check --write .`, `pnpm run lint`,
  `rtk pnpm test`; spec para `dev/specs/to-review/`, `CHANGELOG.md`, issue
  `questao-de-upload` apagada, `GLOSSARY.md` se o humano aprovar o termo. O
  relatório final diz que o CI do codehood só fica verde depois de o humano
  commitar o mdq e rodar `pnpm run mdq:bump` (J7).

A mdq-js é importada pelo `dist/` (`exports` do `package.json`): cada
mudança da mdq-js que o codehood precise ver exige `cd mdq-js && pnpm build`,
feito pela frente mdq-js só ao fechar T-J1 e T-J2, com aviso ao
coordenador, para não trocar o `dist/` no meio de testes do codehood.

## Critérios de aceite

- `r2 check` passa no mdq.
- Uma questão `upload` escrita em Markdown sobe pela CLI, aparece na prova,
  recebe um PDF e uma imagem, recusa um `.exe` e um arquivo acima de
  `maxSize` com o motivo, e é corrigida com a rubrica. Evidência:
  screenshots da página da prova e da correção.
- Um arquivo de aluno não é baixado por outro aluno, e o hash dele não
  aparece em nada que outro aluno veja.
- Trocar um arquivo várias vezes deixa só o último na cota do aluno, e
  depois de fechada a tentativa o arquivo sai da cota.
- Dois envios simultâneos na mesma questão deixam os dois arquivos na
  resposta.
- Um XML do Moodle com essay `noinline` importa como `upload` e volta.
- `pnpm run lint` e `rtk pnpm test` passam.
