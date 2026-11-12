---
type: issue
status: backlog
tags: [exam, answer-edits]
kind: feature
priority: low
created: 2026-11-11
creator: claude
---

# Histórico local da prova não é lido nem enviado

A página de prova registra o histórico de edição no navegador quando
`localStorage["codehood.answerHistory"]` vale `"on"`, mas o transporte do
coordenador (`src/components/exam/answer-edit-session.ts`) falha de propósito: não
há endpoint. O histórico fica em IndexedDB até expirar (14 dias) e ninguém o lê.

Decisões de 2026-11-11 (ver `dev/rfc/historico-de-edicao-de-respostas-abertas.md`,
"Decidido em 2026-11-11"):

- Escopo: só questões `essay` (inclui a redação de código) são seguidas. Respostas
  curtas e lacunas ficam de fora. O tipo `code` do mdq entra quando for aceito
  (`dev/issues/suporte-ao-tipo-code-do-mdq.md`).
- Chave: só por prova, um campo em `Exam`, ligado por padrão; o instrutor desliga.
  Sem chave global. Trocar a chave local por esse campo. Desligar com a prova em
  andamento precisa alcançar as páginas abertas: a resposta de `actions.exam.answer`
  avisa a página, que chama `disable()`. O histórico já coletado é mantido.
- Acesso: só quem corrige a prova lê; o aluno não vê o próprio. O servidor guarda o
  histórico enquanto a tentativa existir e o apaga com ela. A cópia no navegador é
  apagada quando o servidor a confirma e quando a tentativa é entregue.
- Sem aviso ao aluno e sem indicador de falha do monitor: lacunas só para o revisor.
  Informar os alunos é tarefa do instrutor.
- Limites conservadores por lote e por tentativa; estourar vira lacuna explícita,
  nunca erro na resposta. Sem checkpoints na primeira versão.
- Tela do instrutor: resumo por resposta (tempo ativo, inserções grandes, lacunas,
  primeira e última edição), sem replay. A página registra a causa observada de
  cada edit (colagem, digitação, exclusão...), ver "Causa do edit" no RFC; é um
  indício, não garantia: uma inserção grande marcada como digitação pode vir de
  ditado ou autocompletar.

O servidor, a chave por prova e a tela estão especificados em
`dev/specs/to-do/historico-de-edicao-no-servidor.md`.

Falta: o endpoint, o campo em `Exam`, o aviso às páginas abertas, o envio do
histórico e da lacuna do monitor, a limpeza local após a confirmação e a entrega, e
a tela do instrutor. O replay fica em `dev/issues/replay-do-historico-de-edicao.md`.
