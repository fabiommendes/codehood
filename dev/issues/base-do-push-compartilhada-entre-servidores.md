---
type: issue
status: todo
tags: [cli, push, sync]
kind: bug
priority: high
created: 2026-11-16
creator: claude
---

# A base do push é a mesma para todos os servidores e cursos

`codehood push` guarda a base de sincronização em `.local/codehood/base/`
(`cli/codehood/push/base.py`, `base_dir`), um diretório por repositório. A base
não registra para qual servidor nem para qual curso foi gravada. Um repositório
de curso que faz push para mais de um destino, como produção (`codehood.toml`,
`https://codehood.dev`, `paradigmas/chips_2026-2`) e devserver
(`codehood -c codehood-dev.toml push`, `http://localhost:4321`,
`cs201/ada_2026-2`), sobrescreve a base de um destino com a do outro.

## Como reproduzir

1. Num repositório de curso, faça `codehood push` para produção.
2. Faça `codehood -c codehood-dev.toml push` para o devserver. O push salva em
   `.local/codehood/base/` a base do curso de dev.
3. Resete o banco do devserver (`pnpm run db:reset`) e faça o push de dev de
   novo. Todos os recursos, questões, exames e eventos que o reset apagou
   aparecem como "removed on the server": 308 conflitos e 254 mudanças do
   servidor que não são aplicadas, e nada é recriado. `--ours '*'` só resolve
   os conflitos, e os exames continuam apagados.
4. O próximo push para produção compara o servidor de produção com a base de
   dev.

Visto em `~/git/aulas/paradigmas-ch` em 2026-11-16. O usuário já tinha passado
por isso antes e guardado uma cópia em
`.local/codehood/base.contaminado-dev-2026-11-15/`.

## Contorno atual

Mover `.local/codehood/base` para fora do caminho antes do push de dev e depois
devolvê-la. Sem base, o plano usa os hashes que o servidor guarda
(`local_ref`/`server_ref` em `push/plan.py`), e não aparecem conflitos falsos.

## Correção proposta

- Separar a base por destino: `.local/codehood/base/<host[:porta]>/<disciplina>/<instrutor>_<edição>/`.
- Ao carregar uma base antiga, no caminho atual, sem a identidade do destino,
  tratá-la como ausente e emitir um aviso (ou migrá-la só se for possível provar
  que pertence ao destino atual).
- Gravar a identidade do destino (URL do servidor e chave do curso) dentro dos
  arquivos da base, e recusar uma base que não corresponda a ela.
- Teste de regressão: dois pushes para destinos diferentes no mesmo repositório
  não podem alterar a base um do outro.
