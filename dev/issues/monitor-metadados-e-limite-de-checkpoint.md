# Crescimento de metadados pode interromper persistência do histórico

## Estado

Encontrado em revisão independente da branch `input-monitor`. Ainda sem integração na aplicação. Não corrigido.

## Problema

`src/services/answer-edits/monitor.ts` mantém observações de entrada, IDs consumidos, recibos confirmados e IDs de sessões sem compactação. `exportCheckpoint()` inclui essas coleções mesmo depois do ACK. O limite de 2 MiB em `storage.ts` rejeita o registro completo, mas não limita a memória do monitor.

Uma sessão longa pode atingir esse limite com texto final pequeno e poucos edits pendentes. O coordenador degrada para recuperação de texto com aviso e deixa de enviar histórico, pois envio exige outbox principal durável. Não há truncamento silencioso, mas o histórico fica sem entrega.

## Reprodução contratual

Acumular observações/alterações, coletar e confirmar lotes repetidamente; exportar checkpoints. O texto confirmado substitui a base, mas as coleções de metadados continuam crescendo. Restaurar repetidamente também acrescenta sessões. Constatação por inspeção e revisão, não por teste de carga concluído.

## Decisão necessária

Definir limites de captura, semântica de identificadores e janela de idempotência antes de compactar. Descartar IDs arbitrários silenciosamente permite reutilização de observações; descartar recibos muda a aceitação de ACKs históricos; descartar sessões permite reutilização de origem. As garantias atuais não autorizam essas mudanças.

Uma representação mais compacta de observações consumidas reduz custo, mas não resolve crescimento ilimitado. A solução precisa de contrato explícito, regressões RED/GREEN e medição de uma tentativa longa. Preservar edição e resposta final válida ao atingir limites, comunicando a lacuna.
