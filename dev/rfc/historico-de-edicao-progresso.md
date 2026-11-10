# Progresso da implementação do monitor

Branch exclusiva `input-monitor`. Escopo aprovado no RFC `historico-de-edicao-de-respostas-abertas.md`. Implementação parcial, sem integração na aplicação ainda.

## Método

TDD full com workers separados para testes e implementação. A ferramenta não mantém agentes persistentes nem permite escolher modelo por chamada; cada chamada recebe um briefing resumido. Implementer não lê os testes. O coordenador executa RED e GREEN pelo harness existente. Lotes de até três critérios.

Dependências instaladas no próprio worktree com `pnpm install --frozen-lockfile`, sem alterar dependências de outras árvores. Nenhuma migration ou modificação externa em MDQ.

## Contrato concreto inicial

Módulo `src/services/answer-edits/codec.ts`. `encodeEdits`, `decodeEdits`, `replayEdits` e `applyReplacements` são seams públicas puras. Objetos nomeados usam `startMs` absoluto no relógio da sessão. Envelope do codec contém `version: 1`, `timeOriginMs` e tuplas. A primeira tupla é relativa a `timeOriginMs`; as demais, ao início da anterior. O envelope de transporte do monitor acrescentará sessão, identificadores e revisão.

Tempos e acumuladores são números IEEE-754 finitos não negativos, sem arredondamento adicional. Posições e contagens são inteiros seguros não negativos. Nenhuma normalização de texto. Erros de contrato lançam exceções, sem mutação dos argumentos. Esse refinamento não estabelece limites de volume do servidor, que permanecem pendentes.

## Ciclo 1: codec e replay

Lote 1, três critérios:

1. Roundtrip de objetos/tuplas com códigos 0 a 6, timing null ou Welford, origem independente por envelope e validação de versão/tempos/timing.
2. Replay UTF-16 exato, incluindo vazio, emoji, combinantes, RTL, quebras, substituição/exclusão total e operações sem efeito.
3. Transações em coordenadas anteriores, ordenadas sem sobreposição, com rejeição de posições inválidas e sem mutação parcial.

Comando RED e GREEN: `pnpm exec tsx test/run.ts test/answer-edit-codec.spec.ts`.

RED real: 54 falhas funcionais com `Error: Not implemented`, 156 testes de rejeição passando contra o stub. GREEN: 210 testes passaram em 9,9 s. Propriedades com seed fixa, 200 execuções no replay. Antes do RED houve uma falha de setup por código gerado ausente; ela não conta como RED. Preparação corrigida com `pnpm run generate`, `pnpm run db:generate` e `pnpm exec astro sync`. Logs da sessão em `/tmp/input-monitor-codec-{red,green}.log`.

Transações com posições repetidas são recusadas para eliminar ordem ambígua; intervalos adjacentes com posições distintas são aceitos. O implementer recebeu somente critérios e stubs, sem acesso aos testes.

## Ciclo 2: monitor independente

Contrato concreto em `src/services/answer-edits/monitor.ts`, preservando os métodos conceituais. `PendingEditBatch` acrescenta `timeOriginMs`, que faltava na assinatura conceitual, mas já era exigido pelo envelope descrito no RFC. Origem capturada por `now()` na criação; timestamps fornecidos estão nesse mesmo relógio. IDs de lote são determinísticos por sessão e primeira sequência. A sessão inicial precisa ser única por campo; `restore` aceita `createSessionId` injetável, com UUID como padrão, para criar uma sessão nova sem comparar relógios antigos.

Refinamentos de agrupamento: inserções puras contíguas de digitação e exclusões puras contíguas podem agrupar se preservarem replay. Undo, redo, paste, composition e transações com múltiplos patches ficam isolados. Sem observação associada, mudança não inventa amostras de cadência. Observação consumida não pode ser reutilizada. Mudança sem efeito não gera edit. Transações de vários patches ficam isoladas e não carregam estatística de cadência; a intenção conta uma vez no intervalo seguinte. `hasPendingChanges` inclui operações em trânsito e retidas. ACK válido incrementa revisão exatamente uma vez e confirma a última sequência do lote.

