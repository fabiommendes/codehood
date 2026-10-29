---
type: spec
status: review
tags: [mdq, questions, exams, grading, cli, components]
relatedTo: [../mdq/dev/rfcs/0002-componentes-solid.md]
---

# Trocar `src/mdq` pela biblioteca `mdq`

## Contexto

- `src/mdq/*` (3.5k linhas, 46 consumidores) implementa uma versão antiga do
  MDQ. O CLI só consegue enviar questões porque `cli/codehood/push/wire.py`
  degrada o documento do mdq-py para esse formato antigo, perdendo campos
  (`weight`, `grading`, `diacritics`, `reject` em blanks...). Push de essay e de
  numeric com fração já falham hoje.
- A biblioteca `mdq` (`../mdq/mdq-js`) implementa a spec atual (`../mdq/docs`),
  incluindo forma pública (`publicForm`), respostas corretas
  (`correctResponses`), correção (`scoreResponse`) e componentes SolidJS
  (`mdq/solid`, RFC 0002 do mdq).

## Regra

Não existe campo ou comportamento MDQ exclusivo do codehood. Toda divergência
da spec atual é bug do codehood. `src/mdq` vira uma fachada fina sobre `mdq`
(reexports e helpers do servidor); o formato persistido e trafegado é o da
spec. Nada de adaptadores que preservem formatos antigos.

## Decisões

1. **Dependência.** `"mdq": "link:../mdq/mdq-js"` em `devDependencies`, com
   `vite.ssr.noExternal: ["mdq"]`: o bundle do servidor carrega o mdq e o
   `pnpm install --prod` do servidor não precisa dele. O CI faz checkout de
   `fabiommendes/mdq-spec` ao lado (como o job `cli` já faz) e compila a
   mdq-js. `scripts/package.ts` cria o irmão `mdq` como link para o checkout
   local e o compila. Consequência: o codehood não fixa versão do mdq; o push
   do mdq precisa vir antes do push do codehood.
2. **Documento completo no `privatePayload`.** `publicPayload` =
   `publicForm(doc)`; `privatePayload` = o documento inteiro, já com ids
   (`withIds`). `splitQuestion`/`mergeQuestion` somem: ler para corrigir é ler
   uma coluna. A leitura de aluno continua sem selecionar a coluna privada.
3. **Ids de escolha.** Documento novo passa por `withIds` antes de gravar. Os
   ids já gravados (algoritmo antigo) são mantidos na migração, porque as
   respostas apontam para eles. Nunca re-derivar ids de documento gravado.
4. **Resposta = valor da spec.** `Submission.payload` guarda a resposta de
   `responses.md` sem envelope: MC `"id"`, MS `["id"]`, TF `{id: bool|null}`,
   numeric `number|string|{value, unit}`, short-answer e essay `"texto"`,
   fill-in `{blank: resposta}`. `null` = questão pulada. O schema Zod de
   `submissionPayload` passa a aceitar qualquer valor JSON e o servidor valida
   a resposta contra a questão no submit (endereçabilidade: id desconhecido é
   erro 400, não nota zero).
5. **Forma pública na API.** A mdq-js não tem schema Zod da forma pública. O
   codehood escreve `questionPublicSchema` seguindo `public-form.md` (fonte
   única para OpenAPI e cliente Python), em `src/core/schemas/`.
6. **Validação de documento.** `validateDocument` (schema + regras de modelo)
   substitui `Question#validate()` e `questionSchema`.
7. **Mudanças de nota aceitas** (seguem a spec): key de MC = escolhas com score
   1; `diacritics: fold` por padrão; `unmatched` no lugar de "reject declarado
   vira pendente"; `*` sozinho é erro; fill-in `symmetric` = média dos blanks;
   numeric com `Fraction` e arredondamento. Feedbacks já gravados não mudam;
   telas de revisão e estatísticas passam a marcar o correto pela spec.
