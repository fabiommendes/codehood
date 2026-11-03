---
type: spec
status: to-review
tags: [seed, cli, push, dev-data, gaps]
relatedTo: [codehood-cli, push, push-exams, bootstrap]
---

# Seed da CLI: curso `pyxel101` subido por `ch push`

## Contexto

O seed do servidor (`src/db/bootstrap.ts`) monta cursos direto pelos services e
nunca passa pela CLI. Não existe um curso realista mantido como repositório
local e subido com `ch push`. Esta spec cria um: "Introdução à Programação com
Python e Jogos", com a biblioteca Pyxel, ministrado pela `ada`. O curso é
escrito como o professor gostaria de dar, e não em torno do que o Codehood já
suporta. Assim, ele serve de vitrine da CLI e também de medida das lacunas do
Codehood. Cada material que o push não sobe, sobe errado ou ignora em silêncio
é uma lacuna. As lacunas ficam registradas em `cli/seed/GAPS.md` até virarem
issue ou spec. O curso só existe como repositório: alunos, entregas e notas
continuam no seed normal.

## Requisitos

### Seed inicial (servidor)

- **R1.** `ensureDemoCourses` cria a disciplina `pyxel101` ("Introdução à
  Programação com Python e Jogos"), sem curso. Criar disciplina é ação de
  admin, que a CLI não faz.
- **R2.** O seed cria para a `ada` uma API key `CLI` com token fixo
  `dev-ada-cli`, como já faz com `dev-student-calendar`. O token sai de uma
  constante exportada de `src/db/bootstrap.ts`. A senha continua `ada`/`ada`.
- **R3.** O seed padrão (`db:seed`, `db:reset`) não sobe o curso `pyxel101`.

### CLI

- **R4.** A CLI aceita o token pela variável `CODEHOOD_TOKEN`. Quando ela está
  definida, tem precedência sobre `~/.codehood/credentials.toml` para qualquer
  servidor, e o arquivo não é lido nem escrito.
- **R5.** O `ch push` lista os arquivos do repositório que não consumiu, junto
  dos excluídos, sem falhar por causa deles. "Não consumido" quer dizer um
  arquivo versionável (fora de `.codehood/`, `.git/` e de `.gitignore`) que
  nenhuma etapa do push leu. Exemplos: tudo em `exams/` enquanto a CLI não
  sobe provas, e arquivos soltos na raiz. `repositories/<slug>/` conta como
  consumido por inteiro.

### Comando `pnpm run db:seed:cli`

- **R6.** `package.json` ganha `db:seed:cli`, que roda `tsx scripts/seed-cli.ts`.
  O comando não roda o seed: ele assume um banco já semeado e o dev server no ar.
- **R7.** O script confere se o dev server responde em `http://localhost:4321`
  (com override por `--url`). Se não responder, sai com erro e uma mensagem
  dizendo para rodar `pnpm run dev`.
- **R8.** O script recria `tmp/pyxel101/` a partir de `cli/seed/pyxel101/`. A
  pasta é apagada antes; o aviso no README diz que ela é descartável. `tmp/`
  entra no `.gitignore`. A pasta fica visível no repositório de propósito,
  para um dev entrar nela e usar o `ch` à mão.
- **R9.** Na cópia, o script troca `[course] edition` pela edição live do seed
  e `[server] url` pela URL usada. Desloca todas as datas ISO (`YYYY-MM-DD` e
  datetimes) de `calendar.md` e dos arquivos de `exams/` pela diferença entre
  o início da edição live e `start` do `calendar.md` original, arredondada
  para semanas inteiras, o que preserva os dias da semana.
- **R10.** O script roda `uv run --project cli ch push` dentro de
  `tmp/pyxel101/`, com `CODEHOOD_TOKEN=dev-ada-cli`, e repassa a saída. Sai
  com 0 quando o push termina, mesmo com operações falhas, porque falhas são a
  medida esperada. Sai com erro só se o push abortar (erro de leitura do
  repositório, servidor fora, token recusado).
- **R11.** Rodar o comando duas vezes seguidas converge. No segundo push, só
  replaneja o que já falhava no primeiro. Uma divergência aqui é lacuna e vai
  para o `GAPS.md`.

### Curso `cli/seed/pyxel101/`

- **R12.** Material em pt-BR, inclusive títulos e nomes de arquivo com
  acento, onde fizer sentido para exercitar a regra de slugs. Comentários em
  pt-BR. Identificadores em português nas notas e questões das semanas 1 a 8
  (`tela`, `gotas`); em inglês nos laboratórios, nas classes (semana 9 em
  diante) e nas questões de código. Até a semana 6, nenhum material usa
  conceito ainda não dado (tuplas e dicionários só a partir da semana 8).
  Datas absolutas só em formato ISO, que o script desloca; no texto corrido,
  datas relativas.
- **R13.** `codehood.toml`: `discipline = "pyxel101"`, `instructor = "ada"`,
  uma `edition` qualquer (reescrita por R9), `[push] exclude` com pelo menos
  uma pasta de rascunhos e um glob `**`, e `[[grades.column]]`.
- **R14.** `README.md` com a descrição do curso, que vira a descrição no
  servidor, e uma segunda seção (critérios de avaliação, bibliografia).
- **R15.** `calendar.md` com 16 semanas, aula teórica na terça e laboratório
  na quinta (2h cada), atendimento como terceiro horário, um feriado e uma
  aula cancelada com reposição. Cada aula tem um texto curto e links para os
  recursos e repositórios dela, seguindo a ementa abaixo.
- **R16.** O material segue o formato de
  `cli/docs/design/mapping-local-filesystem.md` e, para provas,
  `cli/dev/specs/to-do/push-exams.md`, mesmo onde a CLI ainda não implementa
  (ex.: `.url` para LINK, `info.yaml`). Para desejos sem formato definido, o
  material usa um formato mínimo e plausível, registrado no `GAPS.md` como
  "formato proposto, não decidido".
- **R17.** Material obrigatório por tipo:
  - recursos `MD`: notas de aula por semana, com blocos de código, tabelas,
    front matter `title`/`description` e imagens relativas (`![](sprites.png)`);
  - recursos `CODE`: exemplos `.py` executáveis por semana;
  - recursos `FILE`: PNG (sprites, diagramas) e PDF de slides, pequenos mas
    válidos;
  - recursos `LINK`: arquivos `.url` (documentação do Pyxel, vídeos);
  - `info.yaml` em pelo menos uma pasta;
  - questões: os 7 tipos aceitos pelo servidor, organizados em subpastas por
    tema, cerca de 40 no total, algumas com slug acentuado;
  - provas: Prova 1, Prova 2, um quiz semanal de prática e uma prova de
    reposição, com `include:` e questões inline;
  - repositórios: um starter por laboratório (cerca de 8) e um template do
    projeto final. Pelo menos um com `.pyxres` (se o Pyxel conseguir gerar),
    PNG, script executável (`100755`), `.gitignore` aninhado com `!` e testes
    pytest;
  - `grades.py` com pesos (labs, provas, projeto) e um `grades.csv` só com o
    cabeçalho, porque o curso não tem alunos.
- **R18.** O material também cobre os desejos abaixo, mesmo sem suporte hoje.
  Cada um aparece como arquivo concreto e como lacuna no `GAPS.md`:
  - **W1.** Notas em MD com imagens embutidas.
  - **W2.** Slides em PDF por aula.
  - **W3.** Links externos.
  - **W4.** Exemplo jogável no navegador (`pyxel app2html`).
  - **W5.** Lab com starter, testes ocultos, entrega por git e autocorreção.
  - **W6.** Quiz semanal de prática.
  - **W7.** Provas agendadas, sorteio de um banco de questões,
    embaralhamento e gabarito liberado depois.
  - **W8.** Questão de código autocorrigida.
  - **W9.** Projeto final em grupo, com rubrica e banca agendada.
  - **W10.** Agenda com feriado, cancelamento, reposição e atendimento.
  - **W11.** Material liberado só depois da aula.
  - **W12.** Nota com pesos, lab vindo do autograder e frequência mínima.
  - **W13.** Avisos da disciplina.
  - **W14.** Assets do jogo no starter.
- **R19.** Os testes dos starters passam com a solução de referência, guardada
  fora do repositório publicado (em `cli/seed/pyxel101/solutions/`, que não é
  uma pasta que o push lê, por isso também aparece como não consumida). Com o
  starter, eles falham.

### Ementa

| Sem. | Tema | Pyxel | Lab |
| :-- | :-- | :-- | :-- |
| 1 | Ambiente, REPL, primeiro programa | abrir janela | `lab01-janela` |
| 2 | Variáveis, tipos, expressões | coordenadas, cores | `lab02-cores` |
| 3 | Condicionais | teclado (`btn`) | `lab03-controle` |
| 4 | Laços | padrões na tela | `lab04-padroes` |
| 5 | Funções | ciclo `update`/`draw` | `lab05-bola` |
| 6 | Listas | vários inimigos | `lab06-chuva` |
| 7 | Prova 1 | | |
| 8 | Dicionários e tuplas | estado do jogo | `lab08-estados` |
| 9 | Classes | `Player`, `Enemy` | `lab09-nave` |
| 10 | Colisão, geometria | AABB | (cont. lab09) |
| 11 | Sprites e tilemaps | `.pyxres` | `lab11-plataforma` |
| 12 | Som e música | `sound`/`music` | (cont. lab11) |
| 13 | Arquivos | recorde em disco | `projeto-final` |
| 14 | Projeto (game jam) | | |
| 15 | Prova 2 | | |
| 16 | Apresentação dos projetos | | |

### `cli/seed/GAPS.md`

- **R20.** Fica fora da pasta do curso, para não ser copiado nem pushado. É
  um documento temporário: uma tabela com `G<n>`, o desejo (`W<n>`), os
  arquivos que o exercitam, o comportamento esperado, o observado no último
  push e o estado (`aberta`, `virou issue <arquivo>`, `virou spec <arquivo>`).
  Uma lacuna sai do arquivo quando é resolvida, e o arquivo some quando
  esvaziar.
- **R21.** A lista inicial vem do primeiro push real (T6), não de suposição.

### Documentação

- **R22.** `cli/seed/README.md`: o que é o seed, como rodar
  (`pnpm run dev`, depois `pnpm run db:seed:cli`), como usar à mão
  (`cd tmp/pyxel101 && CODEHOOD_TOKEN=dev-ada-cli uv run --project ../../cli ch push`,
  ou `ch login` como `ada`/`ada`), e o aviso de que `tmp/pyxel101` é recriado.
- **R23.** `cli/tests/examples/README.md` aponta para o seed como o exemplo
  extenso. O `README.md` do servidor cita o comando na seção de dados de dev.

## Fora do escopo

- Fechar qualquer lacuna (push de provas, FILE, LINK, autocorreção...). Cada
  uma vira issue ou spec a partir do `GAPS.md`.
- Suíte automática que confere o servidor depois do push contra
  expectativas. Pode vir depois, quando o `GAPS.md` estabilizar.
- Interação de alunos (matrícula, entregas, notas) no `pyxel101`.
- Subir um servidor temporário próprio: o comando usa o dev server.

## Plano de ação

| T | O quê | Arquivos | R | Dep. | Modelo | Pronto quando |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| T1 | Disciplina `pyxel101` e API key fixa da `ada` | `src/db/bootstrap.ts` (+ `api-key.service.ts` só se precisar aceitar token dado, restrito a `SYSTEM`) | R1-R3 | -- | sonnet | `pnpm run db:reset` ok; `curl -H "Authorization: Bearer dev-ada-cli" .../api/...` autentica como `ada`; lint ok |
| T2 | `CODEHOOD_TOKEN` na CLI (TDD) | `cli/codehood/api/base.py`, testes em `cli/tests/` | R4 | -- | sonnet | teste novo falha antes e passa depois; `uv run pytest` e `mypy codehood` ok |
| T3 | `ch push` lista não consumidos (TDD) | `cli/codehood/push/`, `cli/codehood/cli/push.py`, testes | R5 | -- | sonnet | teste com repositório temporário contendo `exams/x.md` e arquivo solto na raiz; suíte da CLI verde |
| T4 | Esqueleto do curso: `codehood.toml`, `README.md`, `calendar.md` completo, inventário de slugs de recursos, questões, provas e repositórios | `cli/seed/pyxel101/` | R12-R16, ementa | -- | sonnet | `ch push --dry-run` na cópia lê o repositório sem erro de parsing |
| T5a | Recursos (MD, CODE, FILE, LINK, `info.yaml`) | `cli/seed/pyxel101/resources/` | R17, R18 | T4 | sonnet | todo link do `calendar.md` para `resources/` resolve; PNG e PDF abrem; `.py` roda com `python -m py_compile` |
| T5b | Questões e provas | `cli/seed/pyxel101/questions/`, `exams/` | R17, R18 | T4 | sonnet | toda questão passa no `mdq` (`ch show` ou `mdq.load`); `include:` aponta para slugs existentes |
| T5c | Repositórios, soluções e `grades.py` | `cli/seed/pyxel101/repositories/`, `solutions/`, `grades.py`, `grades.csv` | R17-R19 | T4 | sonnet | `pytest` de cada starter falha e passa com a solução; `ch grades` roda |
| T6 | Script `db:seed:cli` | `scripts/seed-cli.ts`, `package.json`, `.gitignore` | R6-R11 | T1-T3 (T4 para testar) | sonnet | com dev server no ar: sai 0, curso aparece em `/pyxel101/ada_<live>`; segunda execução só replaneja as falhas; sem server: erro claro |
| T7 | Primeiro push real e `GAPS.md` | `cli/seed/GAPS.md` | R11, R20, R21 | T5a-c, T6 | eu (coordenador) | cada falha e cada não consumido do relatório tem um `G<n>`; cada `W<n>` aparece em pelo menos uma lacuna ou está marcado como coberto |
| T8 | Documentação e changelog | `cli/seed/README.md`, `cli/tests/examples/README.md`, `README.md`, `CHANGELOG.md`, `cli/CHANGELOG.md` | R22, R23 | T7 | haiku | links conferidos; `pnpm run lint` ok |

T1, T2, T3 e T4 rodam em paralelo (sem arquivos em comum). T5a, T5b e T5c
rodam em paralelo depois de T4, porque o inventário de slugs de T4 é o
contrato entre eles.

## Critérios de aceite

- Saída do `pnpm run db:seed:cli` com o resumo do push e a lista de não
  consumidos.
- Screenshots do curso `pyxel101/ada_<live>` no dev server: página do curso,
  agenda, uma aula com recursos, um repositório.
- Saída da segunda execução, mostrando a convergência (ou a lacuna, se não
  convergir).
- `cli/seed/GAPS.md` preenchido a partir dessa saída.
- `pnpm run lint` e `uv run pytest` (em `cli/`) verdes.
