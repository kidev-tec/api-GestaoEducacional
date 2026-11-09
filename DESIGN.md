# DESIGN.md — Contrato de produto, experiência e interface do ERP

> **Versão:** 0.1 · **Status:** DRAFT / conceito a validar · **Owner:** Product Design + responsável humano  
> **Abrangência:** design do ERP SaaS inteiro, primeira vertical Educação.  
> **Fonte canônica de tokens:** `docs/BRAND/DESIGN_TOKENS.json` e `docs/BRAND/tokens.css`.

## 1. Visão e papel deste arquivo

O objetivo é uma experiência **familiar no fluxo, original na expressão visual e superior na eficiência comprovada**, inspirada em critérios de qualidade enterprise, sem clonar telas, assets ou linguagem exclusiva de concorrentes.

Conceito de marca: **“A receita do sucesso”** — organização, pessoas, inteligência, crescimento e resultados. A metáfora aparece em conexões, etapas e composições de capacidade; **não** em elementos de cozinha, estética infantil ou gamificação gratuita. O nome comercial permanece indefinido.

Este documento é a **especificação transversal de UX e UI**. O [Brand Book](docs/BRAND/BRAND_BOOK.md) define identidade e tom; [princípios](docs/BRAND/DESIGN_PRINCIPLES.md) orientam decisões; [padrões de interação](docs/BRAND/INTERACTION_PATTERNS.md) detalham componentes; specs **APPROVED** definem comportamentos de tela de cada card. Se uma spec aprovada entrar em conflito com este documento **DRAFT**, não sobrescrever a spec: abrir revisão de design e registrar decisão.

## 2. Princípios não negociáveis

1. **Task-first:** usuários entram para completar um trabalho, não para descobrir módulos em um catálogo.
2. **Visibilidade do estado real:** sucesso confirmado, pendente, processando, falha e parcialmente concluído não são o mesmo estado.
3. **Consistência multissetorial:** componentes genéricos e shell comuns; terminologia e fluxos específicos por vertical.
4. **Acessível por padrão:** WCAG 2.2 AA como meta; navegação por teclado, leitor de tela, foco, contraste e zoom real testados.
5. **Densidade adequada:** ERP precisa suportar tabelas complexas e usuários intensivos sem esconder informações relevantes.
6. **Autonomia com controle:** automações e IA sempre explicáveis, com simulação, autorização, trilha e opção de desfazer/compensar quando possível.
7. **Direito ao erro:** rascunhos, validação, confirmação de impacto, prevenção de duplicidade e recuperação de falhas.
8. **Evidência em vez de estética isolada:** medir completion rate, tempo por tarefa, erros e satisfação por persona.

## 3. Públicos e tarefas prioritárias

| Persona | O que precisa fazer | Primeiro fluxo a desenhar |
|---|---|---|
| Secretaria | Localizar pessoa, cadastrar, matricular, emitir documentos | Buscar aluno → matrícula → confirmação |
| Comercial | Captar e converter leads com histórico claro | Lead → qualificação → proposta → matrícula |
| Financeiro | Ver títulos, recebimentos, inadimplência e reconciliação | Contrato → título → recebimento → baixa |
| Docente | Visualizar turmas, chamada e avaliações | Turma → frequência → registro |
| Direção | Priorizar exceções, acompanhar metas, identificar gargalos | Painel → indicador verificável → ação |
| Administrador | Gerir unidades, usuários, módulos e permissões | Equipe → permissões → auditoria |

**Regra:** um mesmo dado pode aparecer em várias jornadas, mas deve ter origem, freshness e política de acesso coerentes. Identificar usuários reais e validar sua linguagem antes de declarar qualquer wireframe final.

## 4. Arquitetura de informação e navegação

### 4.1 App Shell (desktop)

```text
┌──────────────────────────────────────────────────────────────────┐
│ Marca | Busca global | Unidade atual | Ajuda | Notificações | Perfil │
├──────────────────┬───────────────────────────────────────────────┤
│ Início            │ Breadcrumbs / nome da tarefa                │
│ Minha rotina      │ Contexto, status e próxima ação             │
│ Pessoas           │                                              │
│ Matrículas        │ Conteúdo principal + ações primárias         │
│ Comercial         │ (tabela, formulário, timeline, dashboard)    │
│ Acadêmico         │                                              │
│ Financeiro        │                                              │
│ Processos         │                                              │
│ Relatórios        │                                              │
│ Administração     │                                              │
└──────────────────┴───────────────────────────────────────────────┘
```

O menu é **filtrado pela função e pelo licenciamento**, mas a API valida as permissões independentemente. Os módulos podem aparecer dentro de grupos lógicos de tarefas; nunca tornar o organograma técnico a única forma de navegação.

