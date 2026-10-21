---
type: issue
status: todo
tags: [cli, enrollment, grades, csv]
relatedTo: [grade-column-service, enrollment-service]
---

# Importar e exportar turma e notas

No início do semestre o professor tem a lista de alunos do sistema acadêmico
(SIGAA, no caso da UnB) e no fim precisa lançar a pauta lá.

Ideia: comandos na CLI para importar a turma de um CSV (matrícula, nome,
e-mail), gerando convites pessoais para quem não tem conta, e exportar as
notas em CSV no formato que o sistema acadêmico aceita. A exportação usa as
colunas de nota que já existem.

A decidir: formatos suportados (um CSV genérico com mapeamento de colunas
basta?) e se a importação fica na CLI ou também na web.
