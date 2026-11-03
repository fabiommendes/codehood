---
type: issue
status: deferred
tags: [tooling, base, glossary, agents]
relatedTo: [glossary, agents-md, base-domains]
kind: task
created: 2026-09-30
creator: Fábio Macêdo Mendes
---

# Injetar definições do glossário sob demanda pelo base

## Contexto

O `AGENTS.md` manda todo agente ler a lista de termos do glossário no início
da sessão e fazer grep no `GLOSSARY.md` para cada definição de que precisar.
É um grep frágil por termo, em toda sessão, em três repositórios (servidor,
CLI, mdq).

O `base` não consegue fazer isso a partir de um documento sincronizado: o
`base sync` guarda o `GLOSSARY.md` como um nó só, com arestas `hasSection`,
o `base recall --keyword` não encontra as seções, e o hook de prompt injeta
por domínio encontrado, não por termo mencionado. O que ele consegue é
associar uma palavra-chave a um domínio e injetar as regras desse domínio uma
vez por sessão.

## Requisitos

- R1. Um domínio por termo do glossário, em `~/git/codehood/.base/domains.toml`,
  com `prompt_keywords = ["<term>"]` e `file_keywords` com o mesmo termo.
  - Aceitação: um prompt ou um arquivo tocado que menciona o termo traz a
    definição.
- R2. A definição é a única regra do domínio (`base rule add`).
  - Aceitação: cada domínio de termo tem exatamente uma regra, com o texto
    da definição.
- R3. Um script, `~/git/codehood/.base/scripts/glossary-to-base`, lê as
  seções `## Term` dos três glossários e regenera domínios e regras,
  removendo os de termos que saíram. Roda à mão depois de editar um
  glossário, ou no hook de início de sessão.
  - Aceitação: depois de remover um termo de um glossário e rodar o script,
    o domínio e a regra dele somem.
- R4. O `AGENTS.md` deixa de ter as instruções de grep e diz que as
  definições chegam pelo `base` quando um termo aparece, com o `GLOSSARY.md`
  ainda como a fonte a editar.
  - Aceitação: o `AGENTS.md` não manda mais fazer grep no glossário.

## Custo e alternativa

Cerca de 45 domínios e regras que precisam acompanhar os glossários, daí o
script. Alternativa sem script: todas as definições como notas de um único
domínio, o que injeta a lista inteira a cada correspondência, cerca de 1,5k
tokens por sessão.
