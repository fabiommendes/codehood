# Ponte REST em JSON-RPC

## Plano e decisões

Adicionar `rest.batch` autenticado, sem HTTP interno, reutilizando `route.view` do registro REST. A camada comum já valida entrada/saída, passa actor ao Service e serializa erros. A ponte apenas resolve caminhos e monta o contexto da operação. Não há transação global nem paralelismo: falha de um item não desfaz sucessos anteriores e não impede os seguintes.

Contrato: `params: {verb, requests: [{id, path, body?, query?}]}`. `verb` é maiúsculo, um de GET, POST, PUT, PATCH e DELETE. `id` é string ou número e não precisa ser único; resultados preservam posição e repetem o identificador. Retorno é uma lista de `{id,status,body}`. GET e DELETE usam `query` como objeto de strings ou listas de strings, com a mesma coerção do REST; outros verbos usam `body` JSON. Query embutida no caminho e campos incompatíveis com o verbo são recusados por item.

Caminhos absolutos locais sob `/api/`, sem origem, query, fragmento, barras duplicadas, segmentos ponto, controles ou escapes ambíguos. Resolução por segmento, estáticos antes de dinâmicos. Só rotas registradas entram, nunca páginas Astro avulsas. Login/logout e qualquer rota com `inMultipart` são recusados, mesmo as que também aceitam JSON. Saída é sempre JSON do wrapper REST; não há streaming, anexos ou recursão RPC.

Limites iniciais: 50 itens por ponte, 64 KiB UTF-8 por item serializado, 1 MiB do corpo HTTP `/rpc` contado durante leitura, 50 chamadas por batch JSON-RPC externo. Envelope inválido falha antes de executar; problemas de caminho, payload ou rota são resultados individuais. Os limites são independentes de Content-Length. Notificações e execução sequencial do batch JSON-RPC existente permanecem.

## Autenticação e origem

REST direto e RPC usam sessão OU Bearer. A presença simultânea do esquema Bearer e do cookie específico de sessão, inclusive vazio/inválido, produz HTTP 400 antes da validação das credenciais, da renovação da sessão e de qualquer handler. Cookies não relacionados não conflitam. O guard é central no middleware, também evitando precedência ambígua nas demais portas da aplicação.

Mutações REST e RPC com Origin explicitamente externo falham 403, mesmo em JSON, salvo Bearer validado. JSON sem Origin permanece aceito, pois não é um envio simples de formulário e depende de preflight no navegador. Formulários e corpos sem Content-Type continuam seguindo a proteção existente, exigindo origem local sem Bearer válido. A ponte não replica middleware: ele já protege o envelope e nenhuma operação pode substituir credenciais, cabeçalhos ou origem.

Erros internos das rotas são sanitizados no wrapper REST também em desenvolvimento; erros de domínio mantêm o serializador existente. A ponte não devolve exceções brutas.

## Exemplo

```json
{
  "jsonrpc": "2.0",
  "id": "read",
  "method": "rest.batch",
  "params": {
    "verb": "GET",
    "requests": [
      {"id": "me", "path": "/api/user/me"},
      {"id": "admins", "path": "/api/user", "query": {"usernames": ["admin"]}}
    ]
  }
}
```

O campo `result` contém a lista de resultados individuais. Falha de schema do
método usa erro JSON-RPC `-32602`, ausência de autenticação usa `-32001`.
Caminho inválido ou rota excluída gera item 400, rota ausente 404, verbo não
registrado para a rota 405 e payload excessivo 413. Os status de domínio são os
do REST. Envelope HTTP excessivo gera HTTP 413 e não executa operações.

O limite de payload é de entrada, não de resposta. O cliente deve continuar
usando os filtros do REST para limitar consultas. Um batch JSON-RPC externo
pode conter até 50 pontes com até 50 operações cada, limitado também pelo MiB
do envelope. IDs repetidos não são deduplicados; reenvio pode repetir efeitos.

## Verificação

Testes HTTP reais: paridade REST/ponte, sessão e Bearer isolados, conflito antes da validação, cookies alheios, origem externa e formulários, ordem, sucesso parcial, verbos, coerção de query, schemas, limites, rotas bloqueadas e continuidade do batch JSON-RPC. Sem alteração de banco, migrations, seeds ou UI. Os dados existentes de bootstrap são suficientes, pois não há novo estado visual.

Validação executada: 313 testes do conjunto REST/RPC/auth/actions relacionados
passaram; Biome global e `pnpm run lint` completos passaram, incluindo typecheck
e 3.314 arquivos na checagem Astro. A tentativa da suíte completa de 2.997 testes
foi interrompida pelo limite de 600 segundos da ferramenta, sem resultado final.
O teste de salvamento confirmado entre abas em `exam-code-answer.spec.ts` teve
um timeout nessa tentativa e passou em repetição isolada. Não há afirmação de
aprovação da suíte inteira.
