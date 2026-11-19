---
type: issue
status: backlog
tags: [answer-history, sqlite, schema]
relatedTo: [lentidao-na-prova-de-2026-11-18]
kind: enhancement
priority: low
created: 2026-11-19
creator: claude
---

# Guardar o histórico de edição num blob JSONL por campo

**Precisa de estudo antes de qualquer implementação.** Não está claro que
vale a pena: o ganho estimado é pequeno e a mudança mexe na retentativa dos
lotes. Esta issue registra a ideia e o que falta responder.

## A ideia

Eliminar `AnswerEditBatch` e `AnswerEditGap` e guardar o histórico inteiro de
cada campo numa coluna de texto de `AnswerEditField`, em JSONL: uma linha por
lote, e uma linha por buraco na posição em que ele aconteceu. O servidor
acrescenta com `SET log = log || ?`, sem ler nem interpretar o que já está
gravado.

## O que se sabe

Medido em produção em 2026-11-19, depois de um dia de provas:

| Tabela | Linhas | Tamanho |
| :-- | --: | --: |
| `Submission` com `kind = AUTOSAVE` | 162 632 | 149 MB de `payload` |
| `AnswerEditBatch` | 6 883 | 4,9 MB de `edits` |
| `AnswerEditField` | 1 307 | 1,8 MB de `text` |

- São cerca de 5 lotes e 3,7 KB de edições por campo. O volume do banco está
  nos autosaves, não aqui.
- O SQLite não acrescenta no lugar: cada append regrava o valor inteiro da
  coluna. Com blobs de poucos KB isso não pesa, mas cresce com o histórico, ao
  contrário do insert de um lote.
- O número de commits não muda: um append e um insert são uma transação cada.
- A coluna teria de ser `String`; com `Json` do Prisma não há append sem
  regravar o documento pelo cliente.

## O que as tabelas garantem hoje

- Retentativa: `batchId` e `contentHash` únicos por campo distinguem o reenvio
  de um lote de um id reusado com outro conteúdo.
- Ordem: a unicidade de `(fieldId, revision)` impede no banco dois lotes na
  mesma revisão.
- Metadados por lote em colunas (`sessionId`, `lateMs`, `baseText`,
  `gapBefore`), que `answer-history-stats` soma sem interpretar JSON.

## O que falta estudar

- Ler `src/db/services/answer-edit.service.ts` e listar o que a retentativa
  exige. O que está acima vem dos comentários do schema, não do código.
- Decidir como detectar o reenvio sem interpretar o blob (por exemplo, id e
  hash do último lote no próprio campo) e se isso cobre todos os casos de hoje.
- Medir o custo real de um `answerHistory.send` antes e depois, com o teste de
  carga, e o tamanho máximo de um blob numa prova longa.
- Avaliar a migração: transformar os lotes existentes em linhas é uma mudança
  de dados numa funcionalidade recém-lançada.
- Reavaliar depois da consolidação dos autosaves, que resolve o volume por
  outro caminho e pode tornar esta mudança desnecessária.
