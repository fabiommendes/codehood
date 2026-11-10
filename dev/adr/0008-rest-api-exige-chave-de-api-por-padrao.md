---
type: adr
status: accepted
tags: [api, rest, rpc, auth]
created: 2026-11-03
decided: 2026-09-02
creator: claude
---

# REST e RPC exigem autenticação por padrão

Toda rota REST e método RPC exige um actor autenticado, salvo declaração
`isPublic: true`. Sessão por cookie e chave `Authorization: Bearer` são
alternativas para UI e CLI/bots, respectivamente. Esquecer a flag falha fechado
com 401 no REST ou erro de autenticação JSON-RPC.

## Decisão

- O padrão histórico descrito como "exigir chave" já aceitava `locals.actor`
  de sessão. A política agora é explícita e o OpenAPI declara as duas alternativas.
- Presença simultânea do esquema Bearer e do cookie `SESSION_COOKIE` produz
  HTTP 400 antes de validar qualquer credencial ou renovar sessão. Inclui valores
  vazios, inválidos e credenciais do mesmo usuário. Cookies alheios não conflitam.
- O guard de conflito vale centralmente para todas as portas da aplicação,
  antes dos middlewares de sessão e chave. Não existe precedência ou fallback.
- `isPublic: true` remove a exigência de actor e emite `security: []`.
  REST público: `GET /api/health` e `POST /api/auth/login`.
  `POST /api/auth/logout` exige autenticação.
- Em mutações REST e `/rpc`, Origin explicitamente externo falha 403,
  inclusive JSON, exceto com Bearer validado. Sem Origin, JSON continua aceito.
  Conteúdos enviáveis por formulário e corpos sem Content-Type exigem Origin
  local quando não há Bearer válido. REST e `/rpc` compartilham a regra, então
  trocar um REST direto por um envelope RPC não a contorna.

## Consequências

Clientes que fazem login e conservam o cookie devem usar esse cookie sozinho
ou omiti-lo explicitamente ao enviar Bearer. A resposta de login continua
emitindo as duas credenciais para clientes distintos; enviá-las juntas é erro.

Um novo endpoint permanece protegido por padrão.
