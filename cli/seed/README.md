---
type: doc
status: active
tags: [seed, cli, push, dev-server, course-repository]
relatedTo: [push, push-exams, bootstrap]
---

# Seed da CLI

`pyxel101/` é o repositório de um curso completo, "Introdução à Programação
com Python e Jogos", da `ada`: 16 semanas com notas de aula, exemplos,
slides, links, um banco de questões, provas, laboratórios com testes e um
`grades.py`. Ele foi escrito como um professor gostaria de dar o curso, não
em torno do que o Codehood já suporta. Por isso o push não sai limpo, e as
diferenças ficam registradas em [GAPS.md](GAPS.md).

O curso não tem alunos. Matrículas, entregas e notas ficam no seed normal do
servidor.

## Subir o curso

Com o banco semeado e o dev server no ar:

```bash
pnpm run db:reset        # se o banco ainda não tem a disciplina pyxel101
pnpm run dev
pnpm run db:seed:cli     # em outro terminal
```

O comando:

1. recria `tmp/pyxel101/` (na raiz do servidor, ignorado pelo git) a partir
   de `cli/seed/pyxel101/`;
2. troca a edição do `codehood.toml` pela edição atual do seed e desloca as
   datas de `calendar.md` e `exams/` em semanas inteiras;
3. roda `ch push` na cópia, como `ada`.

Ele sai com 0 quando o push chega ao fim, mesmo com operações falhas, porque
essas falhas são as lacunas medidas. Sai com erro só quando o push aborta.

## Usar o `ch` à mão

`tmp/pyxel101/` é um lugar para exercitar a CLI: edite, rode `ch push`,
`ch push --dry-run`, `ch grades`. O seed cria para a `ada` uma chave fixa,
`dev-ada-cli`:

```bash
cd tmp/pyxel101
CODEHOOD_TOKEN=dev-ada-cli uv run --project ../../cli ch push
```

Também dá para fazer `ch login` com `ada`/`ada`.

A pasta é apagada e recriada a cada `pnpm run db:seed:cli`. Uma mudança que
deve ficar vai para `cli/seed/pyxel101/`.

## Arquivos

| Arquivo | Conteúdo |
| :-- | :-- |
| `pyxel101/` | O curso. |
| `pyxel101/solutions/` | Soluções de referência e testes ocultos dos labs. O push não lê esta pasta. |
| `GAPS.md` | Lacunas entre o que o curso pede e o que o push produz. Temporário. |
| `INVENTORY.md` | Lista de cada arquivo do curso, o que ele ensina e qual desejo exercita. |
| `tools/` | Geradores dos binários (PNG, PDF, `.pyxres`, HTML jogável). |

## Como o curso é escrito

- Material em pt-BR, inclusive títulos e nomes de arquivo com acento, onde
  fizer sentido para exercitar a regra de slugs. Comentários em pt-BR.
  Identificadores em português nas notas e questões das semanas 1 a 8
  (`tela`, `gotas`); em inglês nos laboratórios, nas classes (semana 9 em
  diante) e nas questões de código. Até a semana 6, nenhum material usa
  conceito ainda não dado (tuplas e dicionários só a partir da semana 8).
- Datas absolutas só em formato ISO, que o `db:seed:cli` desloca; no texto
  corrido, datas relativas.
- O material segue `cli/docs/design/mapping-local-filesystem.md` e, para
  provas, `cli/dev/specs/to-review/push-exams.md`, mesmo onde a CLI ainda não
  implementa (ex.: `.url` para LINK, `info.yaml`). Um desejo sem formato
  definido usa um formato mínimo e plausível, registrado no `GAPS.md` como
  "formato proposto, não decidido".

## Ementa

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

## Desejos

O curso cobre os desejos abaixo mesmo sem suporte no Codehood. Cada um
aparece como arquivo concreto (`INVENTORY.md`, coluna W) e como lacuna no
`GAPS.md` enquanto não for atendido.

- **W1.** Notas em MD com imagens embutidas.
- **W2.** Slides em PDF por aula.
- **W3.** Links externos.
- **W4.** Exemplo jogável no navegador (`pyxel app2html`).
- **W5.** Lab com starter, testes ocultos, entrega por git e autocorreção.
- **W6.** Quiz semanal de prática.
- **W7.** Provas agendadas, sorteio de um banco de questões, embaralhamento e
  gabarito liberado depois.
- **W8.** Questão de código autocorrigida.
- **W9.** Projeto final em grupo, com rubrica e banca agendada.
- **W10.** Agenda com feriado, cancelamento, reposição e atendimento.
- **W11.** Material liberado só depois da aula.
- **W12.** Nota com pesos, lab vindo do autograder e frequência mínima.
- **W13.** Avisos da disciplina.
- **W14.** Assets do jogo no starter.

## Binários

Para regenerar os binários, a partir de `cli/seed/`:

```bash
uv run --with pillow --with pyxel python tools/make_assets.py
uv run --with pyxel python tools/make_lab_assets.py
tools/make_html.sh
```
