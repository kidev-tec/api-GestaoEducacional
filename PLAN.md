# PLAN — ERP Platform | Roadmap governado por specs (v0.2)

> Status: PLANEJADO. Este plano não atesta nenhum código executado, arquitetura aprovada nem teste passando.
> Produto inicial: escola. Plataforma extensível: educação primeiro; expansão multissetorial condicionada a validação de produto e ADRs.

## Contratos de arquitetura e design

Antes de qualquer implementação, consultar `ARCHITECTURE.md` e `DESIGN.md`. São documentos canônicos de entrada, ainda `DRAFT`, que apontam para os detalhes em `docs/ARCHITECTURE/` e `docs/BRAND/`. Mudanças estruturais exigem ADR e mudanças de UX exigem spec/telas, teste e revisão.

## Objetivo e restrições

Desenvolver **ERP SaaS original** com núcleo transversal (organizações/tenants, IAM, controles, contratos, cobrança de módulos, trilhas de auditoria e orquestração) e **vertical Educação** (captação, matrículas, contratos, pedagógico e financeiro). Inspiração de experiência operacional na F10/Hermes autorizados; arquitetura e interface independentes. Marca conceito: *a receita do sucesso*, como composição de processos, não estética de cozinha.

### Sequência de implementação — ordem de valor, não datas imaginárias

| Estágio | Entregáveis obrigatórios | Gate de saída |
|---|---|---|
| G0 Descoberta | autorização REA, ICP, mapa da escola, requisitos observados/inferidos, riscos, dicionário | autorização + escopo + evidências rastreáveis |
| G1 Especificações | MOC, RFC/ADRs, bounded contexts, contrato de API, personas, 3 specs canônicas e matriz de riscos | aprovação humana dos ADRs/contratos críticos |
| G2 Núcleo | CI, authn/authz, tenant isolation, audit, event/outbox, entitlements, design system | 100/100/100/100 no core crítico + segurança/revisão |
| G3 Fluxo escolar | prospect → matrícula → contrato → título financeiro → acompanhamento | 100% jornadas P0 cobertas por E2E em CI; integração e rollback |
| G4 Piloto | carga sintética, migração ensaiada, treinamento, métricas e monitoramento | aprovação humana; critérios de saída do piloto |
| G5 Escala | catálogo de módulos, billing, hardening, extensões e integrações | contratos versionados; telemetria e SLIs aferidos |
| G6 Multi-indústria | protótipo segundo vertical com tenant isolado e core sem dependência educacional | ADR e caso comercial aprovados, sem retrabalho disruptivo |

## Lanes concorrentes permitidas

1. Produto/UX (especificações e validações).
2. Domínio/back-end (isolamento, autorização, core e módulos).
3. Front-end/design system (Storybook e contratos).
4. Qualidade/segurança (testes adversariais independentes, CI e ameaças).
5. DevOps e documentação (ambientes e evidências).

Não paralelizar escrita nos mesmos arquivos/domínios; agentes escritores usam branches/PRs distintos.

## Backlog e encadeamento

Fonte de verdade de escopo: `backlog/CARDS-DADOS.json` e `cards/<ID>.md`. Cada card terá uma `specs/cards/<ID>.md` *DRAFT* até ser refinada. Nem as 123 specs geradas nem os critérios preliminares são afirmações de comportamento verificado.

## Políticas de release

- Sem spec aprovada → sem implementação de regra crítica.
- Sem teste RED → não iniciar lógica crítica, salvo spike explícito com descarte.
- Sem integração e E2E nos fluxos P0 → não liberar piloto.
- Sem CI e revisão independente → não mergear.
- Sem aprovação humana → nunca mexer em produção, dados reais, dados financeiros ou migrations destrutivas.

## Decisões ainda abertas

- Qual produto exatamente é o *Hermes*, versão e titular de autorização.
- Stack/ORM, hospedagem, faixa de clientes e volume esperado.
- Segmento escolar inicial: cursos livres, educação regular, idiomas, técnico etc.
- Estratégia de pagamentos/fiscal e os países/estados abrangidos.
- Nome comercial e validação de trademark.

Todas as lacunas ficam em `state/OPEN_QUESTIONS.md` e devem impedir decisões irreversíveis.