8. **Mesmo `versionHash`, metades diferentes.** Continua 409: sem migração
   de dados, as duas metades são derivadas do documento de forma
   determinística, e uma versão gravada nunca é reescrita.
9. **`ordering` entrou depois** do resto: enum Prisma `ORDERING`, schema
   público e seed. A página da prova embaralha o pool por tentativa
   (`src/mdq/shuffle.ts`), como a spec exige do host.
10. **Componentes.** Cada componente de `src/components/question/` é apagado
    quando a versão de `mdq/solid` chega, na ordem MultipleChoice, TrueFalse,
    MultipleSelection, ShortAnswer, Numeric, Essay, FillIn, QuestionView. Até
    lá, as views antigas passam a ler a forma pública e o resultado novos
    (sem `preamble`, `content` no lugar de `input`, `feedback` como lista).
11. **Sem migração de dados.** Produção não tem questões nem respostas; o dev
    usa `pnpm run db:reset`. O `preamble` das fixtures e do seed vira o
    primeiro parágrafo do stem.

## Plano

Cada fase termina com `pnpm run lint` e a suíte Playwright verdes.

- **F0. Infra:** dependência, `noExternal`, CI,
  `scripts/package.ts`, `mdq/css/daisyui.css` e ajustes de prose em
  `src/styles/global.css`.
- **F1. Schemas e API.** `core/schemas/question.ts` sobre os schemas Zod do
  mdq; `questionPublicSchema` novo; `submissionPayload` como valor JSON;
  regenerar o OpenAPI e `cli/codehood/api/generated.py`; `wire.py` encolhe a
  quase só `model_dump` (pede coordenação com o CLI, que é subtree).
- **F2. Camada de dados.** `src/mdq/index.ts` vira fachada (reexports +
  helpers); `question.service.ts` grava com `withIds`/`publicForm` (decisão 2)
  e aplica a decisão 8; submit valida a resposta (decisão 4).
- **F3. Consumidores.** `question-stats.ts`, páginas de correção,
  `grading/answer-text.ts`, `AnswerView`, `AnswerKey`, `QuestionPreview`,
  `ExamAttempt` e `answer-payload.ts` passam a usar `correctResponses`,
  `scoreResponse` e respostas da spec.
- **F4. Componentes.** MultipleChoice entra sem adaptador; os próximos a cada
  handoff da sessão mdq-js. Views antigas restantes lendo formatos novos.
- **F5. Seed, fixtures e testes.** `src/db/bootstrap.ts` e as fixtures no
  formato novo, cobrindo os estados de cada tipo; testes de lógica MDQ que a
  mdq-js já cobre saem de `test/mdq-*.spec.ts`; ficam os de integração.
- **F6. Limpeza.** Apagar `schemas-generated.ts`, `public/mdq.schema.json`,
  `split.ts`, `scoring.ts` e afins; fechar
  `dev/issues/server-mdq-atrasado-em-relacao-ao-mdq-py.md`.

## Pendências

- **Nota por blank: feita no mdq** (spec `docs/question-types/fill-in.md`,
  seção "Blank scores"; mdq-py b4bbdaa). `QuestionScore.blanks` é um
  `Record<blankId, BlankScore | null>`: `null` é blank pendente, blank vazio é
  `{score: 0, feedback: []}`. A mdq-js já tem `BlankScore` (59236eb), que
  `src/components/question/mdq.ts` usa.
- `scoreBlanks` também serve para resposta pendente (tela de revisão);
  `combineBlanks(question, response, manual)` dá a nota com a nota do
  professor em [0, 1] para cada blank pendente. O comentário do professor por
  blank não vai para a biblioteca: fica no codehood, junto da nota manual.
- O FillIn de `mdq/solid` já marca cada blank em revisão e mostra o feedback
  de cada um, com a marca "parcial" para 0 < nota < 1 (mdq-js 1d9d9bb).
- Resultado pendente: `PendingResult` e `isPending` já estão em `mdq/solid`.
- O codehood usa tudo isso desde `dev/specs/to-review/revisao-por-lacuna.md`.
