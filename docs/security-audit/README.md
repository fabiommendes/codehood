---
type: doc
status: active
tags: [security, audit, report]
relatedTo: [dev/specs/to-review/auth.md, src/auth/permissions/index.ts]
---

# Auditoria de segurança

Relatório: [`relatorio-auditoria-seguranca.pdf`](relatorio-auditoria-seguranca.pdf)
(25 páginas, A4, pt-BR). Revisão de 20/09/2026, commit `381f36c`.

## Regenerar

O ambiente é isolado e não toca no Node nem em nada global:

```bash
python3 -m venv docs/security-audit/.venv
docs/security-audit/.venv/bin/pip install reportlab matplotlib
docs/security-audit/.venv/bin/python docs/security-audit/generate_report.py
```

O `.venv/` está no `.gitignore`.

## Arquivos

| Arquivo               | Papel                                                                 |
| :-------------------- | :-------------------------------------------------------------------- |
| `findings.py`         | Achados, pontos fortes, recomendações. É aqui que uma reauditoria mexe. |
| `issues.py`           | Texto completo das issues do GitHub, uma por achado acionável.         |
| `accents.py`          | Acentuação da prosa em tempo de renderização (ver abaixo).             |
| `generate_report.py`  | Só apresentação: gráficos, paginação, estilo.                          |
| `charts/`             | PNGs gerados pelo matplotlib; recriados a cada execução.               |

Os dados são escritos em ASCII para que nenhuma chave de dicionário dependa de
acento, e a forma final em pt-BR é aplicada por `accents.py` — que nunca toca em
trecho de código, porque o código citado é inglês. Ao editar `findings.py` ou
`issues.py`, escreva sem acento e confira o resultado no PDF; palavra que faltar
entra no mapa de `accents.py`.

## Resumo dos achados

| ID  | Sev.        | Categoria             | Achado                                                        |
| :-- | :---------- | :-------------------- | :------------------------------------------------------------ |
| F1  | Alta        | XSS                   | XSS armazenado no roster via `set:html={JSON.stringify(...)}`  |
| F2  | Alta        | Permissão no cliente  | `PATCH /api/user/me` troca a senha sem exigir a atual          |
| F3  | Alta        | IDOR                  | Convite de turma não valida a posse do curso                   |
| F4  | Alta        | Chaves e defaults     | Contas padrão `admin/admin` criadas em runtime                 |
| F5  | Média       | Isolamento            | Roster completo devolvido a qualquer aluno do curso            |
| F6  | Média       | IDOR                  | `createdBy` do convite vem do corpo da requisição              |
| F7  | Baixa       | XSS                   | `new MarkdownIt()` sem `html: false` explícito                 |
| F8  | Baixa       | XSS                   | Nome de arquivo da URL no `Content-Disposition` sem filtrar CR/LF |
| F9  | Baixa       | IDOR                  | `uploaderId` do anexo aceita outro usuário                     |
| F10 | Informativa | Isolamento            | Blobs servidos sem autenticação, por decisão de projeto        |
