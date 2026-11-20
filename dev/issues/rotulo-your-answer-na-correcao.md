---
type: issue
status: backlog
tags: [grading, ui, mdq]
relatedTo: [questao-de-upload]
kind: enhancement
created: 2026-11-19
creator: claude
---

# Correção mostra "Your answer" para o instrutor

Na tela de correção (`exams/[slug]/grading/[question].astro`), o painel da
resposta do aluno tem o rótulo "Your answer", que vem dos componentes da
mdq-js fora do modo `answer` (`Upload.tsx`; `Code.tsx:120` usa o mesmo na
revisão). Para o instrutor o rótulo é falso: a resposta é do aluno.

## A fazer

- Uma prop de mensagem (ou de papel) nos componentes da `mdq/solid`, usada
  pela tela de correção para todos os tipos ("Resposta do aluno").