Lote 1: validação atômica/replay de mudanças; fronteiras de agrupamento; observações e Welford sem contagem duplicada. RED: `pnpm exec tsx test/run.ts test/answer-edit-monitor-input.spec.ts`, 70 falhas funcionais no stub. Primeiro GREEN teve 69 aprovados e uma falha legítima: intervalo atravessando pausa contaminava timing do edit seguinte. Corrigido no implementer sem ler teste, com diagnóstico público. GREEN final: `pnpm exec tsx test/run.ts test/answer-edit-codec.spec.ts test/answer-edit-monitor-input.spec.ts`, 280 aprovados em 13 s. O tester corrigiu separadamente seis erros de acesso indexado possivelmente indefinido, sem alterar expectativas. Logs `/tmp/input-monitor-input-{red,green}.log`.

Lote 2: coleta imutável/ACK e lifecycle. RED: `pnpm exec tsx test/run.ts test/answer-edit-monitor-batches.spec.ts`, 32 falhas funcionais e quatro aprovados. GREEN acumulado: `pnpm exec tsx test/run.ts test/answer-edit-codec.spec.ts test/answer-edit-monitor-input.spec.ts test/answer-edit-monitor-batches.spec.ts`, 316 aprovados em 10,6 s. Logs `/tmp/input-monitor-batches-{red,green}.log`. Notificações são síncronas; dispose é idempotente, mantém estado consultável e rejeita novas operações mutáveis.

Lote 3: checkpoint e restore com sessão nova. RED: `pnpm exec tsx test/run.ts test/answer-edit-monitor-checkpoint.spec.ts`, 31 falhas funcionais no stub. GREEN acumulado dos quatro arquivos: 347 aprovados em 11,3 s. A primeira execução encontrou 11 falhas na mesma expectativa parametrizada do teste: ele chamava `collect` com edit aberto durante envio e esperava agrupamento posterior. O RFC exige fechamento nessa chamada. O tester corrigiu a expectativa para dois edits, sem alterar o contrato para acomodar implementação. Logs `/tmp/input-monitor-checkpoint-{red,green}.log`.

Checkpoint é opaco, versionado, validado integralmente por schema Zod e invariantes de replay no módulo interno `checkpoint.ts`. Exportação copia e congela sem fechar edit. Restore preserva inflight, transforma pendências antigas em segmentos fechados, mantém fila por sessão, receipts históricos e sequências globais; cria sessão nova com UUID injetável e origem nova. Lotes de sessões antigas são coletados antes da sessão nova. O snapshot de cada segmento é o daquele instante, não o texto mais recente.

## Ciclo 3: regressões encontradas em revisão independente

Um worker revisor, somente leitura, identificou dois bugs antes da entrega. O tester recebeu reproduções e critérios, não a implementação:

1. Tempos finitos extremos e pausa configurada grande podiam transbordar M2 para Infinity, tornando o checkpoint irrestaurável. O limite de representação numérica agora fecha o edit anterior e inicia outro, preservando texto e sem fabricar intervalo.
2. Uma observação atrasada em relação à alteração podia incluir pausa observada maior que o limite no timing interno. Agrupamento agora exige tanto gap entre mudanças quanto intervalo observado dentro do limite; igualdade continua válida.

RED: `pnpm exec tsx test/run.ts test/answer-edit-monitor-boundaries.spec.ts`, quatro falhas comportamentais e dois aprovados. GREEN acumulado: `pnpm exec tsx test/run.ts test/answer-edit-codec.spec.ts test/answer-edit-monitor-input.spec.ts test/answer-edit-monitor-batches.spec.ts test/answer-edit-monitor-checkpoint.spec.ts test/answer-edit-monitor-boundaries.spec.ts`, 353 aprovados em 10,1 s. Logs `/tmp/input-monitor-boundaries-{red,green}.log`. São seis regressões adicionais, com fronteiras de pausa observada 999/1000/1001 ms.

