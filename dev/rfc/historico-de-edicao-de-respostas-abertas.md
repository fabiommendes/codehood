---
type: rfc
status: draft
tags: [exam, submissions, editor, monitoring, mdq]
relatedTo: [ambiente-de-execucao-no-cliente, rest-batch]
created: 2026-11-09
creator: codex
---

# Histórico de edição de respostas abertas

## Problema

Queremos preservar o processo de elaboração de respostas abertas, incluindo código,
para revisão humana de possíveis irregularidades. A resposta final isolada não
mostra substituições, inserções extensas ou pausas. O servidor roda numa VPS com
poucos recursos: registrar cada evento por HTTP ou regravar o histórico inteiro a
cada salvamento não é aceitável.

O histórico não prova autoria, cola ou uso de IA. Um cliente adulterado pode
fabricar eventos; colagem, ditado e recursos de acessibilidade têm usos legítimos.
A primeira entrega não atribui probabilidade de fraude nem aplica penalidades.

## Decidido

- Registrar mudanças do documento no navegador e enviar lotes aproximadamente a
  cada minuto, com jitter, somente quando houver alterações.
- Um coordenador por tentativa de prova reúne todas as questões alteradas numa
  única chamada. Não criar um timer de rede por editor.
- Usar tuplas versionadas para os edits, tanto na rede quanto no banco.
- Separar âncora de replay, lotes imutáveis e checkpoints ocasionais.
- Preservar `Submission.payload` e seu contrato MDQ. Não embutir o histórico na
  resposta e não transformar cada evento numa submissão.
- Agrupar digitação contígua até uma pausa de 1.000 ms, valor inicial configurável.
- Preservar estatísticas dos intervalos internos de entrada, sem registrar o
  conteúdo das teclas físicas. Pausas entre edits são informações separadas.
- Fornecer três componentes adaptadores: textarea, CodeMirror e rich text.
  A biblioteca de rich text e sua serialização ainda serão escolhidas.
- Uma classe compartilhada registra as alterações e prepara os lotes. Não conhece
  DOM, Solid, MDQ, endpoints ou IndexedDB.
- A coleta é comandada externamente. Os componentes expõem um handle por callback
  e não modificam diretamente o modelo de questões.
- Este RFC desenha contratos. Não implementa a classe, os componentes, schema ou
  mudanças na biblioteca MDQ.

### Decidido em 2026-11-11

- Escopo (Q2): `essay` e código. Respostas curtas (`short-answer`) e lacunas
  (`fill-in`) ficam de fora. A página segue só questões `essay`, o que inclui a
  redação de código de `CodeEssayAnswer`. O tipo `code` do mdq entra no escopo
  quando o Codehood passar a aceitá-lo.
- Acesso e retenção (Q3): só quem corrige a prova lê o histórico; o aluno não vê o
  próprio na primeira versão. O servidor o guarda enquanto a tentativa existir e o
  apaga com ela. A cópia no navegador do aluno é temporária: apagada quando o
  servidor a confirma e quando a tentativa é entregue.
- O sistema não mostra aviso da coleta ao aluno. Informar os alunos é tarefa do
  instrutor.
- Indicador (Q6): o aluno não vê nada quando o monitor falha. As lacunas só
  aparecem para o revisor.
- Fallback local (Q8): o monitor não tem `localStorage` próprio. O rascunho local
  da página (`browserDraftStore`) recupera o texto. Uma queda do navegador perde o
  histórico ainda não persistido, que vira lacuna, nunca a resposta.
- Chave (R6): só por prova, um campo em `Exam`, ligado por padrão. O instrutor o
  desliga. Não há chave global do sistema. Desligar com a prova em andamento
  precisa alcançar as páginas já abertas; proposta: a resposta de
  `actions.exam.answer` informa a página, que chama `disable()`. O histórico já
  coletado é mantido.
- Tela do instrutor, primeira versão: resumo por resposta (tempo ativo, inserções
  grandes, lacunas, horário da primeira e da última edição), sem replay. Limite:
  hoje o monitor não distingue colagem de digitação, então uma inserção grande é
  só um indício.
- Rich text (Q1): fora do escopo; não existe questão de rich text.
- Limites (Q4): limites conservadores por lote e por tentativa. Estourar um vira
  lacuna explícita, nunca erro na resposta. Sem checkpoints na primeira versão.
- Props de injeção de editor no mdq (Q7): desnecessárias para `essay`, pois a
  página alimenta o monitor pelo próprio `change()`. Voltam só se quisermos
  detectar colagem.

## Prioridade: a resposta não depende do monitor

A resposta do aluno chegar ao servidor vale mais que preservar o monitoramento.
Nenhum aluno perde a prova por problema técnico do monitor.

- R1. `exam.answer`, `exam.finish` e `Submission` ficam como estão e são a
  autoridade. O histórico vai por endpoint próprio e nunca altera nem bloqueia
  `Submission`. Divergência entre histórico e resposta salva vira lacuna
  registrada, nunca recusa da resposta. O "estado atual" do histórico, se
  existir, é só âncora de replay, não a resposta.
- R2. O editor é a fonte do texto. O adaptador envolve toda chamada ao monitor em
  tratamento de erro; qualquer exceção desliga o monitor daquele campo, registra
  lacuna e rebaseia a partir do texto atual do editor. A resposta enviada nunca é
  lida do monitor.
