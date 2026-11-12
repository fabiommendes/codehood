---
type: rfc
status: draft
tags: [cli, sync, push, pull, mdq]
relatedTo: [0011-contrato-de-sync-entre-cli-e-servidor, 0012-conteudo-no-repositorio-dados-do-aluno-no-servidor]
created: 2026-11-12
creator: claude
---

# Sync bidirecional entre CLI e servidor

## Problema

O `ch push` trata o repositório como única fonte de verdade: compara o hash
local com o `rev` gravado no servidor e reescreve o que difere (ADR 0011,
last-write-wins). Qualquer edição feita no servidor é desfeita no push
seguinte, e uma entidade criada no servidor é apagada pelo prune.

Hoje isso quase não dói, porque a web só altera estado (status de questão,
liberação de notas, exceções de exame, rubricas, roll call) e a ADR 0012
proíbe editar conteúdo. Mas o plano é ter interfaces web para criar exames e
subir recursos, e elas são inviáveis com o contrato atual.

## Objetivo

1. O push nunca sobrescreve nem apaga uma mudança feita no servidor. Ele
   avisa a discrepância.
2. A CLI baixa a mudança do servidor e a aplica nos arquivos locais.
3. Quando os dois lados mudaram a mesma entidade, a CLI recusa aquela
   entidade, mostra a diferença e exige uma escolha explícita.

Fora do objetivo: merge automático de texto, edição simultânea em tempo real,
construir os editores web (cada um terá sua própria spec).

## Desenho

### Três vias com base local

A CLI passa a guardar a **base**: a forma canônica de cada entidade no último
sync bem-sucedido. Cada execução compara três estados por entidade, pela chave
natural que já existe:

| Local vs base | Servidor vs base | Decisão                          |
| :------------ | :--------------- | :------------------------------- |
| igual         | igual            | `Skip`                           |
| mudou         | igual            | `Put` (como hoje)                |
| igual         | mudou            | `Pull`                           |
| mudou         | mudou, iguais    | `Skip` e atualiza a base         |
| mudou         | mudou, diferentes| `Conflict`                       |
| ausente       | igual            | `Prune` (apagado localmente)     |
| igual         | ausente          | `Pull` de remoção                |
| ausente       | mudou            | `Conflict`                       |
| mudou         | ausente          | `Conflict`                       |
| novo          | não existe       | `Put`                            |
| não existe    | novo             | `Pull` de criação (nunca `Prune`)|

Casos que a tabela acima não cobre:

- **ausente / ausente, com base:** só tira a entidade da base.
- **novo / novo, mesmo slug:** `Skip` se iguais, `Conflict` se diferentes.
- **Rename com edição do outro lado:** um "novo" e um "ausente" cuja forma
  canônica é igual à da base são pareados num único `Conflict` de rename, em
  vez de um `Put` e um `Conflict` soltos.
- **Arquivo em `[push] exclude`:** sempre `Skip`, nos dois sentidos.
- **`InvalidQuestion`:** continua `Keep`, nunca "ausente".
- **Status de questão:** fora da forma canônica. `join_status` continua sendo
  a regra, porque `HIDDEN` não tem forma local.
- **Vínculo recurso-aula e remoção de recurso referenciado:** `Conflict`,
  nunca `Pull`, enquanto `calendar.md` estiver fora do pull. O vínculo mora em
  `calendar.md`, e apagar um recurso ainda referenciado quebra todo push
  seguinte com `ResourceLinkError`.

"Forma canônica" é o payload que a CLI envia, depois das transformações de
ida (links reescritos para URLs do servidor, slugs em vez de objetos). A base
guarda o que foi enviado, o local passa pela transformação de ida antes de
comparar, e cada tipo de recurso ganha uma projeção `read model -> payload`
que desfaz as normalizações de leitura do servidor (duração, ids preenchidos,
documento mdq normalizado). A transformação inversa dos links só é usada pelos
writers, nunca na comparação: várias grafias locais dão a mesma URL, e
comparar no espaço local geraria diferenças falsas.

### Mudança vinda de outra CLI

