---
type: rfc
status: draft
tags: [auth, api-keys, bots, cli]
relatedTo: [runner-de-correcao, permissions-actor]
created: 2026-11-05
creator: claude
---

# Chaves de API com escopo limitado

Rascunho para começar a discussão. Nada aqui está decidido.

## Problema

Toda chave de API age com todos os poderes do dono. A chave que o runner de
correção guarda em disco pode apagar provas, mudar notas de qualquer aluno ou
criar convites, embora só precise listar submissões e gravar feedback. Um
vazamento dessa chave equivale a um vazamento da senha do professor.

Hoje `ApiKey.kind` (`CLI` ou `BOT`) só serve para dizer quem deu uma nota: uma
chave `BOT` grava o feedback com `botId` igual ao nome dela. O tipo não limita
nada.

## Separar autoria de permissão

- **Permissão**: o que a chave pode fazer. É a pergunta que o escopo responde.
- **Autoria**: quem aparece como autor de uma nota (`Feedback.graderId` ou
  `Feedback.botId`). Precisa continuar existindo mesmo com escopos, porque a
  nota manual se sobrepõe à do bot e a tela mostra "Graded automatically".

Uma chave com escopo de bot é então uma chave cujos escopos não incluem gravar
nota como humano.

## Proposta inicial

```prisma
model ApiKey {
  // ...
  /// What the key may do. Empty means everything its owner may do.
  scopes String[]   // SQLite: Json
  /// Restricts the key to one course. Null means every course of the owner.
  courseId Int?
  /// Set when the key grades as a bot: the `Feedback.botId` it writes.
  bot String?
}
```

Escopos candidatos, no formato `<recurso>:<ação>`:

| Escopo | Permite |
| :-- | :-- |
| `course:read` | ler curso, provas e questões |
| `submission:read` | listar e ler submissões |
| `feedback:write` | criar e atualizar feedback (como bot, se `bot` estiver preenchido) |
| `push` | o que o `codehood push` faz hoje |
| `*` | tudo o que o dono pode (a chave `CLI` de hoje) |

A checagem fica junto da de permissões (`src/auth/`): o ator carrega os
escopos da chave, e toda operação de service confere o escopo antes da regra
de papel. Uma requisição por sessão de navegador tem escopo `*`.

## Perguntas abertas

- Q1. Escopo por recurso ou por rota? Por recurso sobrevive a rotas novas, por
  rota é mais fácil de auditar.
- Q2. `kind` some (vira `scopes = ["*"]` ou `bot != null`) ou continua como
  atalho na tela de perfil?
- Q3. Restringir a um curso (`courseId`) entra já ou depois?
- Q4. O login da CLI (`POST /api/auth/login`) passa a pedir escopos, ou
  continua criando uma chave `*`?
- Q5. Migração: as chaves `BOT` existentes viram `bot = name` e
  `scopes = ["course:read", "submission:read", "feedback:write"]`?