- R3. O editor monta e aceita digitação sem esperar monitor, storage ou rede.
- R4. O envio final manda as respostas e chama `finish` sem aguardar o histórico.
  O último lote sai em paralelo, com teto de poucos segundos. O servidor pode
  aceitar lote de histórico atrasado dentro de uma janela curta, registrando o
  atraso.
- R5. Nenhum estado do monitor (conflito, lacuna, storage indisponível) abre
  diálogo, indicador ou bloqueio ao aluno. Divergência com
  outra aba ou dispositivo resolve-se sozinha: nova base a partir do texto do
  editor, com lacuna registrada, sem escolha do aluno.
- R6. Chave para desligar o monitoramento por prova (campo em `Exam`, ligado por
  padrão), utilizável com a prova em andamento.
- R7. Critério de aceite da integração: teste de injeção de falha em que o monitor
  lança em toda chamada, o storage falha e o transporte fica pendurado ou devolve
  erro, e mesmo assim o aluno digita, salva e entrega.

### Estado das regras R1 a R7

| Regra | Estado |
| :---- | :----- |
| R1 | Pendente: depende do endpoint do histórico, que não existe. Hoje nada do monitor toca `Submission`. |
| R2 | Implementada e testada em `adapter.ts` (specs `answer-edit-adapter` e `answer-edit-isolation`). Ligada a `ExamAttempt.tsx` (`recordEdit`) atrás da chave local, só para questões `essay`. |
| R3 | Implementada e testada: `attach` e `input` nunca esperam e o `open` roda adiado. |
| R4 | Implementada e testada: `flushFinal` resolve no teto (3 s por padrão). Falta o servidor aceitar lote atrasado. |
| R5 | Implementada: o coordenador rebaseia sozinho e nada do monitor aparece para o aluno. A lacuna só é mostrada ao revisor, quando houver tela. |
| R6 | Implementada e testada: `AnswerEditAdapter.disable()` e `enabled: false`. A página liga o monitor só com `localStorage["codehood.answerHistory"] = "on"`; falta o campo por prova em `Exam` e o aviso às páginas abertas (ver "Decidido em 2026-11-11"). |
| R7 | Implementada e testada em `test/answer-edit-isolation.spec.ts` com um `<textarea>` ligado como a página de prova seria. Repetida contra a página real em `test/exam-answer-edit-isolation.spec.ts` (IndexedDB que lança, que pendura, cota excedida, exceção no monitor, chunk que não carrega, remontagem do campo no prazo, reload). |

### Contrato do adaptador

Implementado em `src/services/answer-edits/adapter.ts`. É a única coisa que o
código de UI chama.

- `attach(field, text)`: fire-and-forget. O `open` do coordenador roda adiado e
  nunca atrasa o chamador.
- `input(field, text, kind?)`: só guarda o texto do editor. O trabalho do monitor
  (diff por prefixo e sufixo comuns, `recordChange`) roda num `setTimeout(0)`
  fora do handler de `input`. Uso documentado: gravar a resposta pelo canal dela
  primeiro, depois chamar `input`. A ordem errada é inofensiva, pois `input`
  nunca lê o monitor, não lança e não toca o canal da resposta.
- `detach(field)`, `isActive(field?)`, `gaps()`.
- `flushFinal()`: nunca rejeita e resolve no teto (`flushCeilingMs`), seja qual
  for o comportamento do monitor, do storage e do transporte. O chamador o roda
  em paralelo com `finish`.
- `disable(reason?)` é a chave do R6: o adaptador fica inerte e o coordenador é
  parado com `dispose`, que mantém o trabalho local.
- Toda chamada a monitor, coordenador e storage é protegida. A primeira exceção
  ou rejeição desliga o monitoramento do campo, registra a falha em `gaps()` (e
  `onGap`) e tenta `coordinator.detach` para tirar o estado pendente de um handle
  quebrado. Erros de programação do `open` (campo ativo, mais de 128 campos,
  coordenador parado) são engolidos do mesmo jeito.
- Edições feitas antes de o monitor ficar pronto não são enfileiradas: o texto do
  editor vale, e o monitor recebe uma única edição coalescida entre o texto do
  `attach` e o texto atual. O replay reproduz o texto; perde-se só a cadência de
  digitação do trecho. Custa memória O(1), sem limite de fila a defender.

### Contrato do coordenador

Implementado em `src/services/answer-edits/coordinator.ts`.

- `recover(field, initialText)` e `register(field, handle)` devolvem sempre
  `{ handle }`. Não há estado sem handle: nem conflito, nem texto apenas, nem
  indisponível. O texto vem do estado local (checkpoint) e, na falta
  dele, de `initialText`, que o chamador tira do canal da resposta. Com `register`
  o texto do editor vale mais que o estado guardado.
- Nenhum `open` espera rede. Falha de leitura de storage vira lacuna, não exceção.
  Só lançam erro de programação: campo já ativo, mais de 128 campos, coordenador
  parado por logout.
- A reconciliação com o servidor roda em segundo plano, depois que qualquer
  entrega em curso termina (um ACK durante a inspeção não pode virar divergência).
  Enquanto não termina, ou se `inspect` falha ou pendura, o campo edita e persiste
  localmente e não envia histórico; o ciclo de entrega tenta a inspeção de novo.
