# Disciplina com slug duplicado responde 500

Ao executar `POST /api/discipline` duas vezes com o mesmo slug, o Service lança
`FieldError`, que não herda de `BaseSerializableError`. O serializador trata o
conflito esperado como erro interno, devolvendo 500 em produção. A ponte
`rest.batch` reproduz o mesmo comportamento porque usa o wrapper REST.

Evidência: `test/rest-batch.spec.ts`, teste de verbos e sucesso parcial, cria
uma disciplina e repete o slug no mesmo lote. O teste também verifica que o
500 não expõe a exceção interna.

Revisar o mapeamento de erros de campo na fronteira REST sem expor conteúdo
interno e adicionar regressão específica para o status de conflito. A ponte
não muda o contrato de erros de domínio dos Services.
