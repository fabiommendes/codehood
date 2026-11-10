---
type: issue
status: todo
tags: [exam, editor, monitoring]
kind: bug
priority: medium
created: 2026-11-10
creator: claude
---

# Remontar um campo com envio em voo gera conflito falso

## Problema

`AnswerEditCoordinator.open` chama `transport.inspect` antes de
`await this.delivery`. Se a inspeção volta com o estado anterior ao ACK e o ACK
chega durante a recuperação, a base local já avançou e a comparação com a
inspeção antiga falha. O resultado é `conflict` com `Server baseline diverged`,
embora cliente e servidor estejam de acordo.

Navegar entre questões durante o envio periódico basta para cair nisso. Pelo
contrato atual, `conflict` não devolve handle e bloqueia o envio do campo.

## Reprodução

`test/answer-edit-coordinator-races.spec.ts`, teste marcado `test.fixme`:
"recovery inspected before an ACK that lands during it stays ready".

## Correção sugerida

Inspecionar depois que a entrega em curso terminar, ou repetir a inspeção quando
um ACK for aplicado durante a recuperação. O teste assume que o resultado
correto é `ready`.

A regra R5 da RFC (divergência vira nova base com lacuna, sem bloquear) torna o
conflito inofensivo para o aluno, mas um conflito falso ainda registraria uma
lacuna que não existe.
