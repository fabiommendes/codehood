---
type: adr
status: accepted
tags: [chamada, frequencia, antifraude]
created: 2026-11-17
creator: claude
---

# Chamada sinaliza dispositivo compartilhado, nunca bloqueia

A chamada em sala aceita a presença de quem tem o código projetado. Contra
fraude, o servidor dificulta o código remoto e sinaliza o dispositivo
compartilhado, mas não recusa presença por suspeita.

## Decisão

- **Código curto e rotativo.** O código projetado muda a cada 15 s e vale até
  30 s depois de sair da tela, derivado de um segredo da chamada e do relógio
  (estilo TOTP); nenhum código é gravado. Tentativas erradas têm limite por
  usuário e por IP. Repassar o código para quem está fora da sala exige
  alguém repassando a cada 15 s.
- **Dispositivo compartilhado é sinal, não bloqueio.** Cada navegador recebe
  um cookie de dispositivo cujo hash é gravado na presença. Quando o mesmo
  dispositivo marca mais de um aluno na mesma chamada, cada presença mostra os
  outros em `sharedWith`, na página da chamada do professor. Nada é recusado:
  o professor decide e retira a presença à mão se for fraude.
- **Sem restrição por rede ou geolocalização.**

## Motivo

Dispositivo compartilhado tem causa legítima (celular sem bateria, notebook
emprestado ao colega da bancada) que o servidor não distingue de fraude. Um
bloqueio automático tiraria a presença de um aluno que estava na sala, e o
erro só apareceria no fim do semestre. O professor está na sala e pode
conferir; o servidor só junta a evidência. Rede e geolocalização falham com
dados móveis e VPN e exigiriam permissões do navegador para pouco ganho.

## Consequências

- O cookie de dispositivo é trivial de apagar; `sharedWith` pega o caso comum
  (um colega marcando vários pelo próprio celular), não o fraudador
  determinado.
- O professor vê só os nomes em `sharedWith`, nunca o `deviceHash`, que sai
  do service (`src/db/services/roll-call.service.ts`) apenas para o cookie
  assinado do check-in pendente.
- Código e janela em `src/services/roll-call-code.ts`; limite de tentativas em
  `src/actions/check-in.ts`.
