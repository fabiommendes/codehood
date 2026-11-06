# Handoff: importar a prova de Prolog do Moodle e pesos por questão

Estado em 2026-11-05. Duas frentes: a importação das respostas da Prova 1 de
Paradigmas, aplicada no Moodle, já validada na cópia local e ainda não feita em
prod; e o peso por questão no Codehood, que o professor quer antes de liberar
as notas.

## 1. Importação das respostas (pronta no local, falta prod)

### O que já está em prod (`codehood.dev`)

- Prova `prova-1` ("Prova 1") no curso `paradigmas/chips_2026-2`, em `DRAFT`,
  `scheduledAt` 2026-09-30 14:00 -03:00, 100 min, 13 questões na ordem do
  Moodle. Foi criada pela REST (`POST /api/course/.../exam`), porque o
  `codehood push` não envia provas. A `prolog-moodle` antiga ficou `ARCHIVED`.
- Questões do curso (`~/aulas/paradigmas/ch`) enviadas com os slugs novos
  (`id` do frontmatter). Na `prova-1`:
  - `prolog-avaliador-de-expressoes` aceita as 8 ordens que funcionam
    (cláusula de `+` antes ou depois da de `*`, operandos em qualquer ordem),
    todas testadas no SWI-Prolog 10. Critério do professor: código válido que
    resolve a questão vale 1, o resto vale 0;
  - `logica-negacao-escopo` e `prolog-meta-motivacao` têm `grading: partial`.
- O curso local não tem nenhum commit no git.

### Arquivos

| Caminho | O que é |
| :-- | :-- |
| `tmp/moodle-prolog/raw.json` | Respostas da API do Moodle, 4 cópias fundidas (git ignora `tmp/`). |
| `tmp/moodle-prolog/{quiz.mdq.md,responses.yaml,grades.csv}` | Saída do `aprender fetch raw.json`. `grades.csv` tem as notas do Moodle em pontos, não em fração. |
| `tmp/moodle-prolog/build-plan.mjs` | Gera `plan.json` e `report.md` a partir dessa saída e das questões de um banco. Rodar da raiz: `node tmp/moodle-prolog/build-plan.mjs --db <banco>`. |
| `deploy/scripts/import-moodle-responses.mjs` | Grava o plano no banco com `node:sqlite`, sem dependências. Simula por padrão; `--apply` grava. Idempotente: quem já tem tentativa é pulado. Falha se as questões da prova mudaram depois do plano (`versionHash`). Sem commit no repositório `deploy/`. |
| `tmp/dev.db.prod-20261105-clean` | Cópia de prod de 2026-11-05 13:45 UTC, antes da importação. |

O que o script grava: `ResponseRef` fechada (`acceptingSubmissions = 0`) com
início e fim do Moodle; um `Submission` por questão respondida
(`GRADED_AUTOMATICALLY` com `Feedback` do bot `auto`, `ref = moodle-import`,
nas objetivas; `PENDING_GRADE` nas dissertativas, que o Moodle não corrigiu);
`ExamException` para a turma das 16h (`scheduledAt` 16:00) e para os 11 com
tempo extra (50 min).

### Validação feita

- `dev.db` = prod de 2026-11-05 13:45 UTC mais a importação. Resultado: 158
  tentativas, 2042 respostas, 1579 notas, 92 exceções; segunda rodada não grava
  nada.
- Pelo app (com a prova em `SCHEDULED`): a correção mostra 155/155/153
  dissertativas pendentes e as objetivas corrigidas; a tentativa mostra os
  horários do Moodle e a exceção. Com a prova em `DRAFT`, tudo aparece como "In
  progress"/"No answers": em prod a prova precisa sair de `DRAFT`.
- `report.md`: q5, q7 a q12 iguais ao Moodle. Diferenças:
  - q4: 20 alunos sobem para 1,00. 5 ficam com 0 contra 0,25 a 0,75 no
    Moodle: as ordens deles não compilam ou falham na execução (testado no
    SWI-Prolog, arquivos em `tmp/moodle-prolog/q4/`). Decidido: vale 0.
  - q13: com `partial`, o mdq dá nota maior ou igual à do Moodle para todos.
  - q6: 4 alunos com "brasília" acentuado ganham 1,00 (Moodle deu 0,75).
