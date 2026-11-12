---
type: issue
status: backlog
tags: [exam, auth, delivery]
kind: bug
priority: high
created: 2026-11-12
creator: claude
---

# Sessão perdida no meio da prova: o aluno não é avisado e não é levado ao login

Legenda: **[observado]** = visto no navegador (Chromium, sessão apagada do banco
com a página da prova aberta); **[deduzido]** = só leitura de código.

## O que acontece

Sem sessão, `exam.answer` responde 401 com `message: ""`. A página trata isso
como uma falha de rede qualquer:

- **[observado]** O aluno continua digitando. A única pista é o selo "Not saved"
  ao lado da questão e a linha "1 answer not saved" no topo. Nenhum
  `role=alert`, nenhum texto de erro: `saveErrors[slug]` recebe a string vazia e
  o `<Show>` do erro em `src/components/exam/ExamAttempt.tsx` não renderiza nada.
- **[observado]** O primeiro 401 já apaga o cookie de sessão (o middleware chama
  `clearSessionCookie`, `src/middleware.ts`). Dali em diante o navegador está
  deslogado de fato.
- **[observado]** As novas tentativas continuam para sempre (espera de 2 s até
  30 s, `save-retry.ts`). Nada pede novo login.
- **[observado]** O texto digitado depois da perda fica só no `localStorage`
  (`codehood:code-draft:<usuario>:<curso>:<prova>:<questao>`); o servidor segue
  com a versão anterior.
- **[observado]** "Submit": `flush()` falha e a página mostra "Some answers
  could not be saved. Fix the errors and try again.". Não declara sucesso, não
  recarrega, a tentativa segue aberta. Não diz o motivo.
- **[observado]** Recarregar a página deslogado redireciona para `/login` sem
  `next` (`src/utils/load-course.ts`). Depois do login o aluno cai em `/`, não
  na prova.
- **[observado]** Login de novo na mesma aba e volta à prova: `restoreDrafts`
  acha o rascunho mais novo que o salvo e reenvia sozinho. O rascunho é
  chaveado por usuário e sobrevive ao novo login do mesmo aluno.
- **[observado]** Login em outra aba do mesmo navegador: a aba da prova, ainda
  aberta, se recupera sozinha em até ~30 s (o cookie é compartilhado e a nova
  tentativa usa o cookie novo).
- **[observado]** Prazo estoura deslogado: depois do prazo mais a tolerância a
  página vira "Submitted" e mostra "Time ran out and your answers to Q1 did not
  reach the server... Copy them somewhere safe and tell your instructor.". O
  servidor fica com a última resposta salva; o texto novo só existe na tela e no
  `localStorage`. Depois disso nada reenvia.
- **[observado]** Com o histórico de edição ligado
  (`localStorage["codehood.answerHistory"] = "on"`): `answerHistory.send` também
  recebe 401, sem erro de página. Não piora nada: o transporte só trata
  `NOT_FOUND` e `BAD_REQUEST` como permanentes
  (`src/components/exam/answer-edit-session.ts`).

## Vida útil da sessão

- Sessão no banco (`tokenHash` e `expiresAt`), cookie `session` (dev) ou
  `__Host-session` (produção), `httpOnly`, `sameSite: lax`.
- TTL de 30 dias, deslizante: a cada requisição validada com menos de 15 dias
  restantes, `expiresAt` volta para 30 dias
  (`src/db/services/session.service.ts`) e o middleware regrava o cookie. A
  expiração é verificada na leitura; não há job de limpeza nem configuração.
- **[deduzido]** Por tempo, a sessão não expira durante uma prova.
- Deploy ou restart não encerra sessões (estão no banco). Login em outro
  dispositivo não revoga as outras.

Formas reais de a sessão acabar durante a prova, todas por revogação ou perda do
cookie:

1. `auth.logout` em outra aba ou janela (apaga a linha e o cookie compartilhado).
2. `profile.logoutEverywhere` e `POST /api/auth/logout` (apagam todas as sessões
   do usuário, inclusive quando chamado com chave de API).
3. Troca de senha pelo aluno ou redefinição pelo admin: revogam todas.
4. `admin.forceLogout`.
5. Usuário removido.
6. Cookie perdido no navegador: limpar dados do site, janela privada fechada,
   bloqueio de cookies.
7. Banco restaurado ou resetado [deduzido].

Probabilidade em 2 a 3 horas: baixa, porque quase todas dependem de uma ação
humana ou operacional. O caso mais plausível em sala é o cookie apagado, ou o
admin redefinir a senha de um aluno em prova. É raro, mas a falha é silenciosa.

## Pior resultado realista

O aluno digita por uma hora sem sessão, vê só o selo "Not saved", não percebe, e
a prova encerra (prazo ou instrutor). O servidor guarda a última versão salva
antes da perda; o resto existe só no `localStorage` daquele navegador, sem tela
de recuperação depois do encerramento. Se ele fechar a aba ou trocar de máquina,
perde. Recebe nota pela versão antiga, por motivo técnico.

## Como reproduzir

Abrir uma prova em andamento, apagar a linha de `Session` do aluno (ou o cookie)
e digitar.

## Opções de correção

O rascunho local e o reenvio automático já existem; falta detectar, avisar e
levar o aluno ao login sem perder a página.

- **(a) Detectar `UNAUTHORIZED` no salvamento e mostrar um aviso fixo com link
  de login em nova aba.** Em `ExamAttempt.tsx`: quando `error.code ===
  "UNAUTHORIZED"`, mostrar "Sua sessão terminou. Entre de novo em outra aba;
  suas respostas continuam aqui e serão enviadas.", com link `target=_blank`
  para `/login?next=<prova>`. As novas tentativas já pegam o cookie novo da
  outra aba (observado). O aviso some sozinho quando um salvamento volta a dar
  certo. Complemento: `loadCourse` passar `?next=` ao redirecionar para
  `/login`, que já aceita `next`. Toca um componente e mensagens de i18n.
- **(b) Modal de login na própria página.** Mantém a aba. `auth.login` aceita
  formulário e redireciona, então pede ajuste; risco maior (origem, foco) para
  ganho pequeno sobre (a).
- **(c) Sessão mais longa com a prova aberta.** Não resolve: o tempo não é a
  causa.
- **(d) Parar as novas tentativas ao ver 401.** Sozinho piora (deixa de reenviar
  quando a sessão volta). Só junto com (a).

Recomendação: (a) com o `next` em `loadCourse`. Considerar também, no
encerramento, um botão para copiar as respostas que não chegaram.

## Testes de regressão

- Aluno em prova com uma resposta salva; a sessão é removida e ele digita texto
  novo: a página mostra um aviso com texto não vazio sobre a sessão, com link de
  login, e o texto continua no campo.
- Com o aviso visível, o aluno faz login em outra aba: o aviso some e o servidor
  guarda o texto novo.
- 401 em `exam.finish`: o alerta diz que a sessão acabou, não "Fix the errors".
- Recarregar deslogado e logar: o aluno volta à prova, e o rascunho é reenviado.

## Não verificado

- Produção (`__Host-session` com `Secure`); só Chromium.
- Logout em outra aba, troca de senha e `forceLogout` não foram exercitados de
  ponta a ponta; a lista vem do código.
- O cenário do prazo usou relógio falso no navegador.
