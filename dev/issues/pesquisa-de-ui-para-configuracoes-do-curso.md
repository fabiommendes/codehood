---
type: issue
status: todo
tags: [course, settings, ui, navigation, instructor, research]
kind: enhancement
priority: medium
created: 2026-11-14
creator: claude
---

# Pesquisa de UI para as configurações do curso

## Problema

A página `<curso>/settings` (`src/pages/[discipline]/[course]/settings.astro`)
funciona, mas é caótica: os dados do curso (só leitura) e os comandos da CLI
estão empilhados numa página só, sem uma hierarquia clara. A passphrase, o
link de convite e a lista de convites voltaram para a turma
(`src/components/EnrollDialog.astro`, commit `4af164d`). Não há navegação
entre grupos de configuração, as seções não têm limites bem definidos e configurações de
naturezas diferentes (o que o curso é, quem entra nele, como sincronizar)
dividem o mesmo espaço.

Descrição e datas não são editáveis pela web até a CLI mandar `If-Match`.

Conforme mais opções chegarem (edição de dados quando o sync bidirecional
fechar, clone tokens, calendar feed, encerrar o curso), a página só piora.

## O que fazer

Antes de redesenhar, pesquisar como produtos de escopo parecido organizam as
configurações:

- Moodle: administração do curso, inscrição (métodos de matrícula), grupos.
- GitHub: settings do repositório e da organização (sidebar de seções,
  páginas separadas, "Danger zone", colaboradores e convites).
- Outros candidatos: GitHub Classroom, Canvas, Google Classroom, GitLab.

Para cada um, registrar:

1. Como as configurações são divididas em páginas e seções.
2. Como se navega entre elas (sidebar, abas, índice).
3. Como separam leitura e edição, e ações destrutivas.
4. Onde ficam convites e métodos de inscrição.
5. O que se aplica ao Codehood, que já tem o card do curso na sidebar
   (`src/components/nav/CourseCard.astro`, `src/utils/course-nav.ts`) como
   navegação contextual.

O resultado é um RFC em `dev/rfc/` com a proposta de estrutura (páginas,
navegação, agrupamento) e protótipos em
`src/pages/design/playground/configuracoes-do-curso/`, seguindo a seção
"Design playground" do `AGENTS.md`.

## Fora do escopo

Mudar a página atual antes da pesquisa: ela fica como está até lá.
