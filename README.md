# ERP Platform — Agentic Development Kit | Enterprise

**Status: kit de documentação e automação governada, NÃO um ERP implementado.**

Plataforma SaaS modular, primeiro vertical Educação, expansível a outros setores mediante viabilidade e ADR. Conceito visual: *a receita do sucesso* (metáfora sofisticada para jornadas e combinações de capacidades, nunca design culinário). Inspiração de UX em fluxos familiares, produto original.

## Faça nesta ordem

1. Abra [`MOC.md`](MOC.md) para navegar, [`ARCHITECTURE.md`](ARCHITECTURE.md) para o contrato arquitetural, [`DESIGN.md`](DESIGN.md) para o contrato de UX/UI, e [`PLAN.md`](PLAN.md) para marcos.
2. Leia [`AGENTS.md`](AGENTS.md) + [`SPEC-DRIVEN-DEVELOPMENT.md`](SPEC-DRIVEN-DEVELOPMENT.md).
3. Leia [`docs/GOVERNANCE/QUALITY_GATES_100.md`](docs/GOVERNANCE/QUALITY_GATES_100.md) e [`docs/ARCHITECTURE/PLATFORM_STRATEGY.md`](docs/ARCHITECTURE/PLATFORM_STRATEGY.md).
4. Verifique `state/OPEN_QUESTIONS.md`, especifique card de discovery e refine `specs/cards/<ID>.md`.
5. Rode `python scripts/validate_kit.py` — testa DOCUMENTOS, não código da aplicação.
6. Aprovação humana das specs/ADRs antes de TDD/produção, e autorização REA antes de qualquer interação com Hermes/F10.

## Entregáveis

- **123 cards** de execução e **123 specs DRAFT** vinculados ao backlog original.
- `ARCHITECTURE.md` e `DESIGN.md` na raiz como pontos de entrada canônicos, preservando ADRs, tokens e documentos especializados. O template `templates/FEATURE_DESIGN_TEMPLATE.md` descreve soluções técnicas por card.
- Docs canônicos de produto, brand, plataforma, specs, TDD, QA, QG-100, segurança, CI e operações.
- Exemplos de Vitest, Orval, Playwright, OpenAPI e workflow de CI. **São exemplos que ainda exigem app criada e dependências instaladas.**
- Modelos de ADR, PR e evidência de teste, roles de agentes, prompts operacionais, arquivos para Codex/Copilot/Cursor/Claude/Gemini.
- Script para validar consistência de documentação + índice completo.

**Não há testes E2E, cobertura 100/100/100/100 ou integração executados no ERP, porque o código não foi construído.** Não confundir política com cumprimento real.

## Controle de risco

Nenhum agente pode executar deploy em produção, usar dados reais de estudantes/financeiros, contornar controles de terceiros ou autorizar sua própria revisão. Merge de mudanças críticas, pagamentos reais, migrações destrutivas e intervenções em produção exigem dono humano.