- Servidor compatível com o ponto de partida (sem lote em voo e, ou o texto do
  servidor é o texto confirmado local, ou o campo é novo nos dois lados) não é
  divergência: `AnswerEditMonitor.adoptBase` aponta a história pendente para a
  revisão e sequência do servidor sem descartar edições nem marcar lacuna. O mesmo
  vale para `register(handle)` sobre um campo com entrega em voo, quando o texto
  do editor é o do campo anterior já confirmado.
- Chamadas de storage (`read`, `commit`) têm teto (`storageTimeoutMs`, 5 s, pelo
  agendador injetado). Estourar o teto cai no caminho de storage indisponível:
  lacuna (`unavailable`); a resposta não depende disso.
- Divergência (base, recibo ou texto) ou resultado `conflict` do envio rebaseiam:
  `AnswerEditMonitor.rebase` adota o texto atual como nova base na revisão e
  sequência do servidor e descarta a história pendente. `FieldStatus.historyGap`
  fica `true`, exceto quando nada se perdeu (sem pendências e texto igual ao do
  servidor). A lacuna é visível ao cliente por esse status; o servidor a enxerga
  porque o primeiro lote após a nova base não reproduz o texto que ele guardava.
  Um marcador explícito no lote fica para o endpoint.
- Sobram `closed`/`canWrite: false` (prazo): o campo continua editável e salvo
  localmente, só não envia.

O monitor não tem armazenamento de texto próprio além do IndexedDB: o texto da
resposta é recuperado pelo rascunho local da página (`browserDraftStore`).

## Estado atual

`Response` identifica a tentativa da prova inteira; `Submission` registra uma
resposta a uma questão. Submissões são append-only e seu payload segue o MDQ.
`src/components/exam/ExamAttempt.tsx` coordena salvamentos por Astro Actions;
`CodeEssayAnswer.tsx` já integra edição e recuperação de rascunhos de código.

`src/components/question/mdq.ts` adapta os tipos de `QuestionView`, mas não expõe
injeção de editores. A dependência local `mdq` fornece hoje um textarea próprio em
`src/solid/Essay.tsx`. A extensão deve acontecer no contrato público da biblioteca,
não por busca de elementos no DOM ou edição dos documentos de questões.

A ponte `rest.batch` permite agrupar chamadas REST. O histórico usa endpoint
próprio, separado do canal da resposta.

## Arquitetura proposta

```text
Eventos do editor
  → adaptador de textarea / CodeMirror / rich text
  → AnswerEditMonitor
  → handle registrado no coordenador da prova
  → outbox persistente no navegador
  → uma chamada por minuto para a tentativa
  → endpoint de histórico valida e grava lote + âncora de replay
```

Cada instância da classe pertence a um campo editável de uma questão. O
coordenador identifica usuário, tentativa, questão e campo. Nenhum registro é
global: duas provas abertas não compartilham handles ou filas.

A classe possui estado lógico e mutação local. O adaptador traduz eventos nativos;
o coordenador possui rede, persistência e política de retry. O componente pode
emitir `onChange` para a resposta atual sem fazer uma requisição.

### Três componentes, um contrato

Nomes propostos: `MonitoredTextarea`, `MonitoredCodeEditor` e
`MonitoredRichTextEditor`. As props comuns incluem valor inicial, readonly,
identificação acessível, `onChange` e `onMonitorReady`. Props específicas como
linguagem e extensões do CodeMirror não entram na classe compartilhada.

O callback `onMonitorReady(handle)` registra o handle. Na desmontagem, o adaptador
fecha o edit aberto e publica seu último estado para persistência antes de chamar
`onMonitorReady(null)`. Desmontar não significa apagar alterações não confirmadas.
O coordenador mantém o estado pendente mesmo quando uma questão deixa de estar
visível. `dispose()` somente acontece depois dessa transferência.

O handle entrega operações, não acesso ao textarea ou à instância do CodeMirror.
Uma implementação externa pode recolher um lote sob demanda sem conhecer o editor.

## Documento e operações

A versão inicial descreve substituições numa string canônica. Posições e tamanhos
usam unidades UTF-16, como `String.slice` em JavaScript. Uma operação é:

```text
next = previous.slice(0, position)
     + insertedText
     + previous.slice(position + deleteCount)
```

Não normalizar espaços, quebras de linha ou Unicode entre captura e replay.
Qualquer normalização necessária deve fazer parte da definição do formato canônico
ou ser uma mudança explícita. O snapshot final deve ser idêntico ao replay.

Uma transação pode conter várias substituições em posições distintas. O adaptador
as fornece em coordenadas do documento anterior à transação, em ordem crescente,
sem sobreposição. A classe valida e converte para operações sequenciais aplicáveis,
por exemplo emitindo-as da direita para a esquerda. Não colapsar uma transação
complexa numa falsa sequência de teclas.

### Tuplas na rede e no banco

```ts
type EditTiming = readonly [
  intervalCount: number,
  meanIntervalMs: number,
  intervalM2Ms2: number,
];

type EditTuple = readonly [
  startDeltaMs: number,
  durationMs: number,
  position: number,
  deleteCount: number,
  insertedText: string,
  inputKind: number,
  timing: EditTiming | null,
];
```

O envelope contém `version`, sessão de edição, origem temporal, identificador do
lote, revisão base, primeira sequência e edits. A sequência de cada edit é
`firstSeq + índice`. O primeiro delta do lote é relativo à origem da sessão; os
seguintes são relativos ao início do edit anterior no mesmo lote. Um lote é
interpretável sem conhecer o timestamp do último edit do lote anterior.

