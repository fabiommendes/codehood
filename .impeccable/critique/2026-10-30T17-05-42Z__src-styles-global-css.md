---
target: dark theme in the website
total_score: 23
max_score: 36
na_heuristics: 10
p0_count: 1
p1_count: 3
target_identity: "file:/home/chips/git/codehood/codehood/src/styles/global.css"
target_fingerprint: "sha256:db430781fffc5197a386d904454fcb0fd592792bccf1616f03edd0f18adeab06"
target_path: /home/chips/git/codehood/codehood/src/styles/global.css
timestamp: 2026-10-30T17-05-42Z
slug: src-styles-global-css
closed: true
---
# Crítica: tema escuro (codehood-dark)

Method: dual-agent (A: design review, B: detector + browser)

## Heurísticas (23/36, n/a: 10)
1 Visibilidade 2 (alternativa marcada 1.81:1 na revisão) | 2 Mundo real 3 (laranja marca "Open now") | 3 Controle 2 (toggle fixa o tema para sempre) | 4 Consistência 2 ("Open now" verde/laranja, código GitHub dark) | 5 Prevenção 2 (15 botões vermelhos sólidos em admin/users) | 6 Reconhecimento 3 | 7 Flexibilidade 3 | 8 Estética 3 (login/check-in barulhentos) | 9 Recuperação 3 | 10 Ajuda n/a

## Especificidade
Autoral (paleta floresta noturna, logo com blend screen, tiles e cenas noturnas). Bordas genéricas: shiki GitHub dark (src/utils/highlight-code.ts:20), controles DaisyUI crus, tokens de docs/ui/identity.md (muted, foco info) não implementados. Detector: overused-font Layout.astro:40, bounce-easing AttendanceResult.astro:149; themes.astro e repeating-stripes-gradient são falsos positivos.

## Problemas prioritários
- [P0] Alternativa escolhida invisível na revisão (radio/checkbox disabled 1.81:1). Fix em mdq-js daisyui.css:93-98: opacity 1 + border-primary e ✓ na escolhida.
- [P1] Bordas de campo 1.79:1 (input), 1.24:1 (.mdq-choice). Token field-border >= 3:1 (~#5f8a78).
- [P1] Texto secundário /50 4.19:1, /40 3.22:1 (28 lugares; AppSidebar.astro:109, calendar.astro:341). Token muted #8fb3a4.
- [P1] Foco: sidebar a.cut outline none 1.07:1; resto outline padrão 1px. :focus-visible 2px info.
- [P2] Semântica de cor: warning para "Open now"/regrade/admin (exam-display.ts:37), feedback em blocos sólidos, botões vermelhos text-white ~3:1 (UsersTable.tsx:160).

## Personas
Sam: B1, inputs < 3:1, foco sidebar, ThemeToggle sem aria-pressed. Casey: check-in 390 input 1.79:1 sobre mural; sem meta theme-color. Alex: tabela de notas sem hierarquia, base-100/200 1.19:1, coluna cortada em 1440.

## Menores
Ícone do toggle mostra estado; sem listener matchMedia; .bg-confetti some no escuro; --lp-pixel 1.61:1; badge "teaching" 10px; h1->h3 em /admin/users.

## Perguntas
Check-in é a tela mais barulhenta? Quantas "luzes" por tela? Código GitHub ou terminal Forest?
