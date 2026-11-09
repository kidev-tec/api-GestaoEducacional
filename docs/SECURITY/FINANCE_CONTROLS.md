# Regras de controle financeiro

- Ledger/subledger orientados a lançamentos que não são silenciosamente apagados; correções por contrapartida ou ajuste documentado.
- Cobrança e liquidação devem ter estados distintos, reconcile com gateway, idempotência por comando e webhook.
- Separação de função para cancelamento, estorno e alteração de conta bancária.
- Nenhuma movimentação financeira real por agente sem autorização humana específica e ambiente permitido.
- Testar falhas de gateway, timeout, duplicação, contestação, pagamentos parciais, atraso, multi-tenant, variações de timezone, arredondamento decimal e concurrency.
- Nunca usar float para valor monetário; usar decimal inteiro em unidade mínima ou tipo decimal, conforme contrato do domínio.
- Regras fiscais brasileiras variam; revisão com contador/jurídico antes de liberação comercial.