Códigos iniciais de `inputKind`: 0 digitação, 1 colagem, 2 exclusão, 3 desfazer,
4 refazer, 5 composição, 6 outra mudança. São causas observadas, não garantias de
origem. Campos de enumeração e unidades pertencem à versão do formato.

Sem intervalos válidos, `timing` é `null`. Não usar variância zero para representar
ausência de informação. Com intervalos observados, variância populacional é
`M2 / intervalCount`. A tupla usa Welford e permite combinar estatísticas sem
salvar tempos individuais. Precisão e limites numéricos serão definidos na spec;
não arredondar os acumuladores a cada evento.

O envelope pode manter nomes legíveis. A economia se concentra na coleção
repetitiva; código de domínio trabalha com propriedades nomeadas por meio de um
codec único. Sem compressão binária na primeira versão.

### Agrupamento e tempos

Fechar o edit ao exceder a pausa configurada, mudar de posição, trocar de causa,
iniciar ou concluir composição, desfazer/refazer, recolher lote ou atingir limites
de tamanho/duração. A próxima entrada inicia outro edit.

Somente operações que preservem exatamente o replay podem ser agrupadas. Edições
não contíguas continuam separadas. Os intervalos acima do limite de pausa não
entram na variância interna. O início e a duração permitem recuperar as pausas.

Não inferir média de cadência por duração dividida pelo tamanho do texto. Uma
entrada pode inserir vários caracteres e um edit pode conter exclusões.

Tempos de entrada usam relógio monotônico da sessão. O servidor registra horário
de recebimento separadamente. Relógio e sequência do cliente não comprovam quando
ou por quem o texto foi escrito.

## API pública proposta da classe

Assinaturas conceituais, sem implementação. Tipos persistidos precisam de schemas
versionados próprios; os nomes abaixo não fixam o layout JSON de armazenamento.

```ts
type InputKind =
  | "typing" | "paste" | "delete" | "undo" | "redo"
  | "composition" | "other";

interface MonitorOptions {
  initialText: string;
  sessionId: string;
  baseRevision: number;
  firstSeq: number;
  pauseMs?: number;
  now: () => number;
}

// Opaque, issued by observeInput, valid only in the session that issued it.
type InputToken = string;

interface InputObservation {
  atMs: number;
  kind: InputKind;
}

interface TextReplacement {
  position: number;
  deleteCount: number;
  insertedText: string;
}

interface DocumentChange {
  atMs: number;
  input?: InputToken;
  kind: InputKind;
  replacements: readonly TextReplacement[];
}

interface PendingEditBatch {
  version: 1;
  batchId: string;
  sessionId: string;
  baseRevision: number;
  firstSeq: number;
  edits: readonly EditTuple[];
  snapshot: string;
}

interface BatchReceipt {
  batchId: string;
  revision: number;
  lastSeq: number;
}

interface MonitorState {
  text: string;
  hasPendingChanges: boolean;
  hasUnacknowledgedBatch: boolean;
}

interface MonitorCheckpoint {
  version: 2; // Only version accepted.
  state: unknown; // Validated by the codec when restored.
}

interface MonitorHandle {
  getState(): Readonly<MonitorState>;
  collect(): Readonly<PendingEditBatch> | null;
  acknowledge(receipt: BatchReceipt): void;
  exportCheckpoint(): Readonly<MonitorCheckpoint>;
}

declare class AnswerEditMonitor implements MonitorHandle {
  constructor(options: MonitorOptions);

  static restore(options: {
    checkpoint: MonitorCheckpoint;
    now: () => number;
    createSessionId?: () => string;
  }): AnswerEditMonitor;

  observeInput(input: InputObservation): InputToken;
  recordChange(change: DocumentChange): void;
  closeEdit(): void;

  getState(): Readonly<MonitorState>;
  collect(): Readonly<PendingEditBatch> | null;
  acknowledge(receipt: BatchReceipt): void;
  exportCheckpoint(): Readonly<MonitorCheckpoint>;
  subscribe(listener: (state: Readonly<MonitorState>) => void): () => void;
  dispose(): void;
}
```

### Semântica e invariantes da API

- `observeInput` observa intenção de entrada; não altera texto. `recordChange`
  registra a alteração efetiva. Um `keydown` sem alteração não gera edit.
- `observeInput` devolve um token; `DocumentChange.input` o consome. Token
  desconhecido, já consumido, de outra sessão ou de `kind` incompatível falha sem
  mutação. Uma intenção pode
  gerar várias substituições; seus intervalos entram nas estatísticas uma única
  vez. Entrada sem correspondência e composição não viram teclas fictícias.
- A classe não armazena teclas físicas nem referências a eventos DOM. Os
  adaptadores podem observar teclado, `beforeinput`, `input` e transações, mas
  devem reportar cada alteração efetiva somente uma vez.
- `recordChange` valida posições, sobreposição e associação de entrada. Dados
  inválidos falham sem mutação parcial. Mudanças programáticas reais, como aceitar
  um rascunho recuperado, também precisam ser registradas ou tratadas como uma
  recuperação explícita, nunca ignoradas silenciosamente.
- `collect` fecha o edit e congela um lote com snapshot daquele instante. Não
  remove dados. Sem alterações retorna `null`.
