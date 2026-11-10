# Escrita localStorage concorrente com logout pode deixar texto órfão

## Estado

Encontrado e parcialmente mitigado na branch `input-monitor`, antes de integração na aplicação. Recuperação de sessão nova está protegida; remoção física completa não está garantida.

## Problema

`Storage` não oferece transação entre checar revogação e escrever texto. Uma aba pode concluir `revoke()` entre a última checagem da outra aba e seu `setItem()`. A escrita atrasada pode recriar dados da sessão encerrada.

`createTextRecoveryStore()` agora usa destino por geração. Uma sessão nova não lê esses dados antigos, e revogar um handle antigo não apaga a sessão nova. O teste `test/answer-edit-fallback-fence.spec.ts` reproduz a intercalação pela fronteira `Storage` injetada.

Isso não equivale a apagar fisicamente o texto: inspeção direta do localStorage ainda pode encontrar a chave antiga. O TTL atual é aplicado ao ler um campo acessível, não varre gerações órfãs.

## Próxima decisão

Definir limpeza de gerações revogadas, retenção e política de sessão antes da integração com logout real. Não prometer atomicidade inexistente nem tratar storage browser como criptografia. Outra checagem antes de `setItem()` não elimina a corrida. Qualquer limpeza precisa preservar a sessão nova e owners independentes, com testes entre abas e falhas de storage.
