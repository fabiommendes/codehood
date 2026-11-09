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
- Separar estado atual, lotes imutáveis e checkpoints ocasionais.
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

## Estado atual

`Response` identifica a tentativa da prova inteira; `Submission` registra uma
resposta a uma questão. Submissões são append-only e seu payload segue o MDQ.
`src/components/exam/ExamAttempt.tsx` coordena salvamentos por Astro Actions;
`CodeEssayAnswer.tsx` já integra edição e recuperação de rascunhos de código.

`src/components/question/mdq.ts` adapta os tipos de `QuestionView`, mas não expõe
injeção de editores. A dependência local `mdq` fornece hoje um textarea próprio em
`src/solid/Essay.tsx`. A extensão deve acontecer no contrato público da biblioteca,
não por busca de elementos no DOM ou edição dos documentos de questões.

A ponte `rest.batch` permite agrupar chamadas REST. Ela não substitui uma operação
de domínio que salva histórico e estado atual atomicamente.

## Arquitetura proposta

```text
Eventos do editor
  → adaptador de textarea / CodeMirror / rich text
  → AnswerEditMonitor
  → handle registrado no coordenador da prova
  → outbox persistente no navegador
  → uma chamada por minuto para a tentativa
  → service valida e grava estado atual + lote na mesma transação
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

interface InputObservation {
  id: string;
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
  inputId?: string;
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
  // Versioned opaque state, validated by the codec when restored.
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
  }): AnswerEditMonitor;

  observeInput(input: InputObservation): void;
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
- `inputId` associa observação e mudança sem duplicar contagem. Uma intenção pode
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
  trânsito e metadados suficientes para reenvio idempotente. Exportar fecha ou
  copia coerentemente o edit aberto, sem descartá-lo. IndexedDB é responsabilidade
  do coordenador.
- Recarregar a página cria outra origem de relógio monotônico. `restore` preserva
  os lotes antigos, fecha a sessão temporal anterior e estabelece uma nova sessão
  para entradas futuras. Não comparar `performance.now()` de páginas distintas.
- `subscribe` informa mudanças para persistência e indicadores; não dispara rede.
  A função retornada remove o listener.
- `dispose` libera listeners e recursos locais. Não confirma lotes nem apaga
  armazenamento persistente. Operações de edição após dispose são inválidas.
- Conflitos entre abas não se resolvem com `reset` silencioso. A reconciliação é
  externa e inicia uma nova base explícita, preservando evidência de lacuna.

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

## Coordenador, persistência e envio

O coordenador registra handles por tentativa, questão e campo. A cada 55 a 65
segundos recolhe campos alterados. Persiste o pedido congelado antes de enviá-lo,
reenvia o mesmo identificador em falhas e só remove após confirmação. Falhas de
IndexedDB/quota ficam visíveis, sem impedir edição ou perder a resposta final.

Uma requisição reúne os lotes da tentativa. Cada campo tem resultado e confirmação
independentes; um conflito não apaga o trabalho dos outros. Aplicar backoff com
jitter e não disparar várias chamadas concorrentes para o mesmo campo.

Perto do prazo e ao entregar a prova, recolher imediatamente. A entrega vincula a
submissão ao estado de histórico aceito no servidor. Se houver lacuna de captura,
registrar recuperação por snapshot e informar que aquele trecho não é reproduzível.
Não fabricar edits para preencher a lacuna nem descartar a resposta válida.

Não depender de `unload` ou `sendBeacon` para correção. Fechar o navegador pode
impedir qualquer envio. O fluxo novo deve integrar ou substituir o autosave atual,
não duplicá-lo com outro canal de requisições.

## Banco de dados

Estrutura conceitual, ainda sem nomes Prisma definitivos:

| Entidade | Responsabilidade |
| :-- | :-- |
| Estado atual por tentativa/questão/campo | string canônica, revisão e metadados de sessão |
| Lote imutável | referência ao estado, revisão, batchId, sequência e edits JSON compactos |
| Checkpoint | snapshot ocasional em revisão conhecida para acelerar replay |
| Vínculo da submissão final | referência à revisão do estado entregue |

O estado atual não é o histórico: pode ser atualizado a cada lote. Os lotes são
append-only e não armazenam uma cópia integral da resposta a cada minuto.

Criar unicidade por campo e revisão, e por identificador de lote no escopo
adequado. Retry com o mesmo identificador e conteúdo devolve o mesmo recibo;
identificador reutilizado com outro conteúdo é erro. Validar operações e snapshot
contra a revisão base e gravar lote + estado numa transação. Revisões concorrentes
não podem ambas vencer. Autor, questão, participação na prova e prazo vêm do
servidor, não dos metadados fornecidos pelo cliente.

As consultas normais de correção carregam a resposta, não todos os edits. Replay
lê lotes paginados a partir do checkpoint anterior ao instante desejado. Política
de checkpoint será definida por medição de tamanho e custo de replay.

O volume depende do total editado, incluindo texto depois apagado. Limitar bytes,
operações e crescimento por tentativa, além do tamanho final da resposta. Atingir
limite gera estado explícito de histórico incompleto; não truncar silenciosamente.

## Integração futura com MDQ

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

Informar a coleta ao aluno, restringir acesso aos responsáveis pela avaliação e
definir retenção. O histórico pode guardar texto que o aluno apagou. Não coletar
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
- Autorização, prazo, reuso malicioso de batchId, limites e conflito entre abas.
- Replay com checkpoint, histórico incompleto e vínculo exato da entrega final.
- Teste de carga com turma simultânea, medindo requisições, latência, contenção de
  escrita e bytes por aluno-hora. Não prometer capacidade só pela média de RPS.
- Dados de desenvolvimento que alcancem edição normal, recuperação, conflito e
  histórico incompleto quando a funcionalidade entrar na interface real.

## Perguntas abertas

- Q1. Qual biblioteca de rich text e qual representação canônica preservam o
  documento sem amplificação excessiva de diffs?
- Q2. Monitorar inicialmente somente essays ou também campos curtos e lacunas?
  O identificador de campo permite ambos, mas o escopo inicial ainda será fechado.
- Q3. Qual retenção, quem pode consultar e como o aluno acessa o próprio histórico?
- Q4. Quais limites por edit, lote e tentativa e qual frequência de checkpoints?
- Q5. Qual precisão dos tempos e acumuladores será serializada? Não registrar
  precisão maior que a oferecida pelo navegador.
- Q6. Qual UX de reconciliação entre abas e dispositivos, e como comunicar que
  uma resposta foi salva mas parte do histórico não foi recuperada?
- Q7. Quais props finais de injeção de editores serão aceitas pela biblioteca MDQ?