- Com lote não confirmado, chamadas seguintes de `collect` devolvem exatamente o
  mesmo lote e `batchId`, mesmo se o aluno continuar digitando. Alterações novas
  ficam retidas para o próximo lote; não alterar um pedido já enviado.
- Há no máximo um lote em trânsito por campo. `acknowledge` valida identificador,
  revisão e sequência; só então libera as operações confirmadas. Recebimento
  repetido idêntico é inofensivo; confirmação divergente exige reconciliação.
- `snapshot` serve para comparação e recuperação no transporte. Não é copiado
  para toda linha histórica no banco.
- `exportCheckpoint` inclui texto, operações ainda abertas/pendentes, lote em
  trânsito e metadados suficientes para reenvio idempotente. Exportar copia
  coerentemente o edit aberto, sem fechá-lo ou descartá-lo. IndexedDB é responsabilidade
  do coordenador.
- Recarregar a página cria outra origem de relógio monotônico. `restore` preserva
  os lotes antigos, fecha a sessão temporal anterior e estabelece uma nova sessão
  para entradas futuras. Não comparar `performance.now()` de páginas distintas.
- `subscribe` informa mudanças para persistência e indicadores; não dispara rede.
  A função retornada remove o listener.
- `dispose` libera listeners e recursos locais. Não confirma lotes nem apaga
  armazenamento persistente. Operações de edição após dispose são inválidas.
- Conflitos entre abas não se resolvem com `reset` silencioso. A reconciliação é
  externa: rebaseia a partir do texto do editor e registra a lacuna.

## Controles do monitor limitados por contagem

O monitor não usa relógio de parede nem TTL. O que fica retido tem limite fixo:

- Observações não consumidas: as 16 mais recentes; a mais antiga cai quando entra
  uma nova e seu token passa a ser desconhecido. Consumir um token remove a
  observação. Não há tombstones nem watermark: tokens vêm de um contador por
  sessão e não se repetem, e timestamps iguais são sempre válidos.
- Recibos: os 32 últimos. Repetição idêntica de um recibo retido é inofensiva;
  divergência é erro; recibo mais antigo é desconhecido e rejeitado sem tocar o
  lote em trânsito. Lote não confirmado nunca é descartado: ACK perdido e retry
  funcionam por qualquer duração.
- Sessões: não há registro próprio. O conjunto é derivado dos recibos retidos, do
  lote em trânsito, da fila e da sessão ativa. `restore` recusa um `sessionId`
  desse conjunto. `sessionId` deve ser UUID ou namespace único gerado pelo
  chamador; reuso de sessão já esquecida não é detectado. IDs de batch combinam
  sessão e sequência global crescente.
- Checkpoint (`version: 2`, única versão aceita; outra versão ou corrupção é
  rejeitada e a recuperação é externa, texto mais lacuna) guarda base confirmada,
  revisão e sequência globais, texto, pendências, recibos e a sessão ativa.
  Observações e cadência não entram: `restore` cria sessão nova com relógio
  monotônico novo e não transfere associações de input, mas conserva todos os
  edits e batches pendentes. Replay valida só as pendências contra a base.
- ACK válido remove imediatamente o batch em memória; a outbox durável fica sem
  esse batch no commit coerente seguinte. Falha nesse commit conserva a cópia
  durável anterior para retry/reconciliação, nunca declara durabilidade falsa.

O tamanho do checkpoint depende do texto e das pendências, não do número de
teclas recentes. Referência: um campo, texto de um caractere, 10 inputs/s por
90 minutos em lotes de 600 operações confirmados, com reload aos 60 minutos:
54.000 operações em 90 lotes e checkpoint de cerca de 2 KiB após cada ACK (pico
de 17 KiB com o lote de 600 operações pendente). A medição cobre JSON serializado,
não heap nem latência de edição.

O registro principal inteiro continua limitado a 2 MiB, incluindo texto,
checkpoint e outbox. Pendências offline grandes não são truncadas: a gravação
principal é recusada e o campo passa a `unavailable` com `historyGap`; o texto
continua no rascunho da página.
O envio não depende da gravação principal: o coordenador tenta persistir e envia
o lote congelado mesmo se o commit falhar (teto, IndexedDB indisponível, quota),
sem declarar durabilidade local enquanto isso. Depois do ACK o checkpoint encolhe
e a nova tentativa de commit pode voltar a `durable`. Após um crash nesse intervalo
a reconciliação com os recibos do servidor cobre o lote. Campos com o monitor
desligado não enviam histórico, mas a resposta segue seu canal. Não há teto de bytes por lote
(pendência: um lote muito grande ainda vai inteiro em um envio). Um ensaio browser
de 20 substituições de 128 KiB em dois segundos, seguido de resposta final
pequena, produziu checkpoint de 2,6 MB: o lote é enviado e, confirmado, o campo
volta a gravar. O TTL de 14 dias do registro de rascunho é outra política.

## Responsabilidades dos adaptadores

### Textarea

Usar o valor efetivo após `input` como fonte de verdade. Quando não houver uma
operação nativa confiável, comparar prefixo e sufixo comuns do valor anterior e
novo para obter uma substituição. Tratar seleção, colagem, exclusão, undo/redo,
autocorreção, ditado e IME. Não reconstruir texto com `keydown`.

### CodeMirror

Observar transações e mudanças do documento pelo contrato público do CodeMirror.
Manter o histórico de undo do editor independente do histórico de monitoramento.
Uma atualização de seleção sem alteração de documento não gera edit. Associar
metadados de entrada quando disponíveis sem contar uma mudança duas vezes.

