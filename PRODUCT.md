# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Docente técnico** (usuário principal): ensina programação ou outro assunto
  técnico, no ensino superior, no técnico, em bootcamps ou em cursos livres.
  Já usa terminal, editor e git no dia a dia. Escreve questões, avaliações,
  calendário e materiais em arquivos locais e publica tudo com a CLI.
- **Estudante**: usa o Codehood como um LMS web comum. Consulta o calendário,
  faz avaliações, responde questões, vê as notas e pede revisão. A CLI é
  opcional para estudantes.
- **Admin**: mantém disciplinas, edições, usuários e relatórios da instância.

## Product Purpose

Permite que o docente gerencie a turma como um repositório Git: o material
fica em texto simples, versionado e sob controle do docente, e o servidor só
exibe o que recebeu. Sucesso significa que o docente prepara e atualiza a
turma sem passar por formulários web, e que o estudante encontra o que está
aberto, o que vem a seguir e o que já foi corrigido.

## Positioning

O conteúdo da turma vive no repositório do docente, não no banco do LMS. O
servidor nunca altera o conteúdo (não existe `codehood pull`): `codehood push`
publica, e o estudante vê a mudança na hora. Questões são arquivos
reutilizáveis entre avaliações e semestres.

## Operating Context

- Docente: editor de texto, terminal, git, `codehood init` e `codehood push`.
  A interface web do docente serve para acompanhar e corrigir (correção web,
  notas, frequência, relatórios), não para escrever o conteúdo.
- Estudante: navegador, inclusive no celular em sala (check-in
  de chamada por QR code ou código).
- Cada instituição ou docente hospeda a sua instância (tarball com Node, num
  servidor pequeno, atrás de um proxy HTTPS). Não existe SaaS central.

## Capabilities and Constraints

- Servidor Astro + SolidJS + DaisyUI, SQLite via Prisma. CLI em Python em
  `cli/`. Servidor e CLI se comunicam só pela API REST.
- Interface em pt-BR e en (`messages/`), com o idioma fixado por instância em
  `CODEHOOD_LOCALE` no build.
- Funcionalidades: turmas, questões (MDQ), avaliações com exceções por
  estudante, correção automática e web, pedidos de revisão, notas, chamada,
  calendário com feed, materiais e repositórios.
- Os termos do domínio estão em `GLOSSARY.md`.

## Brand Commitments

- Nome: Codehood.
- Já existem logo e identidade: `public/logo.svg`, as peças do logo em
  `src/components/brand/` e as páginas de referência em `src/pages/design/`.
- Voz: direta, para quem programa. Comandos aparecem como comandos
  (`codehood push`), sem jargão de marketing.

## Evidence on Hand

- Copy da landing em `messages/*/auth.json` (chaves `auth_home_*`).
- Imagens em `public/img/`.
- Não há depoimentos, clientes, números de uso ou preços. Não inventar nada
  disso.

## Product Principles

1. O docente é dono do conteúdo: texto simples, versionado, exportável.
2. Escrever acontece no editor; a web serve para consultar, responder e
   corrigir.
3. O estudante não precisa saber que existe uma CLI.
4. Uma instância pequena e auto-hospedada precisa bastar.

## Accessibility & Inclusion

WCAG 2.2 AA em todas as telas, inclusive as de estudante e as de uso no
celular.