## Validação da entrega parcial

- `pnpm exec biome check --write .`: exit 0, 792 arquivos, um corrigido automaticamente.
- `pnpm run lint`: exit 0, incluindo i18n, TypeScript, Astro com zero erros e catálogo de stories.
- Suíte relevante completa: 353 testes aprovados. Propriedades fast-check com sementes fixas nos testes de codec, replay, mudanças e checkpoint.
- `pnpm test`: suíte de 3.350 testes iniciada, interrompida por timeout externo de 300 s, sem resumo final. Não conta como suíte completa aprovada. Log `/tmp/input-monitor-full-suite.log`. O processo de servidor restante desta execução foi encerrado pelo PID exato; processos de outras worktrees não foram tocados.
- Nenhuma alteração de schema, migration, endpoint, dependência ou contrato CLI. Não houve seed novo porque nenhuma interface foi introduzida e o núcleo não consulta banco.

## Cobertura e limites

Concluídos no núcleo: pausas, tempos inválidos/iguais/regressivos, valores vazios e Unicode, transações multipatch e rejeição atômica, associação de intenção única, Welford, export não invasivo, versão/corrupção estrutural, origens independentes de lote e sessão, coletas imutáveis, edição durante envio, ACK divergente/repetido e múltiplos reloads com fila pendente. Os casos de ACK perdido são locais e não provam idempotência no banco.

A API concreta está nos módulos `codec.ts` e `monitor.ts`. Não há DOM, Solid, storage ou rede na classe. `checkpoint.ts` é interno e não deve ser importado por consumidores externos à pasta.

## Ciclo 4: armazenamento browser

Contrato em `storage.ts`: owner obrigatório, CAS por campo e geração, TTL de 14 dias, registro limitado a 2 MiB UTF-8. IndexedDB valida checkpoint/replay, texto e outbox antes do commit atômico. Fallback conserva somente texto e metadados de lacuna. Revogar invalida o handle, aborta transações pendentes e limpa apenas o namespace do owner.

TDD full com workers separados. RED reproduzido pelo orquestrador: `pnpm exec tsx test/run.ts test/answer-edit-storage.spec.ts`, três falhas funcionais `Not implemented`. GREEN pelo mesmo comando: três testes passaram em 14,6 s. Logs `/tmp/input-monitor-storage-{red,green}.log`. Estes três testes usam Chromium, IndexedDB e localStorage reais, módulo empacotado pelo esbuild existente no harness de teste. Incluem CAS concorrente, abort, corrupção, limite multibyte, vazio, TTL e callbacks após revoke. Não provam integração com editores ou logout da aplicação. O namespace não enumera dados de outros owners.

## Ciclo 5: coordenador por tentativa

Lote 1, três critérios: durabilidade durante edição contínua com espera máxima inicial de 1 s; degradação explícita para texto ou indisponível; ownership/detach/dispose/logout. Contrato `AnswerEditCoordinator` em `coordinator.ts`, com storage, scheduler, relógios, aleatoriedade e transporte injetados. Até 128 campos por tentativa. A montagem de storage deve usar o mesmo owner autenticado do coordenador. `register` e `recover` consultam a base do servidor antes de aceitar o campo. Detach fecha e transfere um clone antes do dispose do adaptador. Dispose não apaga pendências, logout revoga os stores.

RED pelo orquestrador: `pnpm exec tsx test/run.ts test/answer-edit-coordinator-local.spec.ts`, 16 falhas funcionais. Primeiro GREEN do implementer encontrou 15 aprovados e uma regressão de retry local: persist explícito não repetia uma gravação fracassada sem nova edição. Corrigido a partir do diagnóstico, sem ler fonte dos testes. GREEN: 16 aprovados. Logs `/tmp/input-monitor-coordinator-local-red.log` e `/tmp/coordinator-local-green.log`. Tests usam monitor real e doubles somente nas fronteiras storage/scheduler/transporte. `pnpm run lint` passou após auto-fix global.