### Rich text

Fora do escopo (decidido em 2026-11-11): não existe questão de rich text. O que
segue vale se ela vier a existir.

A escolha de biblioteca e do documento canônico precede sua implementação.
`textContent` não basta: alterar negrito, links ou listas pode não alterar o texto.

A classe desta versão aceita uma string canônica. O adaptador rich text somente
pode usá-la se houver serialização determinística e sem perda do documento que
queremos reproduzir. Uma transação pode virar substituições nessa serialização,
sem alegar correspondência entre caracteres de markup e teclas digitadas.

Se isso gerar diffs excessivos ou perder estrutura, definir outra versão de
operações de documento. Não forçar rich text a texto puro para caber no codec.
Renderização e sanitização de conteúdo continuam obrigatórias; histórico nunca
pode ser interpretado como HTML confiável.

## Recuperação local após falha do navegador ou da máquina

Persistência local é independente do intervalo de envio ao servidor. Esperar um
minuto para gravar no navegador deixaria justamente o último trecho vulnerável a
reinício, travamento ou fechamento inesperado.

Usar IndexedDB como armazenamento principal de texto, checkpoint do monitor e
outbox. Gravar uma visão coerente desses dados em uma transação. O coordenador
agenda gravações durante a edição, com coalescência e espera máxima inicial de
1 segundo, sem depender apenas de debounce de inatividade. A política e a latência
real devem ser medidas; há uma janela residual de perda e o navegador não garante
durabilidade contra toda falha de energia. Exportar checkpoint não fecha o edit:
a frequência de persistência não deve alterar os agrupamentos de digitação.

O monitor não tem fallback em `localStorage`. A página de prova já guarda um
rascunho local de cada resposta digitada (`browserDraftStore`, em
`src/components/exam/code-draft.ts`), que recupera o texto; duplicá-lo no monitor
criaria dois rascunhos concorrentes para o mesmo campo. Falha de IndexedDB não
autoriza truncar o histórico silenciosamente: o campo vira lacuna. Consequência
aceita: uma queda do navegador perde o histórico ainda não persistido (vira
lacuna), nunca a resposta.

Identificar registros por usuário, tentativa, questão e campo. Isolar contas,
estabelecer TTL e remover dados locais no logout e após entrega confirmada, de
acordo com a política de sessão. Armazenamento do navegador não é criptografia nem
barreira contra XSS ou acesso ao mesmo perfil do sistema operacional. Navegação
privada, limpeza de dados, quota e eviction podem remover registros.

Ao reabrir, autenticar e consultar o estado do servidor antes de reenviar. Texto
igual ao servidor não implica histórico confirmado: preservar lotes sem recibo
até reconciliar seus identificadores. Se revisão e recibos forem compatíveis,
restaurar e reenviar idempotentemente. Se houver divergência com outro dispositivo
ou aba, abrir nova base a partir do texto do editor e registrar lacuna, sem
diálogo (R5). O histórico nunca decide qual resposta vale.

Quando só o texto puder ser recuperado (pelo rascunho da página), registrar uma
lacuna no histórico. A recuperação não estende o prazo de entrega: depois do
encerramento, apresentar o texto e o status sem contornar a regra do servidor.

## Coordenador, persistência e envio

O coordenador registra handles por tentativa, questão e campo. A cada 55 a 65
segundos recolhe campos alterados. Persiste o pedido congelado antes de enviá-lo,
reenvia o mesmo identificador em falhas e só remove após confirmação. Falhas de
IndexedDB/quota ficam visíveis, sem impedir edição ou perder a resposta final.

Uma requisição reúne os lotes da tentativa. Cada campo tem resultado e confirmação
independentes; um conflito não apaga o trabalho dos outros. Aplicar backoff com
jitter e não disparar várias chamadas concorrentes para o mesmo campo.

Perto do prazo e ao entregar a prova, recolher imediatamente e enviar em paralelo
à entrega (R4). A entrega não consulta o estado do histórico. Se houver lacuna de
captura, registrar recuperação por snapshot; aquele trecho não é reproduzível.
Não fabricar edits para preencher a lacuna.

Não depender de `unload` ou `sendBeacon` para correção. Fechar o navegador pode
impedir qualquer envio. O autosave da resposta continua sendo o atual; o
coordenador de histórico não o integra nem o substitui.

## Banco de dados

Estrutura conceitual, ainda sem nomes Prisma definitivos:

| Entidade | Responsabilidade |
| :-- | :-- |
| Âncora de replay por tentativa/questão/campo | string canônica, revisão e metadados de sessão |
| Lote imutável | referência à âncora, revisão, batchId, sequência e edits JSON compactos |
| Checkpoint | snapshot ocasional em revisão conhecida para acelerar replay |

A âncora não é o histórico nem a resposta: pode ser atualizada a cada lote. Os
lotes são append-only e não armazenam uma cópia integral da resposta a cada
minuto. Nenhuma entidade aqui referencia ou altera `Submission`.

Criar unicidade por campo e revisão, e por identificador de lote no escopo
adequado. Retry com o mesmo identificador e conteúdo devolve o mesmo recibo;
identificador reutilizado com outro conteúdo é erro. Validar operações e snapshot
contra a revisão base e gravar lote + âncora numa transação. Lote recusado
registra lacuna e nunca afeta a resposta. Revisões concorrentes não podem ambas
vencer. Autor, questão, participação na prova e prazo vêm do
servidor, não dos metadados fornecidos pelo cliente.

