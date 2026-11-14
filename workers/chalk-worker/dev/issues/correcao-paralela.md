---
type: issue
status: done
tags: [performance, grading, cache]
kind: enhancement
priority: medium
created: 2026-11-13
creator: claude
---

# Correção em paralelo dentro de um worker

## Problema

O worker corrige um envio por vez. O laço de `Loop.run` reserva até `--batch`
envios e os processa em sequência (`chalk_worker/loop.py`). Na `teste2-elm`
(2026-11-13), cada envio levou cerca de 6 s, quase todo em `elm make` num só
núcleo, e a máquina ficou ociosa. Foram 77 envios em ~10 min.

Para paralelizar, hoje é preciso subir vários processos, cada um com o seu
`--cache-dir`. Dois processos no mesmo cache disputam o projeto: o `prepare`
de uma questão apaga e recria o template (`_write_template`,
`chalk_worker/grading.py`, `shutil.rmtree`) enquanto outro worker pode estar
corrigindo com ele, e o cache de pacotes do Elm (`<cache>/cache`) é escrito
sem trava.

## Proposta

- Opção `--jobs N` (padrão: número de núcleos, `os.process_cpu_count()`).
  `--jobs 1` mantém o comportamento atual.
- Um processo principal reserva os envios, renova as reservas e fala com o
  servidor. Os envios vão para um pool de N processos
  (`multiprocessing`/`concurrent.futures.ProcessPoolExecutor`) que só
  corrigem e devolvem o `RunnerReport`.
- Isolamento automático dos caches: cada processo do pool usa o próprio
  diretório de trabalho (`<cache>/slot-<i>/`), sem o professor configurar
  nada. O cache de pacotes do Elm pode ser compartilhado se for preenchido uma
  vez só, antes de abrir o pool. Se não der, cada slot fica com o seu.
- O `prepare` de cada questão (template + solução de referência) acontece uma
  vez por questão. Os slots copiam o template pronto, ou o `prepare` roda sob
  uma trava (`fcntl.flock`) por questão.
- Uma trava no diretório de cache também impede que dois processos
  `chalk-worker` independentes usem o mesmo `--cache-dir` sem saber.
- O `--batch` passa a ter padrão `N` (ou `2N`), para manter o pool ocupado sem
  reservar envios demais.
- `SIGINT`/`SIGTERM` continuam terminando os envios em andamento e devolvendo
  os outros para a fila.

## Critérios de aceitação

- [x] `chalk-worker --exam X` usa todos os núcleos sem configuração extra.
- [ ] Com `--jobs 4`, uma fila de 40 envios termina em cerca de ¼ do tempo de
  `--jobs 1`. (Medido só no `QuestionGrader`, sem servidor: 8 correções Elm
  em 49 s em sequência e 7,7 s com 8 threads, mesmos resultados. Falta medir
  numa fila real.)
- [x] Dois processos `chalk-worker` com o mesmo `--cache-dir` não corrompem o
  cache: o segundo falha com uma mensagem clara.
- [x] Ctrl+C com o pool cheio termina os envios em andamento e devolve os
  reservados que ainda não começaram. (Nenhum fica reservado sem começar: o
  laço só reserva o número de slots livres.)
- [x] Testes cobrem a trava do cache e o pool com `--jobs 2`.

## Como ficou

- Threads (`ThreadPoolExecutor`), não processos: a correção roda em
  subprocessos (`elm make`, `elm-test`, bwrap), então o GIL não limita. Cada
  `grade` do `chalk-grader` usa um diretório temporário próprio e o cache de
  pacotes já é preenchido sob `flock`, então um `QuestionGrader` preparado
  corrige várias respostas ao mesmo tempo, sem slots nem cópias do template.
- O `prepare` de cada questão roda sob uma trava por questão; os outros
  envios da questão esperam (fase `waiting` na TUI).
- A reserva é renovada desde o início do envio, inclusive durante o
  `prepare`, que antes rodava sem renovação.
- Estado em `chalk_worker/status.py`, lido pela TUI (`chalk_worker/tui.py`,
  Textual) a cada 0,25 s; `p` pausa as reservas, `q` para.
- Memória (2026-11-14): cada envio conta `--memory` na admissão por
  `MemAvailable` (menos `--memory-reserve`). Com o `chalk-grader` 0.3, cada
  execução roda num cgroup próprio com `memory.max` = `--memory` (o worker se
  reexecuta sob `systemd-run --user --scope -p Delegate=yes`); o paliativo
  `profile_overrides` saiu. Ver a fase 4 do RFC
  `dev/rfc/limites-de-memoria-e-processos-por-correcao.md` do chalk.