- Os 17 alunos do Moodle sem conta casada pela matrícula (todos fizeram a
  prova inteira, com notas perto da mediana):
  - 9 já tinham conta ativa no curso com a matrícula errada no perfil ("UnB",
    "1", "mat054", dois erros de digitação...). Casados pelo nome ou e-mail;
    o plano corrige a matrícula (`SCHOOL_ID_FIXES` em `build-plan.mjs`,
    `schoolIdFixes` no plano). O script recusa se a matrícula atual não for a
    esperada.
  - 8 ganham conta nova com `--create-missing`: usuário `nome-sobrenome`,
    e-mail `<matrícula>@aluno.unb.br`, `githubId` vazio (`!<username>`, o
    aluno preenche no perfil, onde é obrigatório) e senha aleatória
    descartada. O professor redefine em sala:
    `codehood-manage reset-password <usuário>`. Lista no `report.md`.
  - Com isso, os 175 alunos do Moodle entram: 2262 respostas, 1748 notas, 102
    exceções.
- 1 aluno respondeu 4.5 na q9 (domínio inteiro): importado com nota 0, como a
  tela de revisão trata uma resposta malformada.

### Passos para prod

1. Implementar os pesos (seção 2), se forem antes.
2. `ansible-playbook deploy/backup.yml` e gerar o plano a partir dessa cópia
   (`build-plan.mjs --db <cópia> --create-missing`); conferir o `report.md`.
3. Copiar `plan.json` e o script para a VPS; rodar como o usuário `codehood`
   com o banco `/var/lib/codehood/codehood.db`, primeiro sem `--apply`.
4. Passar a `prova-1` para `SCHEDULED` (`PATCH /api/course/paradigmas/chips_2026-2/exam/prova-1`).
5. Corrigir a q1 (`prolog-fatorial-com-is`) com o chalk. Precisa de um
   release com `Feedback.notes` e as chaves `BOT` (spec
   `runner-de-correcao`) e de uma chave `BOT` `runner` criada em `/profile`.
   Do curso: `CODEHOOD_BOT_KEY=... chalk codehood autograde --exam prova-1
   --dry-run`, depois sem `--dry-run`. Grader em
   `graders/logico/aritmetica/fatorial-com-is/` (`all-or-nothing`,
   `on_build_error: manual`). Na cópia de prod com a importação
   (2026-11-06): 134 com 1, 8 com 0 (todas calculam `F is N * F1` antes da
   recursão), 30 para correção manual (código com texto em volta, erro de
   sintaxe, CLPFD sem alterar).

## 2. Pesos por questão (funcionalidade nova)

No Moodle, q1 a q3 valem 3, q4 vale 2 e as outras 1 (total 20). O Codehood não
tem peso: `exam-result` faz a média simples, e o `push/wire.py` do CLI descarta
o campo `weight` da questão. O professor escolheu implementar o peso antes de
liberar as notas.

Pontos de partida:

- Desenhar com a skill `new-feature`. É mudança de schema; em dev,
  `prisma db push`; a migração sai no `pnpm run release`.
- O peso é da questão dentro da prova, não da questão:
  `QuestionsForExam` (`examId`, `questionRefId`, `version`, `position`) é o
  lugar natural. O `aprender` já gera `weight:` no frontmatter das questões
  convertidas do Moodle.
- Entrada: `examQuestionInput` em `src/core/schemas/exam.ts` (hoje `slug` e
  `version`). Cálculo: `src/services/exam-result.ts`. Verificar também a
  coluna de notas e a tela de resultado do aluno.
- A prova é montada pela REST até o CLI enviar provas (`cli/ROADMAP.md`,
  "Push new questions and exams"); o formato de `include` com peso no mdq
  deve ser conferido em `../mdq/docs/`.
