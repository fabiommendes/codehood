---
type: issue
status: open
tags: [urls, ilhas, limpeza]
---

# Ilhas recebem o curso duas vezes

`ExamAttempt.tsx` e `ExamResults.tsx` recebem os segmentos `discipline` e
`course` (para as actions) e também `courseRef: CourseRef` (para os links).
`GradesTable.astro` separa `course.index()` para obter os segmentos que
`ReleaseGradeColumn` passa às actions.

Uma função em `src/urls/` que vá de `CourseRef` para os segmentos
(`{ discipline, course: "<username>_<edition>" }`) deixa as três receberem só
o `courseRef`.

Na mesma limpeza: `courseHref(ref)` sobrou apenas nos specs e2e e pode dar
lugar a `urls.course(ref).index()`.
