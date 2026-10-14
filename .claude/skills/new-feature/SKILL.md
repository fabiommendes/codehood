---
name: new-feature
description: Desenha uma funcionalidade nova do Codehood em conversa com o humano, camada por camada, até virar um spec com plano de ação dividido em tarefas para sub-agentes. Use quando o humano pedir para desenhar, planejar ou especificar uma funcionalidade nova.
---

# Nova funcionalidade

O objetivo é chegar a um entendimento comum com o humano e terminar com um
spec em `dev/specs/to-do/<slug>.md` que sub-agentes consigam executar sem
voltar a perguntar. Escreva o spec e a conversa em português. Código,
identificadores e comentários no código continuam em inglês.

## 1. Entender o problema

- Pergunte qual é o problema, quem usa (aluno, professor, CLI) e o cenário
  concreto de uso. Uma pergunta curta basta; não faça questionário.
- Leia os termos do `GLOSSARY.md` e os modelos de `prisma/schema.prisma`
  ligados ao tema. Procure specs parecidas em `dev/specs/`. Use o que existe
  (ex.: prender uma funcionalidade a `CalendarEvent` em vez de criar outra
  noção de aula).

## 2. Propor antes de ouvir a solução do humano

Antes de o humano detalhar o que tinha em mente, proponha de 5 a 10 ideias
agrupadas por eixo (mecanismo, antifraude, resultado...). Marque a
recomendação com 🟢 e diga qual seria a v1. Isso dá ao humano algo para
comparar e costuma revelar requisitos que ele não tinha dito.

Quando a ideia do humano tiver um furo, diga com 💩 e mostre o caso concreto
que quebra. Em seguida, proponha o ajuste que preserva a intenção dele.

## 3. Decidir em camadas

Valide uma camada por vez, nesta ordem, e só passe para a próxima quando o
humano aprovar a atual:

1. **Banco**: modelos Prisma, com comentários `///` e cascatas.
2. **Entidades**: schemas Zod em `src/core/schemas/`, métodos do service
   além do CRUD. Siga `src/db/services/README.md`.
3. **REST e permissões**: tabela de rotas e tabela papel × ação.
4. **Telas e fluxos**: uma linha por tela, com quem acessa e o que faz.
5. **CLI**: o que muda em `cli/` (leia `cli/CLAUDE.md` antes).
6. **Dados de dev**: o que `src/db/bootstrap.ts` precisa semear para cada
   estado da funcionalidade.

Em cada rodada:

- Mostre o artefato concreto (trecho de schema, tabela), não só a descrição.
- No máximo 3 decisões `D` por rodada, com opções e 🟢 na recomendada, mais
  perguntas `Q` curtas quando faltar informação.
- Decida sozinho o que é pequeno e reversível e registre como `J`, sem
  perguntar.
- Antes de propor algo que depende de código existente, confira o código
  (rotas, como o service apaga, o que a CLI chama). Aponte consequências que
  o humano pode não ver, como uma cascata que apaga dados ou uma chave
  natural que não pode mudar.
- Termos novos de domínio: pergunte se entram no `GLOSSARY.md`.

## 4. Escrever o spec

Arquivo `dev/specs/to-do/<slug>.md`, em português, no formato das specs
existentes (frontmatter `type: spec`, `status`, `tags`, `relatedTo`):

- **Contexto**: o problema em um parágrafo.
- **Requisitos**: numerados (`R1`, `R2`...), agrupados pelas camadas da
  seção 3. Cada decisão `D` e `J` da conversa vira um requisito; nenhuma
  pode ficar só na conversa.
- **Fora do escopo**: o que foi discutido e ficou para depois.
- **Plano de ação**: tarefas numeradas (`T1`, `T2`...), cada uma com:
  arquivos tocados, requisitos cobertos, dependências, modelo do sub-agente e
  critério de pronto verificável (teste que passa, comando que sai 0).
- **Critérios de aceite**: o que o humano vai conferir no fim, com evidência
  (screenshot, saída de teste).

Mostre o spec ao humano e espere aprovação antes de executar.

## 5. Executar com sub-agentes

Você coordena: distribui as tarefas, revisa o resultado e roda as
verificações. Não repasse a coordenação a um sub-agente.

### Testes primeiro

Cada tarefa com lógica segue TDD, em três papéis:

1. **Projetista de testes (`opus`).** Um único agente para a funcionalidade
   inteira, reaproveitado entre tarefas com `SendMessage` para manter o
   contexto do spec. Para cada tarefa, ele lista os casos de teste: entrada,
   resultado esperado e o requisito `R` que o caso prova. Mantém só testes de
   regra de negócio que pegariam um bug real. Corta testes de getter, de
   framework, de forma de objeto já garantida pelo Zod e casos que repetem
   outro.
2. **Escritor de testes (`haiku` ou `sonnet`).** Transforma a lista em
   código de teste e confirma que os testes falham pelo motivo certo. Use
   `haiku` quando os casos forem diretos; `sonnet` quando o teste exigir
   montar cenário com várias entidades ou interagir com páginas.
3. **Implementador (`sonnet`).** Faz os testes passarem sem editá-los. Se
   achar um teste errado, devolve para você com a justificativa em vez de
   mudar o teste.

Tarefas mecânicas sem regra de negócio (schema já aprovado, seed, glossário)
pulam o projetista e vão direto ao implementador.

### Modelos

Escolha do modelo por tarefa:

| Modelo   | Quando                                                                                       |
| :------- | :------------------------------------------------------------------------------------------- |
| `haiku`  | Mecânico e totalmente especificado: migração de schema já aprovado, seed, glossário, changelog. |
| `sonnet` | Lógica de service, permissões, endpoints, telas, testes, mudanças na CLI.                     |

- Dê a cada sub-agente o caminho do spec, os requisitos e a tarefa `T` dele,
  os arquivos que pode tocar e o critério de pronto. Ele não vê a conversa.
- Mande o sub-agente ler, antes de começar, os guias das partes que a tarefa
  toca:

  | Se a tarefa toca             | Leia                                     |
  | :--------------------------- | :--------------------------------------- |
  | `src/db/`, `src/core/schemas/` | `src/db/services/README.md`            |
  | `src/api/`                   | `src/api/README.md`                      |
  | rotas e páginas de curso     | `src/urls/README.md`                     |
  | `src/commands/`              | `src/commands/README.md`                 |
  | `test/stories/`              | `test/stories/README.md`                 |
  | `cli/`                       | `cli/CLAUDE.md` e `cli/README.md`        |
- Rode em paralelo só as tarefas sem dependência entre si e sem arquivos em
  comum. Se precisarem de isolamento, use `isolation: "worktree"`.
- Ao receber cada resultado, confira o diff e rode o critério de pronto antes
  de liberar as tarefas que dependem dela.
- No fim: `pnpm exec biome check --write .`, `pnpm run lint`, os testes
  afetados, seed conferido no dev server. Depois mova o spec para
  `dev/specs/to-review/` e registre no `CHANGELOG.md`.
