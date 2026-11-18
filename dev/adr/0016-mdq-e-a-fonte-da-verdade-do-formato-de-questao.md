---
type: adr
status: accepted
tags: [mdq, questoes, provas, correcao, cli]
relatedTo: [0014-versao-unica-e-mdq-fixado-por-mdq-ref]
created: 2026-11-17
creator: claude
---

# MDQ é a fonte da verdade do formato de questão

O formato de questão, de resposta e a correção são os da spec MDQ
(`../mdq/docs`), implementados pela biblioteca `mdq` (`../mdq/mdq-js` no
servidor, mdq-py na CLI). O codehood não tem formato próprio.

## Decisão

- **Não existe campo ou comportamento MDQ exclusivo do codehood.** Toda
  divergência da spec é bug do codehood, corrigido aqui ou levado para o mdq.
  `src/mdq/` é uma fachada fina (reexports e helpers do servidor), sem
  adaptadores que preservem formatos antigos no que se grava ou trafega.
- **Documento inteiro no `privatePayload`.** Cada versão de questão grava
  `privatePayload` = o documento completo, já com ids (`withIds`), e
  `publicPayload` = `publicForm(documento)`. Corrigir é ler uma coluna. A
  leitura de aluno nunca seleciona a coluna privada.
- **Ids de escolha nunca são re-derivados.** Documento novo passa por
  `withIds` antes de gravar. Um documento gravado mantém os ids que tem, porque
  as respostas apontam para eles.
- **Resposta é o valor da spec, sem envelope.** `Submission.payload` guarda a
  resposta de `responses.md`: MC `"id"`, MS `["id"]`, TF `{id: bool|null}`,
  numeric `number|string|{value, unit}`, short-answer e essay `"texto"`,
  fill-in `{blank: resposta}`. `null` é questão pulada. O servidor valida a
  resposta contra a questão no submit: id desconhecido é erro 400, não nota
  zero.
- **Forma pública na API.** A mdq-js não exporta schema Zod da forma pública;
  o codehood mantém `questionPublicSchema` (`src/mdq/public-schema.ts`)
  seguindo `public-form.md`, fonte única do OpenAPI e do cliente Python.
- **Mesmo `versionHash` com metades diferentes é 409.** As duas metades
  derivam do documento de forma determinística e uma versão gravada nunca é
  reescrita.
- **Embaralhar é do host.** A página da prova embaralha o pool por tentativa
  (`src/mdq/shuffle.ts`), como a spec exige.

## Versão do mdq

O commit do mdq usado pelo codehood é fixado por `.mdq-ref` (ADR 0014). Adotar
um mdq novo é `pnpm run mdq:bump`; mudança de formato entra primeiro no mdq.

## Consequências

- Versões gravadas pelo codehood 0.2 (metades complementares e spec antiga,
  com `preamble`, `input` de essay e `oneOf`) são lidas por
  `upgradeLegacyQuestion` em `src/mdq/legacy.ts`. É a única exceção à regra
  de não adaptar formatos antigos, e só na leitura.
- Mudanças de nota da spec valem para correções novas (por exemplo, key de MC
  = escolhas com score 1, `diacritics: fold` por padrão, fill-in `symmetric`
  como média dos blanks). Feedbacks já gravados não mudam.
- Componentes de questão vêm de `mdq/solid`; o codehood não reimplementa
  views que a biblioteca já tem.
