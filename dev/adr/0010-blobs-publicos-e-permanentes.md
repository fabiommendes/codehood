---
type: adr
status: accepted
tags: [blob, resource, seguranca]
created: 2026-11-03
decided: 2026-09-02
creator: claude
---

# Blobs são públicos e permanentes

A URL de um blob é o sha-256 dos seus bytes, e `/files/<hash>[/<name>]` serve o
arquivo sem checar autenticação. Quem conhece a URL tem o arquivo, para sempre.
Por isso nada cuja divulgação importe pode virar um recurso.

## Contexto

`BlobService.serve` (`src/db/services/blob.service.ts:392`) atende as duas
rotas de blob sem consultar o actor; o hash é validado só quanto ao formato. A
tabela de rotas marca `/files/` com acesso "none" (`src/urls/README.md:124`).
A primeira versão dizia que a URL era um "slug imprevisível". Não é: o hash de
um PDF público, da apostila do ano passado ou de um arquivo que o aluno já tem
é calculável. A correção foi aceita na entrega dos recursos (commit `fafab0d`,
2026-09-02; `CHANGELOG.md`, entrada "Course resources are real").

## Decisão

- O blob é endereçado pelo hash do conteúdo, que também é o nome no disco.
  Bytes iguais viram um blob só, compartilhado entre cursos.
- Nenhuma checagem de autenticação em `/files/`. O acesso é irrevogável por
  projeto.
- Recursos não carregam nada cuja divulgação importe: prova antes da janela,
  gabarito, feedback individual, qualquer coisa que identifique um aluno. Uma
  flag `private` pode mudar isso no futuro.
- Adivinhar o hash só muda quem chega a um arquivo que já não era segredo: de
  "quem recebeu o link" para "quem tem o mesmo arquivo". O modelo de ameaça é
  o mesmo.

## Consequências

- Um aluno que compartilha o link dá acesso a quem recebeu e a quem esses
  repassarem.
- Logs de acesso do proxy contêm as URLs: ler o log é ler os arquivos.
- O cabeçalho `Referer` vazaria a URL para sites de terceiros. A página de
  recursos (`src/pages/[discipline]/[course]/resources.astro:35`) e as
  respostas de blob (`src/utils/blob-response.ts:30`) mandam
  `Referrer-Policy: no-referrer`.
- Remover o blob deixa um tombstone (`deletedAt`) e a rota responde `410`
  (`blob.service.ts:403`), mas cópias já baixadas não voltam.
- `POST /api/blob/missing` é aberto a qualquer usuário autenticado
  (`src/api/index.ts:408`): saber o hash já dá acesso aos bytes.
- `manage import-resources` lembra a regra ao final de cada importação
  (`src/commands/import-resources.ts:128-131`).

## Adendo (2026-11-13): anexos de questões e provas

Um blob de anexo de questão ou de prova também é servido por `/files/<hash>`,
com a mesma regra. O sigilo vem de o hash nunca chegar ao aluno: nenhum read
model de aluno, página de aluno ou cabeçalho de resposta (ETag incluso) contém
o sha256 de um anexo. O aluno baixa o anexo só pelas rotas da prova, que
conferem a janela de abertura.

## Adendo (2026-11-19): arquivos de respostas de upload

O proxy de produção serve o diretório de blobs direto do disco, sem passar pelo
app. Para o arquivo de um aluno, o hash é então o único segredo. Ele chega só
ao autor da tentativa (a resposta do POST traz `files[].path`) e a quem pode
corrigi-la; nenhum outro leitor o vê. Por isso um anexo de `RESPONSE` nunca
ganha o link nomeado ao lado dos bytes, que o proxy serviria como
`/files/<hash>/<nome>`, e a rota lê sempre pelo caminho dos bytes. As páginas apontam para a rota
autenticada `/api/course/<disciplina>/<curso>/exam/<prova>/submission/<id>/file/<nome>`
(R21), sempre pelo nome, nunca por `/files/<hash>`. A rota responde 404 a quem
não pode ler a tentativa (um aluno nunca lê a prévia do instrutor) e ao nome
que a submissão não cita, para não confirmar que o arquivo existe; e 410 ao arquivo que a tentativa deixou de manter.
Fora o POST do próprio autor, nenhuma resposta traz o hash, nem em ETag.
`serve` não muda.

O proxy deve servir `/files/` com `X-Content-Type-Options: nosniff`,
`Content-Security-Policy: sandbox` (menos em PDF) e `Content-Disposition:
attachment` para tudo que não seja imagem ou PDF (ver "Deploying" no `README.md`). Sem isso,
um anexo com link nomeado que algum usuário enviou (um `.html` num relato de
erro, por exemplo) roda como página na origem do app. O arquivo de resposta
de upload não depende disso, porque não tem link nomeado.
