---
type: issue
status: backlog
tags: [exams, instructor, ui, grading, release]
kind: enhancement
priority: high
created: 2026-11-13
creator: claude
---

# A página da prova do professor precisa ser retrabalhada

Pedido do professor depois de corrigir a prova `lista1-elm`
(`paradigmas/chips_2026-2`) em produção, em 2026-11-13: "a página de testes
do professor precisa ser retrabalhada, tem vários problemas". Esta issue junta
os problemas concretos vistos nessa correção. O professor deve completar a lista.
A versão em produção é a `v0.3.2` ou anterior; conferir cada item na `main`.

## Problemas vistos

1. **O controle de liberar notas some sem explicação.** Em
   `exams/[slug].astro`, o bloco só aparece com
   `canManage && (exam.gradesReleasedAt || canRelease)`. Quando há um bloqueio
   (`releaseBlocker` igual a `pending`, `not-closed`, `exception-open` ou
   `not-an-exam`), o professor não vê nem o botão nem o motivo. Na `lista1-elm`,
   ele procurou e não achou onde liberar as notas.
2. **Questões objetivas ficam `PENDING_GRADE` para sempre.** As 6 questões
   objetivas da prova (`elm-if-e-let`, `elm-imutabilidade`,
   `elm-operador-append`, `elm-tipos-basicos`, `elm-andthen-encadeado`,
   `elm-propagacao-erros`) têm o gabarito no mdq, mas as cerca de 130 respostas
   de cada uma estão `PENDING_GRADE` depois de a prova fechar. Isso dá o
   bloqueio `pending` do item 1. Não há na página ação para corrigir
   automaticamente as objetivas.
3. **A página não mostra quantas respostas faltam corrigir por questão.**
   Para chegar ao número acima foi preciso ler a REST.
4. **A prova ficou `ONGOING` sem prazo** muito depois de aplicada, e três
   tentativas continuaram abertas. Ela foi fechada pela REST
   (`PATCH exam` com `status: COMPLETED`, `PATCH response` com
   `acceptingSubmissions: false`). A página poderia avisar que há uma prova
   aberta sem prazo e oferecer encerrar tudo.
5. **Liberar notas não existe na REST.** Na `v0.3.2` só existe a action
   `exam.releaseGrades`. Clientes como o chalk e o worker não conseguem fechar o
   ciclo sem passar pela web.

6. **A página junta informação demais e sem relação.** Configuração da prova,
   exceções, resultados, estatísticas por questão, liberação de notas e a
   visão do estudante convivem na mesma página. Ela precisa ser dividida em
   páginas (ou abas com rota própria), cada uma com um propósito.
7. **A "visão do estudante" não é a do estudante.** A renderização que o
   professor vê não usa o mesmo componente que o estudante usa ao fazer a
   prova, então o que o professor confere não garante o que o aluno vai ver.
8. **Não dá para simular a prova antes de aplicar.** O professor deveria
   poder fazer a prova como um estudante (mesmo componente, mesmos widgets,
   envio e correção automática), sem afetar notas nem estatísticas, para saber
   se ela funciona antes de abrir para a turma.

## Direção

- Dividir a página por tarefa: preparar (configuração, questões, exceções),
  aplicar (andamento, tentativas abertas), corrigir (pendências por questão,
  correção automática) e resultados (notas, estatísticas, liberação).
- A pré-visualização do professor usa o componente real da prova. Um modo de
  simulação grava uma tentativa marcada como de teste, fora das notas.

- Mostrar sempre o estado da liberação: liberada, liberável ou bloqueada, e
  por quê (com contagem do que falta).
- Uma ação "corrigir objetivas" que aplica o gabarito do mdq às respostas
  pendentes, ou a correção automática delas quando a tentativa fecha.
- Uma rota REST para liberar notas, com os mesmos bloqueios.

## Relacionadas

- `dev/issues/listar-feedback-da-submissao-ignora-a-submissao.md`
- `dev/issues/chave-bot-grava-feedback-como-o-usuario-dono.md`