Lote 2 em andamento: envio agregado, backoff e reconciliação ampliada. RED: `pnpm exec tsx test/run.ts test/answer-edit-coordinator-delivery.spec.ts test/answer-edit-coordinator-recovery.spec.ts`, 13 falhas funcionais e 28 aprovados. Gaps identificados: ausência de backoff, status observável de conflito na recuperação inicial, fallback recente ignorado quando checkpoint antigo ainda legível. Log `/tmp/input-monitor-coordinator-delivery-red.log`. Comportamentos já verdes incluem lote estável em retry, ACK perdido compatível, confirmação parcial e bloqueio após prazo. A evidência é contra transporte double, não servidor real.

Lote 2 GREEN: `pnpm exec tsx test/run.ts test/answer-edit-coordinator-local.spec.ts test/answer-edit-coordinator-delivery.spec.ts test/answer-edit-coordinator-recovery.spec.ts`, 57 aprovados em 10,3 s. Log `/tmp/input-monitor-coordinator-delivery-green.log`. Não houve alteração de expectativa para obter este verde. API acrescentou resultado explícito `unavailable` quando a recuperação local não pode ser verificada. Status de conflito inicial disponível sem inventar monitor.

Revisão independente encontrou falhas adicionais e não aprovou a fatia. Lote 3 RED: `pnpm exec tsx test/run.ts test/answer-edit-coordinator-races.spec.ts`, 11 falhas funcionais. Critérios: preservar fallback divergente de outra aba após commit principal; handoff de detach com gravação em trânsito; aplicar backoff também em falha parcial. Log `/tmp/input-monitor-coordinator-races-red.log`. Ainda pendentes na revisão: revogação compartilhada de múltiplos handles do mesmo owner, falha de leitura principal com fallback vazio e crescimento de metadados do monitor.

Retomada: preservados o diff do coordenador e os 11 testes de corridas. O log anterior `/tmp/lote3-races-final.log` registra 11 aprovados. A regressão combinada anterior tinha três falhas contratuais nos testes antigos. Tester independente, sem ler implementação, corrigiu dois fixtures de cadência para devolver ACK válido em vez de retry e restringiu o caso de fallback antigo ao texto coincidente. Fallback divergente continua exigindo recuperação explícita, independentemente do timestamp. Nenhuma expectativa do teste de corridas foi alterada. Nova execução `pnpm exec tsx test/run.ts test/answer-edit-coordinator-local.spec.ts test/answer-edit-coordinator-delivery.spec.ts test/answer-edit-coordinator-recovery.spec.ts test/answer-edit-coordinator-races.spec.ts`: 68 aprovados. Logs `/tmp/lote3-tester-regression.log`, `/tmp/lote3-tester-biome.log`, `/tmp/lote3-tester-lint.log`. Biome global e lint completo exit 0. Este GREEN fecha apenas o lote 3, não a revisão inteira.

## Ciclo 6: revogação entre handles e recuperação indisponível

Sem alterar assinaturas públicas. Critérios: revogar o namespace invalida handles já abertos, inclusive em outra página; repetir revoke antigo não apaga uma sessão nova; falha de leitura principal sem fallback não fabrica monitor vazio. Fallback com registro de string vazia continua recuperável.

RED real reproduzido pelo orquestrador: `pnpm exec tsx test/run.ts test/answer-edit-storage-revocation.spec.ts test/answer-edit-recovery-unavailable.spec.ts`, três falhas funcionais e um aprovado. Log `/tmp/input-monitor-revocation-red.log`. Implementer separado adicionou token persistido de revogação, validado transacionalmente no IndexedDB. Primeira execução teve seis aprovados e uma falha browser. Tester investigou sem alterar produção: diagnóstico só com localStorage nativo reproduziu inicialização remota atrasada em 10 de 15 execuções. Barreira por evento de storage adicionada somente ao setup anterior à revogação, nunca depois dela. Diagnóstico sincronizado passou 10/10 e teste real 15/15. Log `/tmp/revocation-native-initial.log`, `/tmp/revocation-native-pre-revoke-sync.log`, `/tmp/revocation-pre-revoke-sync.log`. Expectativa antiga de fallback expirado com principal ilegível foi corrigida para unavailable pelo contrato, sem expor handle nem enviar.

