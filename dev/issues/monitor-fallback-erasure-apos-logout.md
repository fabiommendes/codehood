# Escrita localStorage concorrente com logout pode deixar texto órfão

## Estado

Mitigação ampliada na branch `input-monitor`, ainda sem integração com logout da aplicação. A issue continua aberta: recuperação por sessão nova está protegida, mas remoção física de todas as gerações revogadas não está garantida.

## Correção parcial implementada

`createTextRecoveryStore()` mantém destinos por geração e agora grava provas de revogação sem texto, com índice no namespace do owner. As operações públicas reconciliam as gerações conhecidas. Uma escrita que retorna de `setItem()` após revogação tenta remover seu próprio texto e rejeita a operação. Escritas por `remove()` e expiração também passam pela compensação.

`revoke()` do store é repetível, inclusive depois de falhar ou de outra sessão começar. O índice não autoriza exclusão sozinho: a geração precisa ter prova individual de revogação. Isso preserva dados de geração não revogada, outros owners e outros prefixes. Não há enumeração de chaves do origin nem `Storage.clear()`.

Falhas de acesso, gravação de metadados ou remoção propagam. O chamador não recebe confirmação de limpeza bem-sucedida. O coordenador já bloqueia callbacks antigos após logout e propaga falha de cleanup.

## Pendências concretas

1. O índice usa read-modify-write não transacional. Uma revogação suspensa pode sobrescrever o índice atualizado por outra geração. Se um escritor dessa geração morrer depois de recriar texto e antes da compensação, o texto fica órfão mesmo após operações bem-sucedidas de uma sessão nova. A prova individual persiste, mas a sessão nova não conhece sua chave. O handle original sobrevivente consegue limpar e reparar o índice ao repetir `revoke()`. O teste reproduz ambos os resultados.
2. `AnswerEditCoordinator.logout()` memoriza inclusive a Promise rejeitada. Repetir logout no mesmo coordenador não repete cleanup. O retry demonstrado é pelo store, ou pela criação/acesso de outro store quando a geração consta do índice.
3. Uma rotação de token suspensa pode sobrescrever token mais recente. A geração nova não é apagada fisicamente, mas seu handle pode ficar logicamente invalidado e deixar de ser recuperável por novos handles. Preservação física não prova continuidade da sessão nova.
4. Se persistir a prova ou o índice falhar, a revogação pode rejeitar antes da remoção do texto, mesmo que `removeItem()` fosse permitido.

Fechar esta issue exige um protocolo de descoberta/revogação que resolva esses casos sem enumerar o origin, sem apagar sessões atuais e sem depender da sobrevivência dos handles antigos. Não mudar silenciosamente API pública ou política de sessão para obter essa garantia.

## Garantia e limites

Para uma geração conhecida pelo índice ou pelo próprio handle, com prova persistida de revogação, uma reconciliação que termina com sucesso remove fisicamente seu destino de texto. A compensação remove a escrita atrasada quando o escritor retoma e o storage permite a operação. Isso não é atomicidade entre checagem e escrita, nem garantia global de apagamento eventual.

Não prometer apagamento imediato com páginas suspensas/encerradas ou storage inacessível. Storage browser não é criptografia ou barreira contra acesso ao perfil/XSS. A issue de retenção de metadados do monitor é independente e permanece inalterada.

## Evidência desta retomada

- `test/answer-edit-fallback-erasure.spec.ts`: compensação de write/remove/expiração, limpeza repetida de múltiplas gerações, preservação de geração atual/owners/prefixes, falha e retry, ausência de enumeração, lost update e limitação de retry do coordenador.
- `test/answer-edit-coordinator-logout.spec.ts`: inspeção pendente que retorna após logout com cleanup bem-sucedido ou falho, sem restaurar handle/texto/status ou agendar envio.
- RED contra storage de HEAD `b01783f`, empacotado temporariamente sem substituir produção: 12 falhas funcionais. GREEN dos dois arquivos finais: 19 aprovados.
- Chromium real com localStorage, duas páginas no mesmo contexto e barreira CDP antes do `setItem()` nativo. Sem sleeps. Casos de falha/lost update usam também Storage injetado; coordenador usa transporte/storage/scheduler doubles. Firefox/WebKit e logout real da aplicação não foram validados.
- Suíte global `pnpm test`: 3.447 aprovados em 10,9 minutos, exit 0. Log `/tmp/input-monitor-logout-full-suite.log`. Demais comandos e limites registrados em `dev/rfc/historico-de-edicao-progresso.md`.