Se o servidor mudou e `server.rev` difere de `base.rev`, quem escreveu foi
outra CLI (outra máquina ou outro instrutor), e a fonte original está no git.
A CLI não faz `Pull`: pede `git pull`. Fazer `Pull` regeneraria o arquivo a
partir do JSON e criaria um conflito de merge com o commit do colega.

`Pull` de verdade é só o caso `server.rev == base.rev` com conteúdo diferente:
uma escrita que não veio de CLI.

### Sem mudança de schema

A comparação "servidor vs base" é feita sobre o conteúdo devolvido pelo GET,
projetado para a forma canônica. Não é preciso coluna nova, flag `?sync=true`
nem marca de "editado pela web".

`rev` e `updatedAt` servem só de atalho: se os dois são iguais aos gravados na
base, a entidade não mudou e o corpo não precisa ser baixado. `updatedAt` muda
em escritas derivadas (recalcular eventos, por exemplo), o que custa um GET a
mais e nunca um falso conflito.

O atalho não cobre campos derivados de chave estrangeira: apagar um evento
anula `Resource.event` por `onDelete: SetNull` sem tocar em `rev` nem em
`updatedAt`. Esses campos são comparados sempre, a partir da listagem.

Consequência: toda escrita no servidor que não vem da CLI precisa manter o
`rev` como está. O `rev` continua sendo "hash do último conteúdo que a CLI
enviou".

### Base ausente

Clone novo, segunda máquina ou base apagada. Sem base não há como saber quem
mudou:

- `server.rev` igual ao hash local (a comparação que o push faz hoje): adota
  como base, em silêncio;
- diferentes: `Conflict`. Nunca assume que o local vence.

A primeira execução num repositório existente cai no primeiro caso para quase
tudo. Um arquivo de base ilegível ou gravado pela metade é tratado como base
ausente; a gravação é atômica (arquivo temporário e rename).

### Pull nunca destrói a única cópia

Antes de sobrescrever ou remover um arquivo local, o `Pull` move a versão
anterior para `.local/codehood/trash/`. O arquivo pode nunca ter sido
commitado, e o servidor apaga o anexo antigo quando um FILE é trocado.

### Corrida entre o preflight e o PUT

Sem requisição condicional, uma edição feita na web entre o GET do preflight e
o PUT é sobrescrita, e a base passa a registrar a versão local. A ADR 0013
fecha a corrida: todo `PUT` e `DELETE` da CLI leva `If-Match` com o
`updatedAt` visto no preflight (`If-None-Match: *` para entidade nova), e um
412 vira `Conflict` naquela entidade. O trabalho no servidor está em
`dev/issues/escrita-condicional-nos-services.md`.

### Onde fica o estado local

`.local/codehood/` na raiz do repositório, com um `.gitignore` próprio
contendo `*`, de modo que o diretório se ignora sozinho. `.codehood/` deixa de
existir.

```
.local/codehood/
  .gitignore        # "*"
  base/             # um JSON por coleção: forma canônica + rev + updatedAt
  cache/            # descartável
```

A base fica fora do git porque descreve a relação entre este checkout e o
servidor, não o conteúdo do curso.

### Escrita de volta: writers

Cada formato de arquivo ganha um writer `(fonte, alvo) -> fonte'` que aplica o
novo estado sobre o texto existente com o mínimo de edições. Todo writer
obedece a duas leis, verificadas por testes de propriedade:

1. `parse(write(fonte, alvo)) == alvo`
2. `write(fonte, parse(fonte)) == fonte`

| Formato            | Writer                                              |
| :----------------- | :-------------------------------------------------- |
| Questão mdq        | `sync_question(src, target) -> str`, no `mdq-py`    |
| `codehood.toml`    | edição com preservação de estilo (tomlkit)          |
| `info.yaml`, front matter | edição com preservação de comentários e ordem |
| Recurso MD/CODE    | substitui o corpo e desfaz a reescrita de links     |
| `calendar.md`      | em aberto, ver abaixo                               |

No `mdq-py` a lei 1 vale módulo normalização
(`parse(sync_question(src, t)).normalize() == t.normalize()`), porque o parse
não devolve a forma normalizada nem para um fonte intocado. A CLI compara
local, base e servidor também sobre documentos normalizados. Um alvo que o
markdown não expressa lança `mdq.errors.SyncError`, que a CLI trata como
`Conflict`.

