# Baseline de segurança e privacidade

**Objetivo:** baseline verificável de segurança de aplicação, inspirado por OWASP ASVS 5.0.0, sem alegar certificação ou conformidade automática.

## P0 antes de qualquer dado real

1. Tenant isolation para API, banco, cache, filas, busca, storage, relatórios e exports.
2. Autenticação e gestão de sessões robustas, MFA para funções administrativas conforme risco.
3. RBAC/ABAC no backend, mínimo privilégio, separação de funções financeiras.
4. Segredos em vault/ambiente autorizado, nunca em Git ou evidências.
5. LGPD: inventário de finalidade/base legal/retencão, transparência e tratamento de titulares.
6. Transporte e armazenamento seguros, backup/restore testado, logs sem PII.
7. Rate limits, proteção contra injeção, validação de dados, upload/arquivo seguro.
8. Revisão de dependências/licenças e SAST/DAST apropriados à aplicação.
9. Testes automáticos de casos negativos, replay, acesso cross-tenant, concorrência e endpoints expostos.
10. Segurança de IA: prompt injection, escopo de ferramentas, saída explicável, human-in-the-loop para decisões sensíveis.

## Privacidade educacional

Dados de menores exigem cuidados proporcionais e fundamento legal adequado; não presumir que consentimento é sempre base legal suficiente. Definir com assessor jurídico papel de controlador/operador, contrato, direitos e retenção. Os fluxos precisam de minimização, restrição de visibilidade e possibilidade de auditoria.

## Fonte padrão

https://asvs.owasp.org/ — ASVS 5.0.0 (publicação 2025). Requisitos específicos devem ser mapeados por IDs oficiais em plano de verificação após arquitetura definida.

## Regra de falha

Falha P0/P1 de isolamento, autorização, segredo ou pagamento → BLOCKED, congelar release afetado e acionar análise humana.
