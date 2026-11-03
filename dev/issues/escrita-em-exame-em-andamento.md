---
type: issue
status: backlog
tags: [exam, sync, cli, questions]
kind: feature
priority: low
created: 2026-11-03
creator: claude
---

# Escrita em exame em andamento

Ideia que só existia como requisito, sem story nem spec. **Precisa de
validação antes de virar story.**

## Problema

Nada impede um push de mudar um exame `ONGOING`: `ExamService.updateTx` grava
questões, agenda e status sem olhar o status atual
(`src/db/services/exam.service.ts:300-355`). Uma questão pode ser removida, ou
a lista trocada, com alunos no meio da prova.

## Proposta

- Contra um exame `ONGOING`, o servidor recusa toda mudança de conteúdo que não
  seja **neutra para a nota** (corrige um erro de digitação sem mudar o que é
  certo).
- Quem decide se uma mudança é neutra é o `mdq`, não o servidor. Hoje o `mdq`
  não expõe nada parecido; precisa de pedido no mdq-spec.
- Mesmo neutra, a escrita não pode apagar ou arquivar questão, incluir ou
  remover questão do exame, nem mudar peso (pesos ainda não existem, ver
  `BACKLOG.md:120-124`).
- Mudança neutra aceita avança o pin da questão no exame para a nova versão,
  senão a correção do erro nunca chega a quem está fazendo a prova. Depende de
  `dev/issues/versao-da-questao-fixada-ao-iniciar-o-exame.md`.
- Campo congelado não faz o push falhar: o servidor aplica o resto e reporta
  o que ignorou. Rejeitar deixaria o curso impossível de enviar depois de um
  "começar agora" pela web. Ver
  `dev/issues/congelar-agenda-do-exame-em-andamento.md`.

## Critérios de aceitação

- [ ] Story validada pelo humano.
- [ ] Contrato com o `mdq` para decidir neutralidade definido.
