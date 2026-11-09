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

Refinamentos de agrupamento: inserções puras contíguas de digitação e exclusões puras contíguas podem agrupar se preservarem replay. Undo, redo, paste, composition e transações com múltiplos patches ficam isolados. Sem observação associada, mudança não inventa amostras de cadência. Observação consumida não pode ser reutilizada. Mudança sem efeito não gera edit. Estatísticas em transações de vários patches ficam só no primeiro edit sequencial; não repetir o mesmo intervalo em cada patch. `hasPendingChanges` inclui operações em trânsito e retidas. ACK válido incrementa revisão exatamente uma vez e confirma a última sequência do lote.

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

## Pendências

Persistência/coordenador, IndexedDB, fallback de rascunho sem dois donos, isolamento por usuário/TTL/logout, recuperação após prazo, adaptadores textarea/CodeMirror, servidor/banco, entrega e integração real ainda não implementados. Todos os corner cases dessas fatias permanecem pendentes, incluindo rollback, concorrência entre abas, autorização, quotas, teardown de componente e teste de carga.

Próxima fatia: contratos de scheduler/storage/transporte injetáveis e coordenador por tentativa; gravação com espera máxima de aproximadamente 1 s e outbox persistida antes do envio de 55 a 65 s. Antes de integrar o fallback, inspecionar o rascunho de código atual para manter dono único. Depois, adaptadores independentes e servidor com seus próprios lotes RED/GREEN. O autosave real não foi alterado nem duplicado.

Rich text e seam externa MDQ precisam das decisões já descritas no RFC. Também continuam abertas retenção, acesso ao histórico, limites de volume por tentativa e política de checkpoints do servidor. Nada foi editado em MDQ ou node_modules, além da instalação normal de dependências no worktree. Sem push. O recurso completo não está pronto.