Um id de alternativa igual ao que o parse derivaria do fonte resultante não é
escrito; um id diferente é escrito explicitamente. Quando a web muda o texto
de uma alternativa e mantém o id, o arquivo ganha o id antigo explícito: ele é
a identidade da alternativa e respostas já dadas podem apontar para ele.

Requisito para o futuro editor web de questões: ao mudar um campo do qual
outro é inferido (`answer` e os `domain` e `decimalPlaces` de uma questão
numérica), o editor limpa ou recalcula o inferido. Sem isso o valor velho
desce para o arquivo como campo explícito.

O trabalho está em
`mdq/dev/issues/mdq-py-sync-question-escrita-de-volta-com-edicao-minima.md`.

`sync_question` começa garantindo o round-trip do front matter e reescrevendo
o corpo quando ele muda. Preservar parágrafos intactos e outros invariantes do
markdown vêm depois, sem mudar a assinatura.

### Núcleo e shell

O desenho mantém "núcleo funcional, shell imperativo":

- `plan_sync(local, base, remote)` é pura e substitui `plan_push`. Os
  `merge_*` por entidade recebem a terceira via; `Decision` ganha `Pull` e
  `Conflict`.
- O plano é um dado. O relatório em texto e a TUI são dois renderizadores do
  mesmo plano. A TUI resolve conflitos escolhendo um lado por entidade; o modo
  não interativo usa `--ours` e `--theirs` com globs.
- `run_plan` ganha as operações de escrita local e grava a base ao final, só
  das entidades que deram certo.

### Comandos

Os três comandos calculam o mesmo plano e diferem só em quais decisões
executam. As demais são mostradas e ficam pendentes.

| Comando   | Executa                  | Só mostra          |
| :-------- | :----------------------- | :----------------- |
| `ch sync` | `Put`, `Prune`, `Pull`   | `Conflict`         |
| `ch push` | `Put`, `Prune`           | `Pull`, `Conflict` |
| `ch pull` | `Pull`                   | `Put`, `Prune`, `Conflict` |

## Fases

1. **Detectar e não sobrescrever.** Base local, projeções, `plan_sync`,
   relatório em texto. `Pull` e `Conflict` só são mostrados; a entidade fica
   intocada dos dois lados. Migração de `.codehood/` para `.local/codehood/`.
2. **Pull.** Writers, `ch pull` e `ch sync`, resolução por `--ours` e
   `--theirs`. `sync_question` no `mdq-py`.
3. **TUI.** Tela de revisão do plano e de resolução de conflitos.

Recursos entram no pull por ordem de dificuldade: recursos MD/CODE/LINK,
questões completas, exames (dependem de `push-exams`), e por último o
calendário.

O status da questão não está no arquivo: `DRAFT` vem de um `_` no caminho e
`HIDDEN` só existe no servidor. Baixar uma mudança de status seria renomear o
arquivo, e `HIDDEN` não tem forma local. A regra atual (o status só avança e o
push não o desfaz) continua valendo, fora da tabela de três vias.

## Em aberto


- **Calendário.** A identidade do evento é `(week, timeSlot)` e vem da posição
  do h2 em `calendar.md`. Um evento criado ou movido no servidor não tem
  writer óbvio. Fica fora do pull até haver um desenho.
- **`TimeSlot`** não tem `rev`. Sem o atalho, o corpo é sempre comparado, o
  que é barato.
- **Custo do preflight.** Comparar conteúdo exige que as listagens devolvam os
  corpos ou que o atalho `rev` + `updatedAt` filtre bem. Medir num curso real.
- **Repositórios e colunas de nota** ficam em sentido único.

## Documentos afetados

- ADR 0011 é substituída: last-write-wins e "sem estado local" deixam de valer.
- ADR 0012 é revista quando o primeiro editor web de conteúdo for especificado.
- `cli/dev/specs/to-do/push.md`, `cli/GLOSSARY.md` ("no `codehood pull`"),
  `GLOSSARY.md` e `README.md` na raiz.