### 4.2 Mobile / responsivo

- Menus e tabelas responsivos com equivalência de **capacidade essencial**, não mera compressão do desktop.
- Ações frequentes facilmente alcançáveis; tabelas densas podem usar cartões/resumo com acesso ao detalhe.
- Operações extensas (conciliação, auditoria, importação) podem exigir experiência desktop, com indicação explícita.
- Testar larguras representativas com conteúdo longo, PT-BR, zoom 200%, teclado e tecnologias assistivas; não definir breakpoints sem validar layouts.

### 4.3 Busca e command palette

Busca global com autorização contextual e resultados rotulados por tipo; atalhos documentados, nunca conflitantes com navegador/leitor de tela. Command palette é candidato à evolução, não requisito indiscriminado de MVP.

## 5. Fundamentos de design system

Os valores a seguir são **referências do kit, ainda não homologadas por contraste em todos os estados**.

| Papel semântico | Referência atual | Uso |
|---|---|---|
| Marca/confiança | Navy `#14243A` | Identidade e estrutura |
| Ação | Teal `#0F8E98` | Identidade; controles usam tokens `interactive` apropriados |
| Inteligência | Violet `#6254C7` | Insights, foco e sinalização moderada |
| Progresso | Green `#2A986E` | Progresso real, nunca apenas cor |
| Marcos | Gold `#C19B55` | Destaques raros, não indicadores universais |

- Usar tokens **semânticos** de tema claro/escuro para texto, superfícies, bordas, ação, foco, feedback e disabled.
- Escala de espaçamento inicial de 4 px; radii e tipografia definidos em `DESIGN_TOKENS.json`.
- Nenhuma cor hardcoded em componentes de produto sem token/justificativa explícita. Validação automática de contraste em estados reais.
- Tema dark/light devem preservar hierarquia e significado; não inverter cores arbitrariamente.
- Tipografia legível para dados financeiros, alinhamento tabular de números e formatos `pt-BR` quando apropriado.
- Estados semânticos sempre combinam **texto + ícone quando útil + cor**; nunca cor isolada.

## 6. Inventário de componentes do sistema

**Primitivos:** Button, Link, Input, Select, Checkbox, Radio, Switch, Dialog, Tooltip, Popover, Tabs, Toast, Badge, Skeleton, Progress, Alert, Card, Icon, Typography, Layout.  
**Compostos ERP:** AppShell, UnitSwitcher, GlobalSearch, Breadcrumbs, DataTable, ColumnPreferences, FilterBar, FormWizard, DraftRecovery, BulkActions, PermissionState, AuditTimeline, ActivityFeed, StatusTimeline, WorkflowStepper, FinancialSummary, FileUpload, ExportJob, InsightsWithProvenance, NotificationCenter.

Cada componente precisa de contrato de props/semântica, variações, story de erro e interação, testes automatizados e documentação de acessibilidade. Componentes complexos devem declarar estados controlados/não controlados e estratégias de performance. **Não usar componente genérico para esconder regras específicas de domínio.**

## 7. Estados obrigatórios e feedback

| Estado | Experiência obrigatória |
|---|---|
| Loading | Indicar progresso sem bloquear ações independentes; skeleton adequado |
| Empty | Explicar motivo + próxima ação quando autorizada |
| Error | Mensagem compreensível, contexto de falha, retry seguro quando aplicável |
| Validation | Mensagem junto ao campo + resumo com foco acessível |
| Forbidden | Explicar falta de permissão sem revelar dados protegidos |
| Offline/stale | Informar freshness e limitar ações de risco |
| Partial success | Informar exatamente o que funcionou e o que não funcionou |
| Conflict/duplicate | Oferecer resolução segura, sem duplicar efeito financeiro |
| Success | Somente depois de confirmação efetiva; apresentar identificador e próximos passos |

Para operações irreversíveis: mostrar impacto, recurso, unidade/tenant, consequências e mecanismo de aprovação. Automações exigem versão, auditoria, rastro de execução, simulação e cancelamento quando possível.

## 8. Fluxos prioritários do piloto escolar

### Fluxo A — Novo aluno e matrícula

`Busca de pessoa → identificar duplicidade → cadastrar/atualizar dados autorizados → selecionar curso/turma → validar regras → revisar contrato → confirmar matrícula → recibo/status → log de auditoria`.

Casos críticos: aluno já existente, unidade errada, responsável divergente, matrícula simultânea, pagamento pendente, falha parcial e requisição repetida. Em todos, UI reflete **verdade da API**.

### Fluxo B — Financeiro institucional

`Localizar contrato/título → filtrar por unidade/competência → conferir valor e histórico → ação autorizada → confirmação → conciliação/baixa → comprovante/auditoria`.

