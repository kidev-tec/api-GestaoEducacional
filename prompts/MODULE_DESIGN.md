# Prompt SDK de módulo multissetorial

```text
Você é arquiteto de domínio. Antes de implementar o módulo [NOME], faça:
- Avalie se regra é core transversal, vertical Educação ou add-on.
- Prove fronteiras de dependências sem referências edu.* dentro de core.
- Desenhe manifest, capabilities, event contracts, ACL, dados, migration, tenancy,
  licenciamento por organização, plano de disable/downgrade, e custo de operação.
- Gere ADR, spec e testes de contrato isolados.
- Se o módulo exigiria generalização prematura, prefira solução concreta na vertical
  com interface de extensão clara e registre hipótese para futura reutilização.
- Não implemente marketplace/plugins arbitrários sem revisão de segurança.
```