GREEN: storage original, revogação e recuperação do coordenador, 27 aprovados em `/tmp/revocation-tester-final.log`; Biome global e lint completo exit 0 em `/tmp/revocation-tester-lint.log`. Revisão independente seguinte identificou corrida adicional entre último check e escrita no localStorage, remount durante commit de ACK e falha de leitura somente do fallback. Essas garantias ainda não estão fechadas neste commit.

## Ciclo 7: ownership durante ACK e fencing lógico do fallback

Três critérios, sem novas assinaturas públicas:

1. Recuperação/remount durante commit de ACK não copia geração CAS antiga para o novo dono.
2. Falha apenas na leitura do fallback não é tratada como ausência de rascunho, mesmo com principal legível e vazio.
3. Escrita de fallback interrompida por revoke de outro handle não reaparece na recuperação de sessão nova.

Tester separado escreveu `test/answer-edit-coordinator-ownership.spec.ts` e `test/answer-edit-fallback-fence.spec.ts` a partir do contrato e das reproduções públicas, sem ler implementação. RED reproduzido pelo orquestrador: `pnpm exec tsx test/run.ts test/answer-edit-coordinator-ownership.spec.ts test/answer-edit-fallback-fence.spec.ts`, três falhas funcionais. Log `/tmp/input-monitor-ownership-red.log`. Implementer recebeu critérios e arquivos permitidos, sem fonte dos testes. GREEN do mesmo comando: três aprovados, `/tmp/input-monitor-ownership-green.log`.

Recuperação aguarda entrega e persistência do dono anterior antes de copiar geração; entrega pula campos em registro. Falha de leitura do fallback retorna unavailable sem fabricar handle. Após revogação, fallback usa chave de dados por geração; compatibilidade de leitura anterior ao primeiro token é preservada. Isso impede recuperação de escrita tardia, não garante apagamento físico. Uma requisição pendente pode atrasar recuperação, inclusive de outro campo; inspeção anterior a ACK pode gerar conflito conservador, nunca sobrescrita automática.

Revisão independente final confirmou os três reparos sem encontrar regressão concreta. Crescimento de metadados e remoção física de dados órfãos continuam abertos, registrados em `dev/issues/monitor-metadados-e-limite-de-checkpoint.md` e `dev/issues/monitor-fallback-erasure-apos-logout.md`. Não houve poda silenciosa de evidência para esconder o limite de 2 MiB.

## Validação da retomada

- Todos os `test/answer-edit-*.spec.ts`: 431 aprovados, incluindo os 353 testes originais de codec/monitor. Log `/tmp/input-monitor-all-green.log`.
- `pnpm test`: 3.428 aprovados em 11 minutos, exit 0. Log `/tmp/input-monitor-resumed-full-suite.log`. Esta execução terminou, ao contrário do timeout registrado na primeira entrega.
- Validação final do orquestrador: `pnpm exec biome check --write .` exit 0, 805 arquivos, sem alterações; `pnpm run lint` exit 0, incluindo i18n, TypeScript, Astro com zero erros e stories. Seis warnings não bloqueantes. Logs `/tmp/input-monitor-final-biome.log` e `/tmp/input-monitor-final-lint.log`.
- Storage browser real cobre IndexedDB, localStorage, falhas e revogação entre páginas. Coordenação e entrega continuam validadas contra transporte injetado, não contra backend do histórico.
- Sem alteração de schema, migrations, dependências ou MDQ externa. Sem seed novo: nenhuma interface nem estado de banco da aplicação foi introduzido. O recurso ainda não é exercitável pela interface dev.

## Pendências e próxima fatia