As consultas normais de correção carregam a resposta, não todos os edits. Replay
lê lotes paginados a partir do checkpoint anterior ao instante desejado. Política
de checkpoint será definida por medição de tamanho e custo de replay.

O volume depende do total editado, incluindo texto depois apagado. Limitar bytes,
operações e crescimento por tentativa, além do tamanho final da resposta. Atingir
limite gera estado explícito de histórico incompleto; não truncar silenciosamente.

## Integração futura com MDQ

O tipo `code` do mdq ainda é recusado pelo Codehood (ver
`dev/issues/suporte-ao-tipo-code-do-mdq.md`). Quando passar a ser aceito, o
monitor deve cobri-lo, como cobre o `essay` de código.

Adicionar pontos de extensão para editores de texto e código arbitrários no
renderer, preservando os componentes padrão quando nenhuma extensão for passada.
O renderer conhece somente o contrato de editor; não conhece `AnswerEditMonitor`.

O contrato precisa transmitir valor, mudança de valor, readonly, acessibilidade e
metadados pertinentes, como linguagem. A aplicação fornece factories/componentes
que capturam o callback de registro do monitor. Não inserir dependência do
Codehood na biblioteca MDQ.

A primeira etapa fica em componentes independentes. Depois, alterar MDQ e o
wrapper do Codehood para injetá-los. Sem monkey patch, querySelector ou mudanças
no conteúdo das questões. A interação com o runner e `CodeEssayAnswer` deve
reutilizar o editor existente, não criar dois CodeMirror para o mesmo campo.

Não alterar a biblioteca MDQ nem sua API externa como parte da documentação deste
RFC. A mudança terá plano e testes próprios no repositório da biblioteca.

## Privacidade e interpretação

Só quem corrige a prova lê o histórico; o aluno não vê o próprio na primeira
versão. O sistema não mostra aviso ao aluno: informar a coleta é tarefa do
instrutor. O servidor guarda o histórico enquanto a tentativa existir e o apaga
com ela. A cópia no navegador é temporária: apagada quando o servidor a confirma e
quando a tentativa é entregue. O histórico pode guardar texto que o aluno apagou. Não coletar
clipboard geral, outras janelas, teclas fora do campo ou dados de outros sites.

A tela de revisão distingue eventos observados, horários de recebimento e lacunas.
Variância baixa é um indício contextual, não uma detecção automática de fraude.
Não criar impressão de precisão que os dados não suportam.

## Validação esperada na implementação

- Propriedade: aplicar os edits à base produz exatamente o snapshot e a resposta
  final, incluindo Unicode, emojis, exclusões, undo/redo e múltiplas substituições.
- Mesmo comportamento da classe com os três adaptadores compatíveis; IME,
  autocorreção, ditado, teclado virtual e colagem não são teclas artificiais.
- Agrupamento nas fronteiras de pausa e fechamento sob demanda; estatísticas com
  zero, um e vários intervalos e sem duplicação por transação.
- Coleta repetida, edição durante envio, perda de ACK, retry, reload, desmontagem,
  falha de armazenamento e confirmação fora de ordem sem perda de dados.
- Recuperação após encerramento abrupto sem eventos de unload, gravação durante
  digitação contínua, troca de usuário, expiração e
  reabertura após o prazo. Preservar texto não significa autorizar nova entrega.
- Autorização, prazo, reuso malicioso de batchId, limites e conflito entre abas.
- Replay com checkpoint e histórico incompleto.
- Injeção de falha do monitor, do storage e do transporte sem afetar a resposta (R7).
- Teste de carga com turma simultânea, medindo requisições, latência, contenção de
  escrita e bytes por aluno-hora. Não prometer capacidade só pela média de RPS.
- Dados de desenvolvimento que alcancem edição normal, recuperação, conflito e
  histórico incompleto quando a funcionalidade entrar na interface real.

## Casos de borda obrigatórios para o agente testador

Cada cenário abaixo precisa de teste explícito quando sua fatia for implementada.
Escrever primeiro o teste contra o contrato público, comprovar falha pelo motivo
correto e somente depois implementar. Trabalhar em lotes de até três critérios;
não produzir toda a suíte antecipadamente. Registrar comandos e resultados red e
green por lote. Testes ainda não aplicáveis ficam assinalados como pendentes, não
como aprovados. Injetar relógio e aleatoriedade; não usar sleeps.

### Monitor e codec

- Pausas de 999, 1.000 e 1.001 ms com limite 1.000: somente a pausa estritamente
  maior fecha por inatividade. Coleta explícita fecha independentemente da pausa.
- Tempo inválido, negativo, não finito ou regressivo é rejeitado sem mutação
  parcial; timestamps iguais são válidos e produzem intervalos zero observados.
- Campo vazio, inserção no início/fim, seleção total substituída, exclusão total,
  operação sem efeito e ida de texto não vazio para vazio. Nenhuma mudança pode
  desaparecer por tratar string vazia como ausência de valor.
- Emoji fora do BMP, acento combinante, texto RTL e quebras de linha: replay
  preserva exatamente as unidades UTF-16; nenhuma normalização implícita.
