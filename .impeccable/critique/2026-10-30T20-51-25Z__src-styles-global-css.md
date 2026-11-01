---
target: dark theme in the website
total_score: 25
max_score: 36
na_heuristics: 10
p0_count: 0
p1_count: 2
target_identity: "file:/home/chips/git/codehood/codehood/src/styles/global.css"
target_fingerprint: "sha256:69606582cc1e6d3454fef198d0fb15f4504741badedc25a2a752a537be782ef2"
target_path: /home/chips/git/codehood/codehood/src/styles/global.css
timestamp: 2026-10-30T20-51-25Z
slug: src-styles-global-css
closed: true
---
# Crítica: tema escuro (codehood-dark), 2ª rodada

Method: dual-agent (A: design review · B: detector + browser)

## Heurísticas (25/36, n/a: 10)
1 Visibilidade 3 (linha "Open" sem badge/CTA) | 2 Mundo real 3 (ipês celebram nota 0%) | 3 Controle 3 (toggle não volta a "sistema") | 4 Consistência 2 (Drop vermelho no roster vs ghost em admin/users; caixa de cabeçalho varia) | 5 Prevenção 3 (check-in sem dica de formato) | 6 Reconhecimento 3 (célula vazia sem explicação) | 7 Flexibilidade 2 (notas sem sort/filtro/total) | 8 Estética 3 (mural de tiles no login/check-in) | 9 Recuperação 3 | 10 Ajuda n/a

## Especificidade
Autoral (Forest, Fraunces, cortes, ipês, tiles, código na paleta). Telas de trabalho seguem genéricas (cards DaisyUI iguais, 1.09:1 contra a página). Detector: 5 achados, 3 falsos positivos em design/themes.astro; bounce-easing AttendanceResult.astro:149; overused-font Layout.astro:40 (marca). Overlay: undersized-ui-text badge "teaching" 10px AppSidebar.astro:126; repeating-stripes falso positivo (seta do select).

## Corrigido desde a 1ª rodada
Alternativa escolhida, bordas de campo 3.62:1, muted 6.15:1, foco 2px info 7.63:1, "Open now" verde, botões de erro 5.55:1, shiki na paleta Forest.

## Problemas prioritários
- [P1] ThemeToggle.astro:64-73: fixa localStorage para sempre, sem listener matchMedia, sem aria-pressed, sem meta theme-color. Fix: tri-estado claro/escuro/sistema, listener, 2 metas theme-color com media.
- [P1] calendar.astro:371-373 dias passados 2.79:1 (/70 + opacity-50); rascunhos com opacity 40-60; rótulos 10px. Fix: text-muted sem opacidade; rascunho com borda tracejada/rótulo.
- [P2] mdq.css:275-281 numeric box desabilitado na revisão ~1.2:1 fora de .mdq-blank. Fix: estender a regra border-field-border ao .mdq-numeric-box em review.
- [P2] ReleasedScore.astro:22-31 ipês e fita em qualquer nota. Fix: celebrar só acima de limiar.
- [P2] Layout.astro:35-40 fontes do Google: terceiro em instância auto-hospedada, fallback Arial no lugar da Atkinson. Fix: woff2 em public/fonts.

## Personas
Sam: dias passados 2.79:1, rótulos 10px, sidebar por último na ordem de tab sem skip link, "seu" vs "correto" só pelo ponto do radio. Casey: check-in sobre mural saturado, sem dica nem autofocus, barra do navegador clara. Alex: notas sem sort/total, ~50 sublinhados, "Add exception" primário.

## Menores
Drop vermelho no roster; abas do curso com scrollbar nativa no mobile; field-border 2.93:1 sobre base-300; .bg-confetti morto (global.css:226); bounce-easing no check-in; badge teaching 10px.

## Perguntas
Por que um clique trava o tema? Nota liberada deve celebrar antes de saber se passou? Um único card para exames, eventos e resultados carrega papéis demais?
