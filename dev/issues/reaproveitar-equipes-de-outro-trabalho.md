---
type: issue
status: backlog
tags: [assignments, teams, cli]
relatedTo: [trabalhos-com-repositorio]
kind: enhancement
created: 2026-11-19
creator: claude
---

# Reaproveitar as equipes de outro trabalho

## Problema

Uma equipe (`Team`) pertence a um trabalho (`Team.assignmentId`) e não
sobrevive a ele. Quando o professor abre um segundo trabalho com os mesmos
grupos, os alunos formam as equipes de novo, ou o professor as recompõe uma a
uma com `createFor` e `addMember`.

O caso mais comum é o trabalho dividido em dois (por exemplo, duas entregas com
atraso próprio, que os pontos de controle não cobrem): os grupos são os
mesmos.

## Proposta

Na configuração de um trabalho novo, o professor aponta outro trabalho do
mesmo curso como origem das equipes. O servidor cria, no trabalho novo, uma
equipe para cada equipe da origem, com o mesmo nome e os mesmos membros de
matrícula ativa.

A cópia acontece uma vez, na criação. Depois dela as equipes dos dois
trabalhos são independentes: mudar uma não muda a outra.

## Pontos a decidir

- Onde o professor pede a cópia: campo no frontmatter de
  `assignments/<slug>.md` (por exemplo `team: { from: <slug> }`), ação na
  página do professor, ou os dois.
- O que cada equipe copiada recebe: repositório novo (vazio ou do template do
  trabalho novo), token novo por membro e `joinCode` novo. O repositório da
  origem não é copiado.
- Membro que largou o curso: fica de fora, e a equipe pode nascer abaixo de
  `teamMin` (conta como exceção de tamanho).
- Origem e destino com `teamMax` diferentes: recusar quando um é individual e
  o outro não; aceitar o resto, com exceção de tamanho.
- Se a trava de equipe (`teamsLockAt`) vale para as equipes copiadas ou se os
  alunos ainda podem se rearranjar até a data.
