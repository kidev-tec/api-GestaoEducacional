# Modelagem, migração e retenção

- Separar identificadores técnicos, dados de domínio e PII; definir proprietário de cada campo.
- Soft-delete só onde justificado; obrigações legais/financeiras podem impedir eliminação integral, exigindo retenção minimizada.
- Schema migrations: expand/contract, compatibilidade entre versões, dry-run, checksum, backup/restore e rollback documentado.
- Importador do cliente: somente exportação legítima, mapeamento, validação, prévia, relatório de erros, idempotência, deduplicação e reconciliação final.
- Nunca importar dados de alunos reais para testes. Criar geradores sintéticos.
- Dados de relatório: políticas de acesso multi-tenant em materializações, caches, busca e exportações.
- RPO/RTO são decisões de produto e contrato; não prometer números sem testes.