Implementados e testados: storage principal transacional com CAS/TTL por owner e campo, fallback somente texto incluindo vazio, lacunas/avisos observáveis, persistência com espera máxima de 1 s durante edição contínua, outbox antes da rede quando o storage permite (falha permanente do commit não segura o envio), coordenação por tentativa, cadência de 55 a 65 s, retry com jitter/backoff, ACKs, resultados parciais, recuperação com sessão nova e reconciliação, detach/dispose e fencing de callbacks. Isso não fecha toda a camada de persistência/coordenação: os dois problemas registrados acima exigem decisão e testes próprios.

Ainda ausentes: adaptadores textarea e CodeMirror, integração do fallback com o rascunho atual sem duplicar fonte de verdade, integração com componentes e logout reais, transporte HTTP/backend, schema/services do histórico, idempotência e concorrência no servidor, autorização, quotas por tentativa, vínculo com entrega final, replay/revisão na interface, seeds de todos os estados e carga. O autosave real não foi alterado nem duplicado. Montagem/desmontagem foi testada pelo contrato de handles, não por componente montado no browser.

A compactação local foi concluída no ciclo 9 abaixo. Limpeza completa de gerações locais continua pendente na issue de logout. Depois, adaptadores independentes e backend em lotes separados, lendo as convenções CLI/ADRs antes de qualquer contrato externo. Rich text e seam externa MDQ continuam dependendo das decisões do RFC. Retenção do histórico no servidor, acesso, limites de volume por tentativa e checkpoints do servidor permanecem abertos.

Commits recuperados na retomada: `6cdc735`, `d829065`, `36e5807`. Incrementos desta retomada: `6743069`, `a47ccd2` e o commit que inclui esta atualização. Branch exclusiva `input-monitor`, sem push e sem alteração em outras worktrees. O recurso completo não está pronto.

## Ciclo 8: apagamento do fallback após logout

`createTextRecoveryStore` guarda um token por owner e grava os dados sob uma chave derivada dele. `revoke()` rotaciona o token e remove a chave atual. Depois de cada `setItem`, o escritor relê o token e, se mudou, remove a própria escrita e lança erro. Sem provas de revogação, sem índice e sem enumerar o origin.

Limite aceito: escritor suspenso entre a checagem e o `setItem` que morre antes de compensar deixa texto órfão que sessões novas não leem. Duas rotações simultâneas podem invalidar a sessão mais nova sem apagar seu texto. Detalhes e pendência do retry do IndexedDB em `dev/issues/monitor-fallback-erasure-apos-logout.md`. Testes: `test/answer-edit-fallback-erasure.spec.ts` (Chromium real com duas páginas e Storage injetado), `test/answer-edit-fallback-fence.spec.ts`, `test/answer-edit-coordinator-logout.spec.ts`.

## Ciclo 9: controles do monitor limitados por contagem

`observeInput` devolve um token opaco emitido pelo monitor e `DocumentChange.input` o consome. Não há `inputId` do chamador, detecção de duplicata, tombstones, watermark nem TTL de observações. Observações não consumidas ficam limitadas a 16 (a mais antiga cai) e recibos aos 32 últimos. Sessões deixam de ser registradas: o monitor as deriva dos recibos retidos, do lote em voo, da fila e da sessão ativa, e `restore` recusa um `sessionId` já visto nesse conjunto. Não há relógio de parede no monitor.

O checkpoint (`version: 2`, única versão aceita) guarda texto, pendências, recibos e a sessão ativa. Observações e cadência não são persistidos, porque `restore` abre outra sessão e não transfere associações. Seu tamanho depende do texto e das pendências, não das teclas recentes: no envelope de referência (10 entradas/s por 90 minutos com lotes confirmados) o checkpoint ficou em cerca de 2 KiB, contra 921 KiB antes. Testes de carga em `test/answer-edit-load.spec.ts`.

Ainda sem schema, migration, endpoint, adaptador de editor ou integração na aplicação, portanto sem seed novo.
