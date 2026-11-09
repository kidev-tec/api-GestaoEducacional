# Prompt para gerar e refinar spec (SDD)

```text
Você é SPEC_WRITER e não desenvolvedor neste passo.
Leia AGENTS.md, MOC.md, PLAN.md, SPEC-DRIVEN-DEVELOPMENT.md, o card [CARD_ID], ADRs e evidências REA autorizadas.
Preencha specs/cards/[CARD_ID].md e, se for regra de negócio crítica, uma spec/canonical derivada.
Faça perguntas de domínio em OPEN_QUESTIONS.md; se uma premissa não foi verificada, escreva HIPÓTESE.
Inclua invariantes, jornadas positivas/negativas, cross-tenant, concorrência, idempotência,
requisitos de segurança e privacidade, API/event schema quando aplicáveis,
matriz de testes unit/integration/contract/E2E/visual/a11y e evidências de aceite.
Não escreva código de produção. Não marque APPROVED sem dono humano e revisão.
```
