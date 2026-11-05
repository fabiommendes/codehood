---
type: issue
status: backlog
tags: [observability, errors, ops]
kind: feature
priority: high
created: 2026-11-05
creator: claude
---

# Log de erros no servidor e no cliente

Pedido do humano depois do deploy da 0.3.0: algo como o Sentry, mais leve.

## Problema

Os 500 da 0.3.0 só foram achados porque o instrutor reclamou. No servidor, a
única fonte é o `journalctl` com o stack trace do Astro, sem URL, usuário nem
agrupamento; o Caddy não guarda log de acesso. Uma exceção no cliente (ilha
SolidJS, `window.onerror`, promise rejeitada) não chega a lugar nenhum.

## Proposta (a desenhar com `new-feature`)

- Servidor: um ponto único que registra toda exceção que vira 500 (páginas,
  REST, RPC e Actions), com rota, método, usuário, versão e stack.
  `responseFromException` já faz `console.error` só para o REST.
- Cliente: um handler global que envia exceções e rejeições para um endpoint
  com limite de taxa, junto da URL, do user agent e da versão.
- Guardar no banco, agrupado por assinatura (tipo, mensagem normalizada,
  primeiro frame), com contagem, primeira e última ocorrência. Página de
  admin para ler e marcar como resolvido. Retenção limitada.
- Avaliar aviso por email para uma assinatura nova.

## Critérios de aceitação

- [ ] Um 500 em qualquer página aparece para o admin com rota, usuário e stack.
- [ ] Uma exceção numa ilha aparece para o admin.
- [ ] Mil ocorrências da mesma exceção viram uma linha com contagem.