- Posição negativa, exclusão além do documento, frações e substituições
  sobrepostas: erro sem aplicar parte da transação. Múltiplas substituições
  válidas em coordenadas pré-transação produzem o documento esperado.
- Uma intenção ligada a várias substituições conta uma vez nas estatísticas.
  Intenção sem mudança, seleção e teclas de navegação não criam edits. Repetição
  inválida de identificador de entrada não duplica amostras silenciosamente.
- Zero, um e vários intervalos; intervalos constantes e variáveis com média e M2
  conhecidos. Pausa que abre outro edit não contamina a variância interna.
- Exportar checkpoint durante um edit não altera seu agrupamento. Serializar e
  restaurar preserva o replay; versões desconhecidas e checkpoints corrompidos
  são recusados sem apagar o rascunho original.
- Primeiro delta de cada lote usa a origem da sessão, inclusive a partir do
  segundo lote. Testar replay sem consultar o último timestamp do lote anterior.

### Coleta, confirmação e concorrência

- `collect` sem mudanças retorna null. Coletas repetidas de um lote pendente
  mantêm identificador, snapshot e conteúdo. Editar durante envio não modifica
  esse lote e aparece no seguinte após confirmação.
- ACK perdido após commit no servidor seguido de retry não cria outra revisão.
  Mesmo batchId com conteúdo diferente é recusado. ACK repetido idêntico é
  inofensivo; ACK de outro lote ou sequência/revisão divergente não apaga dados.
- Duas abas enviando a mesma revisão base: no máximo uma vence; a outra rebaseia
  a partir do texto do editor com lacuna registrada, sem diálogo.
- Falha de um campo num lote da prova não impede confirmação de outro. Retry
  não reenvia campo já confirmado como se fosse uma alteração nova.
- Campo desmontado durante requisição ou durante edit aberto conserva pendências.
  Registrar novamente o mesmo campo não cria dois donos ativos ou dois envios.
- Reload com lote antigo pendente e relógio monotônico reiniciado: replay antigo
  continua válido e novas entradas usam sessão nova sem intervalos negativos.

### Persistência e recuperação

- Digitação contínua, sem pausa de 1 segundo e sem evento de unload: gravações
  locais respeitam a espera máxima e recuperam o último checkpoint concluído.
- Gravações assíncronas finalizando fora de ordem não fazem um snapshot antigo
  substituir o novo. Abort de transação não deixa texto e outbox incompatíveis.
- Quota excedida e IndexedDB indisponível: edição continua, a lacuna é observável
  e o histórico não é declarado salvo localmente.
- Histórico não confirmado sobrevive mesmo se o texto já for igual ao do servidor.
- Logout, troca de usuário e TTL não expõem rascunho de outra conta. Callback
  assíncrono antigo após logout não recria dados removidos da sessão encerrada.
- Rascunho local divergente do servidor resolve-se sem escolha do aluno (nova base,
  lacuna), nunca por timestamp do navegador. Após prazo encerrado, recuperação não
  reabre a entrega.

### Adaptadores e integração

- IME iniciado e cancelado, composição confirmada, autocorreção, ditado e teclado
  virtual: uma mudança efetiva por operação, sem teclas fictícias nem texto perdido.
- Colagem extensa, corte, undo/redo e mudança de cursor no meio da digitação:
  replay correto, causa adequada e agrupamento encerrado quando necessário.
- Monitor que lança em toda chamada, storage falhando e transporte pendurado ou com
  erro: o aluno digita, salva e entrega (R7). Monitor desligado no meio da prova
  mantém a digitação e a resposta intactas (R2, R6).
- Atualização de valor controlado e eco de `onChange` não registram o mesmo texto
  duas vezes. Aceitar um rascunho diferente é uma mudança explícita.
- Readonly não captura alterações de usuário. Instâncias montadas/desmontadas
  repetidamente não acumulam listeners ou callbacks de coleta.
- Textarea e CodeMirror equivalentes produzem o mesmo texto por replay, sem
  exigir que transações nativas diferentes tenham segmentação idêntica.
- Quando rich text for definido, alteração somente de formatação deve aparecer
  no documento recuperado; sanitização rejeita conteúdo executável no replay.

### Servidor e entrega

- Acesso a tentativa ou campo de outro aluno, questão fora da prova, sequência
  inconsistente e snapshot divergente não gravam lote nem alteram a âncora, e não
  afetam `Submission`.
- Falha entre inserção do lote e atualização da âncora faz rollback de ambos.
  O teste deve observar a garantia por leitura pública, não por detalhes SQL.
- Fronteira exata do prazo segue a regra existente do service. Lote de histórico
  atrasado é aceito só dentro da janela curta e registra o atraso (R4).
- Limites exatamente no máximo e um acima para bytes UTF-8, edits e crescimento
  acumulado. Muitos caracteres multibyte não contornam limite contado por bytes.
- Falta de histórico ou limite atingido não afeta a resposta válida e nunca produz
  indicação falsa de histórico completo.

## Perguntas abertas

- Q5. Respondida: tempos são milissegundos inteiros. O monitor arredonda com
  `Math.round` a origem da sessão e todo `atMs` recebido (função monótona, então
  ordem e empates se preservam); o codec e o checkpoint exigem inteiros seguros.
  Média e M2 dos intervalos continuam em ponto flutuante.

As demais perguntas (Q1 a Q4 e Q6 a Q8) foram decididas em 2026-11-11, ver
"Decidido".