Casos críticos: pagamento duplicado, callback repetido, diferença de centavos, reversão/estorno, período encerrado, concorrência e ausência de permissão. O frontend nunca calcula sozinho a verdade financeira.

### Fluxo C — Receita de processo (diferencial)

`Escolher modelo → configurar etapas e responsáveis → simular com dados sintéticos → validar acessos → publicar versão aprovada → executar → acompanhar pendências → auditar/ajustar versão`.

Não transformar “receita” em metáfora visual literal; interface funcional com etapas, responsáveis e regras explicadas. Consultar `docs/PRODUCT/RECIPE_ENGINE_PRODUCT_SPEC.md`.

## 9. Padrão para cada tela/card

Um agente implementador **não começa pelo JSX**. Antes, a spec da tela deve conter:

1. Identificador, objetivo de negócio, persona, permissão, módulo/entitlement e contexto de unidade.
2. Layout desktop/mobile, hierarquia, campos/tabela/ações, conteúdo e integração API.
3. Estado normal e **todos os estados excepcionais** pertinentes.
4. Critérios de acessibilidade, keyboard flow, focus order e texto alternativo.
5. Contratos de dados, validação e explicitação de fonte/freshness nos indicadores.
6. Journey Gherkin, testes de componente, E2E e regressão visual.
7. Performance/UX metrics com método de medição, sem metas fictícias.
8. Histórias Storybook que mostrem estados autorizados e negados; revisão visual aprovada.

Se o fluxo não estiver especificado, o card permanece `DRAFT`/bloqueado conforme `SPEC-DRIVEN-DEVELOPMENT.md`.

## 10. Storybook, testes visuais e aceitação

- **Storybook** é o catálogo executável de componentes e cenários; stories para default, hover/focus, disabled, erro, loading, empty, dark, light e responsivo onde pertinente.
- Testes de acessibilidade automatizados (axe ou equivalente) **não substituem** avaliação manual com teclado/leitor de tela.
- **Playwright** valida jornadas P0 e screenshots em ambientes previsíveis; snapshots devem ser revisados, não atualizados cegamente só para obter PASS.
- **Orval** gera clientes de API a partir de OpenAPI aprovado; **MSW** oferece mocks de rede determinísticos nas stories/testes.
- Testar estados cross-tenant, usuários sem entitlement, falhas de rede, concorrência, duplicidade e validação para as telas relacionadas.
- Monitorar métricas reais de conclusão de tarefa, erros e retrabalho no piloto; não declarar ganhos percentuais sem medição.

Ver [Storybook](docs/TOOLING/STORYBOOK.md), [matriz de stories](docs/TOOLING/STORYBOOK_STORY_MATRIX.md), [a11y/visual/performance](docs/TESTING/A11Y_VISUAL_PERFORMANCE.md) e [regressão](docs/TESTING/REGRESSION_MATRIX.md).

## 11. Desenho técnico por funcionalidade (além de UX/UI)

`DESIGN.md` governa a experiência transversal. **O desenho técnico específico de um card não deve ser improvisado dentro do prompt**: para funcionalidades de alto risco ou com decisões de persistência, integração e migração, criar `specs/design/<CARD_ID>-design.md` a partir de [`templates/FEATURE_DESIGN_TEMPLATE.md`](templates/FEATURE_DESIGN_TEMPLATE.md). Esse documento deve vincular spec aprovada, interfaces, modelo de dados, sequência, estados, erros, autorização, idempotência, testes e rollout. Para decisões que afetem múltiplos contextos ou a plataforma, abrir ADR (não esconder a decisão no desenho do card). O desenho técnico começa `DRAFT`; revisão humana aplica-se aos riscos indicados em `AGENTS.md`.

## 12. UI Design Review — critérios de aprovação

- [ ] Layout original, consistente com Brand Book, sem clonagem reconhecível de concorrente.
- [ ] Tokens semânticos, dark/light, tipografia e contraste corretos em estados reais.
- [ ] Jornada por persona e nomenclatura testáveis com usuário do setor.
- [ ] Loading, empty, error, forbidden, partial, conflict e success cobertos quando aplicáveis.
- [ ] Fluxo por teclado, foco e leitor de tela revistos; alvo WCAG 2.2 AA.
- [ ] Storybook + testes de interação, screenshot diff e E2E dos fluxos P0.
- [ ] Permissão e entitlement reforçados na API; UI não é a segurança.
- [ ] Tabelas, filtros, formulários e relatórios com estados e números coerentes.
- [ ] Sem dados reais de estudantes em mocks, prints, stories ou CI.
- [ ] Evidências com screenshots, relatório de testes e aprovação de design anexadas ao card/PR.

**Status atual:** visão de design **proposta**; componentes e telas de produção **ainda não implementados**.
