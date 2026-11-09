# Release runbook — checklist

1. Card/release scope congelado; evidências e ACEITE definidos.
2. CI, testes de smoke, migrações e segurança PASS; falhas críticas BLOCK.
3. Snapshot/backup validado e restore ensaiado na janela definida.
4. Plano de compatibilidade e rollback (dados e código) revisado.
5. Feature flags e entitlements testados com múltiplos tenants sintéticos.
6. Dashboards e alertas prontos, responsável de on-call identificado.
7. Plano de comunicação e suporte aos clientes do piloto.
8. Aprovação humana e controle de mudanças registrados.
9. Rollout gradual com monitoração de SLIs e rollback por limiar.
10. Pós-release: reconciliação, observações, incidentes e lições.

Este arquivo é um modelo, não uma autorização para executar produção.
