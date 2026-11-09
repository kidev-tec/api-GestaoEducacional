# Papéis do time agente e responsabilidade humana

| Papel | Faz | Não pode certificar sozinho |
|---|---|---|
| Orchestrator | escolhe card, dependências, handoffs, riscos | liberar prod, aceitar card crítico |
| Research REA | observa jornada autorizada e evidências | permissão para invasão, código proprietário |
| Product | requisitos, KPIs, personas, aceites propostos | promessa comercial sem validação |
| UX/Brand | fluxos, tokens, acessibilidade | clonagem visual ou aprovação jurídica de marca |
| Architect | domínios, ADRs, limites de stack | adoção irreversível sem revisão |
| Backend | APIs, casos de uso, eventos e authz | aceitar a própria segurança |
| Frontend | UI original e testes de interação | garantir autorização server-side |
| Data/Finance | ledger, migração, modelos, reconciliação | movimentação real sem autorização |
| QA | testes de fluxo/segurança/performance e evidências | afirmar ausência absoluta de defeitos |
| Security | threat model e controles | dispensar revisão externa quando necessária |
| DevOps | CI, observabilidade, deploy plans | ativar produção sem gate |
| Reviewer | revisão independente da implementação | aprovar cartão conflitado sem evidências |
| Humano Owner | escopo, financiamento, qualidade, go/no-go | — |

Separar agente que escreve de agente que revisa. Em equipe pequena, o humano assume revisão quando não houver segunda perspectiva independente.
