---
target: home page do professor
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/home/chips/git/codehood/codehood/src/pages/home.astro"
target_fingerprint: "sha256:c96c42dd0f7b5837dcdddcdeef4b940f4641a7386068e5527aa32d158786c2fa"
target_path: /home/chips/git/codehood/codehood/src/pages/home.astro
timestamp: 2026-10-30T23-38-45Z
slug: src-pages-home-astro
---
# Crítica: home do docente (src/pages/home.astro)

Method: dual-agent (A: design review · B: detector + browser)

## Heurísticas (20/40)
1 Status 2 (In progress lista prova futura; started oculto) | 2 Mundo real 2 (segunda chamada vira "1 of 10 submitted") | 3 Controle 3 | 4 Consistência 2 (Upcoming vs In progress) | 5 Prevenção 2 (duas cs101 iguais) | 6 Reconhecimento 2 (edição) | 7 Flexibilidade 1 | 8 Estética 3 | 9 Erros 2 (Problems sem arquivo/comando) | 10 Ajuda 1

## Especificidade
Acabamento da marca, estrutura genérica (5 blocos h2 + cards). Detector CLI limpo; overlay: cream (marca), stripes (falso positivo, .diff), kicker real em home.astro:52. AA ok em tudo (mín 5.22).

## Problemas prioritários
- [P1] isPersonallyOpen (src/services/instructor-home.ts:174-181) aceita upcoming: prova futura com exceção aparece In progress; segunda chamada mostra "1 of 10 submitted". Fix: só open agora; rótulo "Segunda chamada: N aluno(s)".
- [P1] HomeCourse sem edição (src/utils/load-instructor-home.ts:44): duas cs101 iguais. Fix: "cs101 · 2026-2" quando houver mais de uma edição.
- [P1] Home do docente sem sala de aula: Today/next vêm de loadStudentHome; estado vazio mente (home.astro:320); sem Abrir chamada nem reports. Fix: today/next/reports em loadInstructorHome.
- [P2] Sem hierarquia: contagem como texto comum, urgência em cinza, cards de ~90px. Fix: contagem no h2, número mono à direita, linhas compactas.
- [P2] started e oldest calculados e descartados.

## Personas
Alex: To grade não vai à próxima resposta; sem liberar na home; baixa densidade. Sam: data só em title; borda do card ~1.05:1; sidebar após main na tab. Docente técnico: sem estado do push; Problems sem arquivo/comando; sem "o que mudou".

## Menores
Kicker YOUR TERM + h1 Home vazios; papéis docente/aluno intercalados sem rótulo; classe de card repetida (home.astro:181,215,241,268); data absoluta quebra 3 linhas no mobile; "Em andamento" ambíguo.

## Perguntas
Fila única por urgência? Por que a home não mostra a aula? O que a web dá que `codehood status` não dá?
