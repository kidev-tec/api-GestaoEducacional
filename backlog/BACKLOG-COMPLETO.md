# Backlog enterprise — ERP Educacional modular (projeto sem marca definida)

> Versão 1.0 · 08/11/2026 · Proposta de produto, **não** documentação do código do F10 ou do Hermes.

## Norte do produto

Construir um **ERP educacional SaaS**, familiar nos fluxos da escola, original na interface e acima da referência local nos padrões de engenharia, segurança, consistência financeira, acessibilidade, governança e operações. A meta de ser “melhor” deve ser comprovada em testes comparativos e resultados de clientes — nunca assumida.

### Regra de referência

- **F10:** benchmark funcional e de adoção do cliente; **não** copiar código, identidade visual, textos protegidos, marcas ou elementos distintivos.
- **Hermes:** sistema/artefato a identificar precisamente no E01-01. Não presumir que seja o Hermes Agent da NousResearch nem que seja um módulo F10 até comprovar.
- **REA:** instrumento de observação e inspeção autorizada. Guardar evidências, origem e nível de confiança; não contornar licença, autenticação, proteção técnica ou acessar dados de terceiros.
- **Padrão enterprise:** SAP clean core e extensibilidade, controles OWASP ASVS 5.0, LGPD/ANPD, pilares Microsoft Well-Architected e integrações resilientes.

## Padrões obrigatórios (qualidade verificável)

1. **Clean core:** bounded contexts, extensões/APIs estáveis, nenhum módulo pode depender de tabelas privadas de outro sem contrato explícito.
2. **Multi-tenant:** autorização do backend + isolamento demonstrado por testes de API, filas, cache, busca, exportações e jobs. Uma unidade só acessa sua esfera autorizada.
3. **Financeiro:** aritmética monetária exata, idempotência, compensação/estorno ao invés de edição silenciosa, reconciliação auditável e segregação de funções.
4. **Segurança:** MFA para perfis privilegiados, least privilege, policies RBAC/ABAC, auditoria, secret management, avaliação OWASP ASVS, tratamento LGPD para dados de menores.
5. **Qualidade de uso:** interface autoral light-first/dark opcional, navegação por papéis, busca universal autorizada, estados vazios/erro, responsividade e WCAG 2.2 AA conforme aplicabilidade.
6. **Operação:** tracing/metrics/logging sem dados pessoais, restore ensaiado, SLOs negociados por tier, rollback e incident response.
7. **Comercialização:** catálogo de módulos e entitlements do lado servidor; downgrade jamais apaga dados; exportação autorizada permanece disponível.
8. **IA:** assistente opt-in, RAG com ACL, evidência das fontes, supervisão humana para ações sensíveis e proteção contra prompt injection.

## Módulos comerciais propostos

| Camada | Módulos | Política |
| --- | --- | --- |
| Base obrigatória | Identity, Multi-tenant, Cadastros mestres, Auditoria, Integrações e Exportação | Incluída em qualquer plano; não é uma camada de upsell de segurança |
| Núcleo educacional | Secretaria/Matrículas, CRM, Financeiro, Acadêmico/Pedagógico | Licenciados por módulo, com dependências transparentes |
| Complementos | Comunicação, Portais/PWA, AVA, BI, Automações, IA, Franquias/Multiunidade | Adicionáveis conforme maturidade da instituição |
| Comercialização | Assinatura por unidade e faixas de uso/assentos, sem surpresas | Valores a validar com a pesquisa de mercado |

## Estratégia de entrega e gates

| Gate | Condição objetiva | Libera |
| --- | --- | --- |
| G0 Descoberta | Alvo Hermes identificado, autorização REA, baseline de tarefas e MVP aceito | Prototipagem |
| G1 Design | Design system, 5 tarefas testadas, arquitetura e threat model revisados | Construção core |
| G2 Core | Isolamento multi-tenant testado, autenticação, trilha de auditoria e CI | Módulos MVP |
| G3 Transação | Lead→matrícula→contrato→cobrança e acadêmico, com conciliação e teste negativo | Piloto |
| G4 Piloto | UAT com cliente, restauração e rollback ensaiados, sem vulnerabilidades críticas | Produção controlada |
| G5 Escala | SLO acordado observado e gestão operacional validada | Novos tenants e add-ons |

## Definition of Done obrigatória para cada card

- [ ] Critério de aceite demonstrado com teste automatizado ou evidência de pesquisa, com casos negativos relevantes.
- [ ] Acessibilidade, autorização e tratamento de dados pessoais avaliados quando aplicáveis.
- [ ] Documentação/ADR, APIs, migrações e eventos atualizados quando afetados.
- [ ] Revisão por segunda pessoa ou agente independente; evidência registrada no caminho do card.
- [ ] Referências identificadas como observado / inferido / requisito novo.
- [ ] PR com lint, typecheck, testes e scan de segurança verde; preferir RED → GREEN → REFACTOR para regras de domínio.

## Labels recomendados

`epic:E##`, `fase:descoberta|fundacao|mvp|piloto|evolucao`, `prio:P0|P1|P2`, `tipo:pesquisa|design|implementacao`, `modulo:<nome>`, `rea`, `enterprise`, `security`, `compliance`.

## Fontes oficiais e benchmarks

- F10 soluções e módulos: https://www2.f10.com.br/solucoes
- F10 funcionalidades anunciadas: https://www2.f10.com.br/software-para-escolas
- REA fonte oficial: https://github.com/morluto/rea e https://rea.tools/
- SAP clean core: https://help.sap.com/docs/erp-transformation-with-itc/buildable-map/clean-core-extensibility-for-sap-cloud-erp
- Azure Well-Architected Framework: https://learn.microsoft.com/en-us/azure/architecture/framework/
- OWASP ASVS 5.0: https://asvs.owasp.org/
- ANPD orientações LGPD: https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes
- WCAG 2.2: https://www.w3.org/TR/WCAG22/

## Catálogo de cards


## E00 — Estratégia, benchmarking e escopo (6 cards)

### E00-01 · Definir ICP e segmentos educacionais

**Fase:** Descoberta · **Prioridade:** P0 · **Módulo:** Produto · **Dependências:** Nenhuma

**Objetivo:** Entrevistar clientes de cursos livres, idiomas e escolas técnicas, entregando resultado verificável para produto.

**Checklist**
- [ ] Entrevistar clientes de cursos livres, idiomas e escolas técnicas.
- [ ] Segmentar por operação e número de unidades.
- [ ] Documentar restrições do piloto.

**Critério de aceite:** ICP, personas e cenários validados com ao menos um representante da operação.

**Evidência obrigatória:** `evidencias/E00-01.md` · **Referência:** SAP / Oracle / Dynamics 365

### E00-02 · Mapear jornadas e tarefas críticas

**Fase:** Descoberta · **Prioridade:** P0 · **Módulo:** Produto · **Dependências:** E00-01

**Objetivo:** Observar processos de secretaria, comercial, financeiro e docência, entregando resultado verificável para produto.

**Checklist**
- [ ] Observar processos de secretaria, comercial, financeiro e docência.
- [ ] Medir passos, erros e tempos.
- [ ] Listar eventos e exceções.

**Critério de aceite:** Jornada ponta a ponta com atores, entrada, saída, exceções e tempo-base registrado.

**Evidência obrigatória:** `evidencias/E00-02.md` · **Referência:** SAP / Oracle / Dynamics 365

### E00-03 · Construir benchmark funcional F10 x líderes

**Fase:** Descoberta · **Prioridade:** P0 · **Módulo:** Produto · **Dependências:** E00-01

**Objetivo:** Registrar funcionalidades públicas da f10, entregando resultado verificável para produto.

**Checklist**
- [ ] Registrar funcionalidades públicas da f10.
- [ ] Comparar padrões sap, oracle e dynamics por dimensão.
- [ ] Separar evidência de hipótese.

**Critério de aceite:** Matriz com fonte, nota justificada e lacunas sem alegar capacidades não verificadas.

**Evidência obrigatória:** `evidencias/E00-03.md` · **Referência:** SAP / Oracle / Dynamics 365

### E00-04 · Definir proposta de valor e diferenciais

**Fase:** Descoberta · **Prioridade:** P0 · **Módulo:** Produto · **Dependências:** E00-02

**Objetivo:** Priorizar problemas repetitivos, retrabalho e governança, entregando resultado verificável para produto.

**Checklist**
- [ ] Priorizar problemas repetitivos, retrabalho e governança.
- [ ] Propor centro de ações, busca universal e automação.
- [ ] Validar ganhos esperados.

**Critério de aceite:** Cada diferencial tem hipótese, métrica, responsável e teste com usuário.

**Evidência obrigatória:** `evidencias/E00-04.md` · **Referência:** SAP / Oracle / Dynamics 365

### E00-05 · Estabelecer KPIs de produto e operação

**Fase:** Descoberta · **Prioridade:** P0 · **Módulo:** Produto · **Dependências:** E00-02

**Objetivo:** Definir time-to-value, tempo de matrícula, inadimplência, sla e adoção, entregando resultado verificável para produto.

**Checklist**
- [ ] Definir time-to-value, tempo de matrícula, inadimplência, sla e adoção.
- [ ] Documentar fórmula e fonte.
- [ ] Indicar linha de base.

**Critério de aceite:** Dicionário de KPIs aprovado e instrumentável.

**Evidência obrigatória:** `evidencias/E00-05.md` · **Referência:** SAP / Oracle / Dynamics 365

### E00-06 · Delimitar MVP, fases e riscos

**Fase:** Descoberta · **Prioridade:** P1 · **Módulo:** Produto · **Dependências:** E00-03,E00-04

**Objetivo:** Priorizar por valor, risco e dependência, entregando resultado verificável para produto.

**Checklist**
- [ ] Priorizar por valor, risco e dependência.
- [ ] Fechar módulos mínimos para primeira escola.
- [ ] Aprovar exclusões e mapa de riscos.

**Critério de aceite:** Escopo MVP e backlog por fase assinados pelo sponsor; nenhuma feature sem dono.

**Evidência obrigatória:** `evidencias/E00-06.md` · **Referência:** SAP / Oracle / Dynamics 365


## E01 — Engenharia reversa com REA (10 cards)

### E01-01 · Autorizar escopo e regras da investigação

**Fase:** Descoberta · **Prioridade:** P0 · **Módulo:** Pesquisa · **Dependências:** E00-01

**Objetivo:** Identificar aplicativo hermes exato, versão e relação com o erp, entregando resultado verificável para pesquisa.

**Checklist**
- [ ] Identificar aplicativo hermes exato, versão e relação com o erp.
- [ ] Obter autorização e ambiente de teste.
- [ ] Definir proibições de coleta e dados reais.

**Critério de aceite:** Termo de escopo, origem do artefato e contas autorizadas registrados antes de iniciar.

**Evidência obrigatória:** `evidencias/E01-01.md` · **Referência:** REA / referência autorizada

### E01-02 · Configurar REA em ambiente isolado

**Fase:** Descoberta · **Prioridade:** P0 · **Módulo:** Pesquisa · **Dependências:** E01-01

**Objetivo:** Instalar rea da fonte oficial com revisão do setup, entregando resultado verificável para pesquisa.

**Checklist**
- [ ] Instalar rea da fonte oficial com revisão do setup.
- [ ] Configurar agente e verificar doctor.
- [ ] Registrar versões e permissões.

**Critério de aceite:** Setup reproduzível e verificado sem modificar o alvo.

**Evidência obrigatória:** `evidencias/E01-02.md` · **Referência:** REA / referência autorizada

### E01-03 · Criar protocolo de evidências

**Fase:** Descoberta · **Prioridade:** P0 · **Módulo:** Pesquisa · **Dependências:** E01-01

**Objetivo:** Padronizar id da captura, data, versão, tela, papel e nível de certeza, entregando resultado verificável para pesquisa.

**Checklist**
- [ ] Padronizar id da captura, data, versão, tela, papel e nível de certeza.
- [ ] Redigir dados pessoais.
- [ ] Armazenar notas observadas separadas de inferências.

**Critério de aceite:** Toda afirmação rastreável ao artefato e ao cenário de teste.

**Evidência obrigatória:** `evidencias/E01-03.md` · **Referência:** REA / referência autorizada

### E01-04 · Inventariar navegação e papéis

**Fase:** Descoberta · **Prioridade:** P0 · **Módulo:** Pesquisa · **Dependências:** E01-02,E01-03

**Objetivo:** Navegar com perfis autorizados, entregando resultado verificável para pesquisa.

**Checklist**
- [ ] Navegar com perfis autorizados.
- [ ] Mapear menu, páginas e controles.
- [ ] Identificar permissões observáveis.

**Critério de aceite:** Mapa navegável com screenshots redigidos e matrizes por papel.

**Evidência obrigatória:** `evidencias/E01-04.md` · **Referência:** REA / referência autorizada

### E01-05 · Investigar fluxo de leads até matrícula

**Fase:** Descoberta · **Prioridade:** P0 · **Módulo:** Pesquisa · **Dependências:** E01-04

**Objetivo:** Executar cenários fictícios de lead, contato, proposta, aceite e matrícula, entregando resultado verificável para pesquisa.

**Checklist**
- [ ] Executar cenários fictícios de lead, contato, proposta, aceite e matrícula.
- [ ] Registrar validações e estados.
- [ ] Mapear erros.

**Critério de aceite:** Diagrama BPMN com casos felizes e 5 exceções observadas ou marcadas como hipótese.

**Evidência obrigatória:** `evidencias/E01-05.md` · **Referência:** REA / referência autorizada

### E01-06 · Investigar secretaria e dados acadêmicos

**Fase:** Descoberta · **Prioridade:** P1 · **Módulo:** Pesquisa · **Dependências:** E01-04

**Objetivo:** Observar cadastro, relacionamento responsável/aluno, turma e documentos, entregando resultado verificável para pesquisa.

**Checklist**
- [ ] Observar cadastro, relacionamento responsável/aluno, turma e documentos.
- [ ] Registrar campos e regras visíveis.
- [ ] Comparar nomenclatura.

**Critério de aceite:** Dicionário de campos, fluxos e regras com evidência.

**Evidência obrigatória:** `evidencias/E01-06.md` · **Referência:** REA / referência autorizada

### E01-07 · Investigar financeiro pela interface

**Fase:** Descoberta · **Prioridade:** P1 · **Módulo:** Pesquisa · **Dependências:** E01-04

**Objetivo:** Usar cobranças fictícias, entregando resultado verificável para pesquisa.

**Checklist**
- [ ] Usar cobranças fictícias.
- [ ] Observar geração, baixa, renegociação e estorno quando permitido.
- [ ] Levantar dependências externas.

**Critério de aceite:** Diagrama de eventos financeiros sem acesso não autorizado a dados ou endpoints.

**Evidência obrigatória:** `evidencias/E01-07.md` · **Referência:** REA / referência autorizada

### E01-08 · Investigar pedagógico e presença

**Fase:** Descoberta · **Prioridade:** P1 · **Módulo:** Pesquisa · **Dependências:** E01-04

**Objetivo:** Simular cursos, horários, aulas, presença e avaliações, entregando resultado verificável para pesquisa.

**Checklist**
- [ ] Simular cursos, horários, aulas, presença e avaliações.
- [ ] Documentar estados e permissões.
- [ ] Registrar exceções.

**Critério de aceite:** Matriz de estados e tarefas por papel com evidências.

**Evidência obrigatória:** `evidencias/E01-08.md` · **Referência:** REA / referência autorizada

### E01-09 · Mapear integrações somente por vias autorizadas

**Fase:** Descoberta · **Prioridade:** P1 · **Módulo:** Pesquisa · **Dependências:** E01-01,E01-03

**Objetivo:** Examinar documentação pública e tráfego próprio aprovado, entregando resultado verificável para pesquisa.

**Checklist**
- [ ] Examinar documentação pública e tráfego próprio aprovado.
- [ ] Catalogar exportações e webhooks legítimos.
- [ ] Não contornar controles.

**Critério de aceite:** Inventário de integrações com fonte, limites, dados e autorização.

**Evidência obrigatória:** `evidencias/E01-09.md` · **Referência:** REA / referência autorizada

### E01-10 · Consolidar referência funcional clean-room

**Fase:** Descoberta · **Prioridade:** P1 · **Módulo:** Pesquisa · **Dependências:** E01-05,E01-06,E01-07,E01-08,E01-09

**Objetivo:** Classificar cada função como observado, inferido ou desejado, entregando resultado verificável para pesquisa.

**Checklist**
- [ ] Classificar cada função como observado, inferido ou desejado.
- [ ] Abstrair requisito sem copiar código, marca ou layout.
- [ ] Apontar oportunidades de melhoria.

**Critério de aceite:** Documento de requisitos originais e matriz de rastreabilidade aprovado.

**Evidência obrigatória:** `evidencias/E01-10.md` · **Referência:** REA / referência autorizada


## E02 — Design system e UX original (8 cards)

### E02-01 · Auditar UX atual e tarefas de alta frequência

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** UX · **Dependências:** E01-04,E00-02

**Objetivo:** Identificar fricções por inspeção autorizada, entregando resultado verificável para ux.

**Checklist**
- [ ] Identificar fricções por inspeção autorizada.
- [ ] Medir cliques, carga cognitiva e erros.
- [ ] Definir baseline.

**Critério de aceite:** Relatório heurístico priorizado por impacto e evidência, não por gosto pessoal.

**Evidência obrigatória:** `evidencias/E02-01.md` · **Referência:** Design enterprise / WCAG

### E02-02 · Desenhar arquitetura de informação por função

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** UX · **Dependências:** E02-01

**Objetivo:** Organizar menu por tarefa e perfil, entregando resultado verificável para ux.

**Checklist**
- [ ] Organizar menu por tarefa e perfil.
- [ ] Prever multiunidades e favoritos.
- [ ] Validar com teste de árvore.

**Critério de aceite:** >=80% de conclusão de 5 tarefas-alvo em teste de navegação piloto.

**Evidência obrigatória:** `evidencias/E02-02.md` · **Referência:** Design enterprise / WCAG

### E02-03 · Definir identidade visual exclusiva e tokens

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** UX · **Dependências:** E02-01

**Objetivo:** Criar marca provisória sem derivar trade dress da f10, entregando resultado verificável para ux.

**Checklist**
- [ ] Criar marca provisória sem derivar trade dress da f10.
- [ ] Definir light/dark, grid, tipografia e tokens semânticos.
- [ ] Garantir contrastes.

**Critério de aceite:** Biblioteca de tokens versionada e contraste WCAG 2.2 AA nas áreas aplicáveis.

**Evidência obrigatória:** `evidencias/E02-03.md` · **Referência:** Design enterprise / WCAG

### E02-04 · Construir componentes do design system

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** UX · **Dependências:** E02-03

**Objetivo:** Especificar tabela densa, filtros, formulário, wizard, modal, timeline e indicadores, entregando resultado verificável para ux.

**Checklist**
- [ ] Especificar tabela densa, filtros, formulário, wizard, modal, timeline e indicadores.
- [ ] Definir estados loading/empty/error.
- [ ] Testes a11y.

**Critério de aceite:** Componentes reusáveis documentados, navegáveis por teclado e testados.

**Evidência obrigatória:** `evidencias/E02-04.md` · **Referência:** Design enterprise / WCAG

### E02-05 · Projetar centro de trabalho e dashboards por papel

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** UX · **Dependências:** E02-02,E02-04

**Objetivo:** Mapear pendências para diretor, secretaria, financeiro, professor, entregando resultado verificável para ux.

**Checklist**
- [ ] Mapear pendências para diretor, secretaria, financeiro, professor.
- [ ] Criar ações contextuais.
- [ ] Validar ordem de prioridade.

**Critério de aceite:** Protótipos por papel com tarefas principais executáveis em teste moderado.

**Evidência obrigatória:** `evidencias/E02-05.md` · **Referência:** Design enterprise / WCAG

### E02-06 · Projetar busca universal e comandos rápidos

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** UX · **Dependências:** E02-04,E04-04

**Objetivo:** Definir escopo por permissões, entregando resultado verificável para ux.

**Checklist**
- [ ] Definir escopo por permissões.
- [ ] Pesquisar aluno, turma, fatura e ação.
- [ ] Registrar atalhos e feedback.

**Critério de aceite:** Nenhum resultado fora da permissão e tarefas frequentes acionáveis sem percorrer menus.

**Evidência obrigatória:** `evidencias/E02-06.md` · **Referência:** Design enterprise / WCAG

### E02-07 · Projetar experiências responsivas e acessíveis

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** UX · **Dependências:** E02-04

**Objetivo:** Desenhar desktop, tablet e celular, entregando resultado verificável para ux.

**Checklist**
- [ ] Desenhar desktop, tablet e celular.
- [ ] Prever densidade de dados e formulário longo.
- [ ] Testar leitor de tela e teclado.

**Critério de aceite:** Protótipos em 3 viewports com checklist de WCAG 2.2 AA.

**Evidência obrigatória:** `evidencias/E02-07.md` · **Referência:** Design enterprise / WCAG

### E02-08 · Validar UI com usuários antes de codificar

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** UX · **Dependências:** E02-05,E02-06,E02-07

**Objetivo:** Realizar 5 testes exploratórios com tarefas reais e dados fictícios, entregando resultado verificável para ux.

**Checklist**
- [ ] Realizar 5 testes exploratórios com tarefas reais e dados fictícios.
- [ ] Registrar tempo, sus e erros.
- [ ] Revisar prioridades.

**Critério de aceite:** Relatório antes/depois com top 10 ajustes e decisões rastreáveis.

**Evidência obrigatória:** `evidencias/E02-08.md` · **Referência:** Design enterprise / WCAG


## E03 — Arquitetura SaaS e core modular (12 cards)

### E03-01 · Publicar ADRs e limites de arquitetura

**Fase:** Fundação · **Prioridade:** P0 · **Módulo:** Plataforma · **Dependências:** E00-06

**Objetivo:** Decidir monólito modular primeiro, integrações por contratos, infraestrutura e adrs, entregando resultado verificável para plataforma.

**Checklist**
- [ ] Decidir monólito modular primeiro, integrações por contratos, infraestrutura e adrs.
- [ ] Justificar trade-offs.
- [ ] Documentar nfrs.

**Critério de aceite:** ADRs revisadas e riscos conhecidos explicitados; sem microsserviços por reflexo.

**Evidência obrigatória:** `evidencias/E03-01.md` · **Referência:** SAP clean core / APIs

### E03-02 · Criar monorepo e padrões de engenharia

**Fase:** Fundação · **Prioridade:** P0 · **Módulo:** Plataforma · **Dependências:** E03-01

**Objetivo:** Configurar pacotes frontend, backend, shared e tooling, entregando resultado verificável para plataforma.

**Checklist**
- [ ] Configurar pacotes frontend, backend, shared e tooling.
- [ ] Lint, typecheck e testes.
- [ ] Templates de pr e conventional commits.

**Critério de aceite:** CI verde com exemplo end-to-end e execução local documentada.

**Evidência obrigatória:** `evidencias/E03-02.md` · **Referência:** SAP clean core / APIs

### E03-03 · Definir bounded contexts e dependências

**Fase:** Fundação · **Prioridade:** P0 · **Módulo:** Plataforma · **Dependências:** E03-01

**Objetivo:** Separar identidade, cadastros, comercial, financeiro e acadêmico, entregando resultado verificável para plataforma.

**Checklist**
- [ ] Separar identidade, cadastros, comercial, financeiro e acadêmico.
- [ ] Impor regras de importação.
- [ ] Registrar owners.

**Critério de aceite:** Teste automatizado impede dependências circulares e acessos internos indevidos.

**Evidência obrigatória:** `evidencias/E03-03.md` · **Referência:** SAP clean core / APIs

### E03-04 · Construir isolamento multi-tenant multiunidade

**Fase:** Fundação · **Prioridade:** P0 · **Módulo:** Plataforma · **Dependências:** E03-03,E04-03

**Objetivo:** Modelar tenant, rede, escola e unidade, entregando resultado verificável para plataforma.

**Checklist**
- [ ] Modelar tenant, rede, escola e unidade.
- [ ] Propagar contexto em cada requisição e job.
- [ ] Testar cross-tenant.

**Critério de aceite:** Testes de negação provam ausência de vazamento por API, filas, cache e consultas.

**Evidência obrigatória:** `evidencias/E03-04.md` · **Referência:** SAP clean core / APIs

### E03-05 · Definir esquema relacional e migrations seguras

**Fase:** Fundação · **Prioridade:** P0 · **Módulo:** Plataforma · **Dependências:** E03-03

**Objetivo:** Padronizar ids, timestamps, soft-delete onde aplicável, índices e migrações, entregando resultado verificável para plataforma.

**Checklist**
- [ ] Padronizar ids, timestamps, soft-delete onde aplicável, índices e migrações.
- [ ] Definir rollback e lock strategy.
- [ ] Documentar cenários-limite, riscos e testes de regressão.

**Critério de aceite:** Alterações de esquema executadas em base preenchida sem perda inesperada.

**Evidência obrigatória:** `evidencias/E03-05.md` · **Referência:** SAP clean core / APIs

### E03-06 · Criar padrões transacionais e outbox

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** Plataforma · **Dependências:** E03-05

**Objetivo:** Projetar eventos de domínio, idempotência e transactional outbox, entregando resultado verificável para plataforma.

**Checklist**
- [ ] Projetar eventos de domínio, idempotência e transactional outbox.
- [ ] Tratar reentrega.
- [ ] Prover auditoria.

**Critério de aceite:** Cenários de falha/retry não duplicam lançamentos ou notificações.

**Evidência obrigatória:** `evidencias/E03-06.md` · **Referência:** SAP clean core / APIs

### E03-07 · Criar workers, filas e retries

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** Plataforma · **Dependências:** E03-06

**Objetivo:** Adicionar jobs duráveis, dlq, backoff e visão de reprocessamento, entregando resultado verificável para plataforma.

**Checklist**
- [ ] Adicionar jobs duráveis, dlq, backoff e visão de reprocessamento.
- [ ] Especificar timeout e quotas.
- [ ] Documentar cenários-limite, riscos e testes de regressão.

**Critério de aceite:** Reexecução de job idempotente com rastreio por tenant.

**Evidência obrigatória:** `evidencias/E03-07.md` · **Referência:** SAP clean core / APIs

### E03-08 · Padronizar APIs versionadas e contratos

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** Plataforma · **Dependências:** E03-03

**Objetivo:** Criar openapi, erros rfc-style, paginação, filtros e idempotency keys, entregando resultado verificável para plataforma.

**Checklist**
- [ ] Criar openapi, erros rfc-style, paginação, filtros e idempotency keys.
- [ ] Incluir exemplos e sdk base.
- [ ] Documentar cenários-limite, riscos e testes de regressão.

**Critério de aceite:** Contratos publicados com testes de compatibilidade retroativa.

**Evidência obrigatória:** `evidencias/E03-08.md` · **Referência:** SAP clean core / APIs

### E03-09 · Implementar configuração, secrets e feature flags

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** Plataforma · **Dependências:** E03-04,E04-02

**Objetivo:** Distinguir ambiente, tenant, unidade, usuário e módulos habilitados, entregando resultado verificável para plataforma.

**Checklist**
- [ ] Distinguir ambiente, tenant, unidade, usuário e módulos habilitados.
- [ ] Excluir segredo de logs.
- [ ] Registrar histórico.

**Critério de aceite:** Flag altera acesso sem redeploy e não substitui checagem de autorização.

**Evidência obrigatória:** `evidencias/E03-09.md` · **Referência:** SAP clean core / APIs

### E03-10 · Criar armazenamento de arquivos e antivírus

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** Plataforma · **Dependências:** E03-04,E04-04

**Objetivo:** Definir uploads, limites, tipos, links temporários, varredura, ciclo de vida e retenção, entregando resultado verificável para plataforma.

**Checklist**
- [ ] Definir uploads, limites, tipos, links temporários, varredura, ciclo de vida e retenção.
- [ ] Tratar documentos de menores.
- [ ] Documentar cenários-limite, riscos e testes de regressão.

**Critério de aceite:** Upload e download isolados por tenant, com logs e casos negativos cobertos.

**Evidência obrigatória:** `evidencias/E03-10.md` · **Referência:** SAP clean core / APIs

### E03-11 · Implementar pesquisa indexada com ACL

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** Plataforma · **Dependências:** E03-04,E02-06

**Objetivo:** Indexar entidades selecionadas e atualizações, entregando resultado verificável para plataforma.

**Checklist**
- [ ] Indexar entidades selecionadas e atualizações.
- [ ] Aplicar filtros de autorização na fonte.
- [ ] Testar exclusões.

**Critério de aceite:** Zero resultados indevidos em teste cross-tenant e tempo medido em dataset piloto.

**Evidência obrigatória:** `evidencias/E03-11.md` · **Referência:** SAP clean core / APIs

### E03-12 · Preparar internacionalização e regionalização

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** Plataforma · **Dependências:** E03-02

**Objetivo:** Separar idioma, moeda, fuso, numeração e calendário, entregando resultado verificável para plataforma.

**Checklist**
- [ ] Separar idioma, moeda, fuso, numeração e calendário.
- [ ] Priorizar pt-br.
- [ ] Definir formato fiscal via adaptadores.

**Critério de aceite:** Datas/moedas consistentes em UI, API, exports e jobs, com testes de fusos.

**Evidência obrigatória:** `evidencias/E03-12.md` · **Referência:** SAP clean core / APIs


## E04 — Identidade, segurança e LGPD (9 cards)

### E04-01 · Modelar ameaças e riscos do ERP escolar

**Fase:** Fundação · **Prioridade:** P0 · **Módulo:** Plataforma · **Dependências:** E03-01

**Objetivo:** Realizar threat modeling para menor de idade, dados financeiros e multi-tenant, entregando resultado verificável para plataforma.

**Checklist**
- [ ] Realizar threat modeling para menor de idade, dados financeiros e multi-tenant.
- [ ] Criar mitigações e owners.
- [ ] Revisar antes do mvp.

**Critério de aceite:** Riscos classificados, mitigação dos críticos testada e pendências explícitas.

**Evidência obrigatória:** `evidencias/E04-01.md` · **Referência:** OWASP ASVS / ANPD

### E04-02 · Implementar autenticação segura e sessões

**Fase:** Fundação · **Prioridade:** P0 · **Módulo:** Plataforma · **Dependências:** E03-02

**Objetivo:** Definir sso/oidc, mfa para privilegiados, recuperação e rotação, entregando resultado verificável para plataforma.

**Checklist**
- [ ] Definir sso/oidc, mfa para privilegiados, recuperação e rotação.
- [ ] Expiração e revogação.
- [ ] Limitar brute force.

**Critério de aceite:** Testes funcionais e negativos de sessões e recuperação passam.

**Evidência obrigatória:** `evidencias/E04-02.md` · **Referência:** OWASP ASVS / ANPD

### E04-03 · Projetar roles, policies e segregação de funções

**Fase:** Fundação · **Prioridade:** P0 · **Módulo:** Plataforma · **Dependências:** E04-02

**Objetivo:** Mapear rbac+atributos por tenant e unidade, entregando resultado verificável para plataforma.

**Checklist**
- [ ] Mapear rbac+atributos por tenant e unidade.
- [ ] Evitar poder excessivo.
- [ ] Formalizar sod financeira.

**Critério de aceite:** Cada operação protegida por policy no backend e matriz de papéis revisada.

**Evidência obrigatória:** `evidencias/E04-03.md` · **Referência:** OWASP ASVS / ANPD

### E04-04 · Implementar autorização em todos os canais

**Fase:** Fundação · **Prioridade:** P0 · **Módulo:** Plataforma · **Dependências:** E04-03,E03-04

**Objetivo:** Aplicar política a apis, relatórios, busca, exportação, jobs e websocket, entregando resultado verificável para plataforma.

**Checklist**
- [ ] Aplicar política a apis, relatórios, busca, exportação, jobs e websocket.
- [ ] Testes por papel/tenant.
- [ ] Negar padrão.

**Critério de aceite:** Bateria de testes não encontra caminho alternativo sem autorização.

**Evidência obrigatória:** `evidencias/E04-04.md` · **Referência:** OWASP ASVS / ANPD

### E04-05 · Implementar trilha de auditoria imutável logicamente

**Fase:** Fundação · **Prioridade:** P0 · **Módulo:** Plataforma · **Dependências:** E03-06,E04-03

**Objetivo:** Registrar quem/quando/o quê/de-para em eventos críticos, entregando resultado verificável para plataforma.

**Checklist**
- [ ] Registrar quem/quando/o quê/de-para em eventos críticos.
- [ ] Mascarar pii.
- [ ] Prever retenção e busca.

**Critério de aceite:** Matrícula, preço, desconto, boleto e permissão rastreáveis sem armazenar senha/token.

**Evidência obrigatória:** `evidencias/E04-05.md` · **Referência:** OWASP ASVS / ANPD

### E04-06 · Definir programa LGPD e dados de menores

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** Plataforma · **Dependências:** E04-01,E05-01

**Objetivo:** Mapear finalidade, bases legais, controlador/operador, retenção e direitos, entregando resultado verificável para plataforma.

**Checklist**
- [ ] Mapear finalidade, bases legais, controlador/operador, retenção e direitos.
- [ ] Tratar dados de menores com revisão jurídica.
- [ ] Dpia conforme risco.

**Critério de aceite:** Registro de tratamento e fluxos de atendimento a titulares documentados.

**Evidência obrigatória:** `evidencias/E04-06.md` · **Referência:** OWASP ASVS / ANPD

### E04-07 · Preparar criptografia e gestão de segredos

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** Plataforma · **Dependências:** E04-02

**Objetivo:** Usar tls, criptografia em repouso conforme risco, secret manager, rotação e scanner, entregando resultado verificável para plataforma.

**Checklist**
- [ ] Usar tls, criptografia em repouso conforme risco, secret manager, rotação e scanner.
- [ ] Definir resposta a incidente.
- [ ] Documentar cenários-limite, riscos e testes de regressão.

**Critério de aceite:** Nenhum segredo em repositório/log e rotação documentada/testada.

**Evidência obrigatória:** `evidencias/E04-07.md` · **Referência:** OWASP ASVS / ANPD

### E04-08 · Definir política de exportação, retenção e exclusão

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** Plataforma · **Dependências:** E04-05,E04-06

**Objetivo:** Configurar exportações auditáveis, exclusão/anonimização quando legalmente cabível e legal hold, entregando resultado verificável para plataforma.

**Checklist**
- [ ] Configurar exportações auditáveis, exclusão/anonimização quando legalmente cabível e legal hold.
- [ ] Evitar deleção financeira indevida.
- [ ] Documentar cenários-limite, riscos e testes de regressão.

**Critério de aceite:** Testes demonstram portabilidade e retenção fiscal sem vazamento.

**Evidência obrigatória:** `evidencias/E04-08.md` · **Referência:** OWASP ASVS / ANPD

### E04-09 · Criar gates de segurança OWASP ASVS

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** Plataforma · **Dependências:** E04-01,E14-01

**Objetivo:** Mapear requisitos asvs aplicáveis, entregando resultado verificável para plataforma.

**Checklist**
- [ ] Mapear requisitos asvs aplicáveis.
- [ ] Incluir sast, sca, secret scan e dast controlado.
- [ ] Registrar exceções aprovadas.

**Critério de aceite:** Checklist ASVS com evidências e nenhuma vulnerabilidade crítica em aberto no release.

**Evidência obrigatória:** `evidencias/E04-09.md` · **Referência:** OWASP ASVS / ANPD


## E05 — Cadastros e jornada de matrícula (7 cards)

### E05-01 · Modelar pessoas, alunos e responsáveis

**Fase:** MVP · **Prioridade:** P0 · **Módulo:** Secretaria · **Dependências:** E03-05,E04-03

**Objetivo:** Criar identidade de pessoa independente de papel, entregando resultado verificável para secretaria.

**Checklist**
- [ ] Criar identidade de pessoa independente de papel.
- [ ] Suportar aluno, responsável, contato e pagador.
- [ ] Padronizar vínculos.

**Critério de aceite:** Uma pessoa pode ter múltiplos papéis sem duplicação, preservando histórico.

**Evidência obrigatória:** `evidencias/E05-01.md` · **Referência:** ERP educacional / qualidade de dados

### E05-02 · Cadastrar organizações e unidades escolares

**Fase:** MVP · **Prioridade:** P0 · **Módulo:** Secretaria · **Dependências:** E03-04

**Objetivo:** Definir rede, campus, unidade e permissões, entregando resultado verificável para secretaria.

**Checklist**
- [ ] Definir rede, campus, unidade e permissões.
- [ ] Campos por segmento.
- [ ] Importação inicial.

**Critério de aceite:** Cadastro hierárquico testado com duas unidades isoladas.

**Evidência obrigatória:** `evidencias/E05-02.md` · **Referência:** ERP educacional / qualidade de dados

### E05-03 · Definir calendário letivo, cursos e períodos

**Fase:** MVP · **Prioridade:** P0 · **Módulo:** Secretaria · **Dependências:** E05-02

**Objetivo:** Modelar períodos, curso, modalidade, carga horária e oferta, entregando resultado verificável para secretaria.

**Checklist**
- [ ] Modelar períodos, curso, modalidade, carga horária e oferta.
- [ ] Validar estados.
- [ ] Criar dados de seed.

**Critério de aceite:** Regras de vigência e conflito testadas em dois calendários.

**Evidência obrigatória:** `evidencias/E05-03.md` · **Referência:** ERP educacional / qualidade de dados

### E05-04 · Construir cadastro completo com validação

**Fase:** MVP · **Prioridade:** P0 · **Módulo:** Secretaria · **Dependências:** E05-01,E02-04

**Objetivo:** Formulário por etapa, documentos, contato e histórico, entregando resultado verificável para secretaria.

**Checklist**
- [ ] Formulário por etapa, documentos, contato e histórico.
- [ ] Validações brasileiras.
- [ ] Evitar coleta excessiva.

**Critério de aceite:** Usuário conclui cadastro e correção sem redigitar dados já existentes.

**Evidência obrigatória:** `evidencias/E05-04.md` · **Referência:** ERP educacional / qualidade de dados

### E05-05 · Implementar matrículas, rematrículas e status

**Fase:** MVP · **Prioridade:** P1 · **Módulo:** Secretaria · **Dependências:** E05-01,E05-03,E03-06

**Objetivo:** Mapear elegibilidade, reservas, matrícula ativa/trancada/cancelada, entregando resultado verificável para secretaria.

**Checklist**
- [ ] Mapear elegibilidade, reservas, matrícula ativa/trancada/cancelada.
- [ ] Versionar mudanças.
- [ ] Disparar eventos.

**Critério de aceite:** Máquina de estados com transições válidas e inválidas coberta por testes.

**Evidência obrigatória:** `evidencias/E05-05.md` · **Referência:** ERP educacional / qualidade de dados

### E05-06 · Gerenciar contratos, consentimentos e anexos

**Fase:** MVP · **Prioridade:** P1 · **Módulo:** Secretaria · **Dependências:** E05-05,E03-10,E04-05

**Objetivo:** Modelar versões e aceites, entregando resultado verificável para secretaria.

**Checklist**
- [ ] Modelar versões e aceites.
- [ ] Anexar documentos.
- [ ] Guardar evidências e retenção.
- [ ] Delegar assinatura a provedor.

**Critério de aceite:** Contrato associado à matrícula com auditoria e anexos protegidos.

**Evidência obrigatória:** `evidencias/E05-06.md` · **Referência:** ERP educacional / qualidade de dados

### E05-07 · Controlar qualidade e deduplicação de dados

**Fase:** MVP · **Prioridade:** P1 · **Módulo:** Secretaria · **Dependências:** E05-01,E04-05

**Objetivo:** Normalizar, detectar homônimos e duplicidades, entregando resultado verificável para secretaria.

**Checklist**
- [ ] Normalizar, detectar homônimos e duplicidades.
- [ ] Permitir merge auditado.
- [ ] Documentar prevenção.

**Critério de aceite:** Merge preserva vínculos e possui trilha de reversão ou correção controlada.

**Evidência obrigatória:** `evidencias/E05-07.md` · **Referência:** ERP educacional / qualidade de dados


## E06 — CRM e comercial educacional (8 cards)

### E06-01 · Cadastrar leads com origem e consentimento

**Fase:** MVP · **Prioridade:** P0 · **Módulo:** CRM · **Dependências:** E03-08,E04-06

**Objetivo:** Capturar contato, origem, campanha e preferências, entregando resultado verificável para crm.

**Checklist**
- [ ] Capturar contato, origem, campanha e preferências.
- [ ] Deduplicar.
- [ ] Aplicar base legal.
- [ ] Padronizar formulários.

**Critério de aceite:** Lead entra com fonte e consentimento quando aplicável, sem duplicação indevida.

**Evidência obrigatória:** `evidencias/E06-01.md` · **Referência:** Dynamics 365 / processos

### E06-02 · Construir funis configuráveis e Kanban

**Fase:** MVP · **Prioridade:** P0 · **Módulo:** CRM · **Dependências:** E06-01,E02-04

**Objetivo:** Configurar estágios e motivos de perda, entregando resultado verificável para crm.

**Checklist**
- [ ] Configurar estágios e motivos de perda.
- [ ] Registrar histórico e métricas.
- [ ] Oferecer acessibilidade no drag-drop.

**Critério de aceite:** Funil respeita regras, histórico e uso pelo teclado.

**Evidência obrigatória:** `evidencias/E06-02.md` · **Referência:** Dynamics 365 / processos

### E06-03 · Criar tarefas, agenda e distribuição de leads

**Fase:** MVP · **Prioridade:** P0 · **Módulo:** CRM · **Dependências:** E06-02,E03-07

**Objetivo:** Distribuir por unidade/equipe e round-robin, entregando resultado verificável para crm.

**Checklist**
- [ ] Distribuir por unidade/equipe e round-robin.
- [ ] Definir sla de contato.
- [ ] Registrar atividades.

**Critério de aceite:** Atribuição previsível e auditável, sem perda no reprocessamento.

**Evidência obrigatória:** `evidencias/E06-03.md` · **Referência:** Dynamics 365 / processos

### E06-04 · Criar propostas e tabela de preços versionada

**Fase:** MVP · **Prioridade:** P0 · **Módulo:** CRM · **Dependências:** E06-02,E04-03

**Objetivo:** Gerir curso, duração, preço, descontos, vigência, entregando resultado verificável para crm.

**Checklist**
- [ ] Gerir curso, duração, preço, descontos, vigência.
- [ ] Exigir aprovação por alçada.
- [ ] Simular total.

**Critério de aceite:** Alteração de preço não muda proposta assinada e desconto acima do limite bloqueia.

**Evidência obrigatória:** `evidencias/E06-04.md` · **Referência:** Dynamics 365 / processos

### E06-05 · Converter oportunidade em matrícula

**Fase:** MVP · **Prioridade:** P1 · **Módulo:** CRM · **Dependências:** E06-04,E05-05,E05-06

**Objetivo:** Reutilizar pessoa, curso, proposta e contrato, entregando resultado verificável para crm.

**Checklist**
- [ ] Reutilizar pessoa, curso, proposta e contrato.
- [ ] Evitar digitação repetida.
- [ ] Emitir evento financeiro.

**Critério de aceite:** Uma ação gera matrícula válida com referências e sem duplicação por retry.

**Evidência obrigatória:** `evidencias/E06-05.md` · **Referência:** Dynamics 365 / processos

### E06-06 · Gerenciar comissões e metas comerciais

**Fase:** MVP · **Prioridade:** P1 · **Módulo:** CRM · **Dependências:** E06-05,E07-06

**Objetivo:** Definir regras versionadas e elegibilidade, entregando resultado verificável para crm.

**Checklist**
- [ ] Definir regras versionadas e elegibilidade.
- [ ] Detectar cancelamento/chargeback.
- [ ] Calcular com precisão.

**Critério de aceite:** Comissão reproduzível por versão de regra e conciliada com eventos financeiros.

**Evidência obrigatória:** `evidencias/E06-06.md` · **Referência:** Dynamics 365 / processos

### E06-07 · Medir funil, CAC e canais

**Fase:** MVP · **Prioridade:** P1 · **Módulo:** CRM · **Dependências:** E06-02,E11-01

**Objetivo:** Instrumentar origem e etapa, entregando resultado verificável para crm.

**Checklist**
- [ ] Instrumentar origem e etapa.
- [ ] Documentar atribuição e taxa de conversão.
- [ ] Segmentar por unidade.

**Critério de aceite:** Dashboard confere com amostra auditada de negócios e matrículas.

**Evidência obrigatória:** `evidencias/E06-07.md` · **Referência:** Dynamics 365 / processos

### E06-08 · Mapear automações comerciais seguras

**Fase:** MVP · **Prioridade:** P1 · **Módulo:** CRM · **Dependências:** E06-03,E09-02

**Objetivo:** Criar lembretes e follow-up sob opt-in, entregando resultado verificável para crm.

**Checklist**
- [ ] Criar lembretes e follow-up sob opt-in.
- [ ] Limites de envio, supervisão e opt-out.
- [ ] Registrar resultados.

**Critério de aceite:** Nenhum disparo sem política válida e toda automação pode ser desligada.

**Evidência obrigatória:** `evidencias/E06-08.md` · **Referência:** Dynamics 365 / processos


## E07 — Financeiro e cobrança (10 cards)

### E07-01 · Modelar contas a receber, pagar e centros de custo

**Fase:** MVP · **Prioridade:** P0 · **Módulo:** Financeiro · **Dependências:** E03-06,E05-05

**Objetivo:** Criar lançamentos, vencimentos, categorias e centros de custo, entregando resultado verificável para financeiro.

**Checklist**
- [ ] Criar lançamentos, vencimentos, categorias e centros de custo.
- [ ] Regras de competência.
- [ ] Conciliar com matrícula.

**Critério de aceite:** Lançamentos têm origem, status e histórico, sem ambiguidade contábil.

**Evidência obrigatória:** `evidencias/E07-01.md` · **Referência:** Oracle / integridade financeira

### E07-02 · Definir subledger e reconciliação financeira

**Fase:** MVP · **Prioridade:** P0 · **Módulo:** Financeiro · **Dependências:** E07-01,E04-05

**Objetivo:** Projetar partidas equilibradas quando adotadas, entregando resultado verificável para financeiro.

**Checklist**
- [ ] Projetar partidas equilibradas quando adotadas.
- [ ] Lançar correções por estorno, nunca alterar histórico.
- [ ] Construir relatório de integridade.

**Critério de aceite:** Invariantes financeiros automatizados e trilha imutável logicamente.

**Evidência obrigatória:** `evidencias/E07-02.md` · **Referência:** Oracle / integridade financeira

### E07-03 · Gerar mensalidades, parcelas e recorrências

**Fase:** MVP · **Prioridade:** P0 · **Módulo:** Financeiro · **Dependências:** E07-01,E06-05

**Objetivo:** Modelar plano, parcelas, juros/multas configurados legalmente, descontos e feriados, entregando resultado verificável para financeiro.

**Checklist**
- [ ] Modelar plano, parcelas, juros/multas configurados legalmente, descontos e feriados.
- [ ] Prevenir duplicação.
- [ ] Documentar cenários-limite, riscos e testes de regressão.

**Critério de aceite:** Simulação e emissão conferem com contrato e retry não duplica parcela.

**Evidência obrigatória:** `evidencias/E07-03.md` · **Referência:** Oracle / integridade financeira

### E07-04 · Integrar Pix via PSP oficial

**Fase:** MVP · **Prioridade:** P0 · **Módulo:** Financeiro · **Dependências:** E07-03,E12-05

**Objetivo:** Escolher psp, entregando resultado verificável para financeiro.

**Checklist**
- [ ] Escolher psp.
- [ ] Homologar cobrança, pagamento, expiração e webhook assinado.
- [ ] Usar idempotência.

**Critério de aceite:** Pagamento duplica notificação sem duplicar baixa, com teste em sandbox.

**Evidência obrigatória:** `evidencias/E07-04.md` · **Referência:** Oracle / integridade financeira

### E07-05 · Integrar boleto e cobrança bancária

**Fase:** MVP · **Prioridade:** P1 · **Módulo:** Financeiro · **Dependências:** E07-03,E12-05

**Objetivo:** Modelar registro, remessa/retorno quando aplicável e status, entregando resultado verificável para financeiro.

**Checklist**
- [ ] Modelar registro, remessa/retorno quando aplicável e status.
- [ ] Homologar fornecedor.
- [ ] Tratar retorno tardio.

**Critério de aceite:** Boleto registrado e baixado corretamente em cenários de reenvio e atraso.

**Evidência obrigatória:** `evidencias/E07-05.md` · **Referência:** Oracle / integridade financeira

### E07-06 · Processar baixas, estornos e chargebacks

**Fase:** MVP · **Prioridade:** P1 · **Módulo:** Financeiro · **Dependências:** E07-02,E04-03

**Objetivo:** Definir transições e compensações, entregando resultado verificável para financeiro.

**Checklist**
- [ ] Definir transições e compensações.
- [ ] Separar autorização e execução.
- [ ] Notificar sistemas dependentes.

**Critério de aceite:** Estorno exige alçada e valor conciliado após reversão.

**Evidência obrigatória:** `evidencias/E07-06.md` · **Referência:** Oracle / integridade financeira

### E07-07 · Implementar renegociação e acordos

**Fase:** MVP · **Prioridade:** P1 · **Módulo:** Financeiro · **Dependências:** E07-03,E07-06

**Objetivo:** Simular negociação, regras de desconto e cronograma, entregando resultado verificável para financeiro.

**Checklist**
- [ ] Simular negociação, regras de desconto e cronograma.
- [ ] Preservar dívida original e histórico.
- [ ] Gerar novo instrumento.

**Critério de aceite:** Total e vencimentos reproduzíveis, acordo auditável e reversível segundo política.

**Evidência obrigatória:** `evidencias/E07-07.md` · **Referência:** Oracle / integridade financeira

### E07-08 · Criar conciliação e fechamento de caixa

**Fase:** MVP · **Prioridade:** P1 · **Módulo:** Financeiro · **Dependências:** E07-04,E07-05,E07-06

**Objetivo:** Importar extratos autorizados, entregando resultado verificável para financeiro.

**Checklist**
- [ ] Importar extratos autorizados.
- [ ] Conciliar automático e manual.
- [ ] Sinalizar divergências.
- [ ] Bloquear fechamento inconsistente.

**Critério de aceite:** Relatório de divergências zera no cenário de teste e ajustes têm justificativa.

**Evidência obrigatória:** `evidencias/E07-08.md` · **Referência:** Oracle / integridade financeira

### E07-09 · Criar indicadores de inadimplência e aging

**Fase:** MVP · **Prioridade:** P1 · **Módulo:** Financeiro · **Dependências:** E07-03,E07-08,E11-01

**Objetivo:** Calcular aging por data, unidade e turma, entregando resultado verificável para financeiro.

**Checklist**
- [ ] Calcular aging por data, unidade e turma.
- [ ] Excluir anulações.
- [ ] Reconciliar com contas a receber.

**Critério de aceite:** KPIs batem com relatório de títulos e amostra validada.

**Evidência obrigatória:** `evidencias/E07-09.md` · **Referência:** Oracle / integridade financeira

### E07-10 · Planejar notas fiscais e conformidade tributária

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Financeiro · **Dependências:** E07-01,E12-05

**Objetivo:** Levantar município/regime/provedor com contabilidade, entregando resultado verificável para financeiro.

**Checklist**
- [ ] Levantar município/regime/provedor com contabilidade.
- [ ] Desenhar adaptador nfs-e.
- [ ] Classificar regras regionais e validação jurídica.

**Critério de aceite:** Especificação fiscal aprovada; emissão somente após homologação por município.

**Evidência obrigatória:** `evidencias/E07-10.md` · **Referência:** Oracle / integridade financeira


## E08 — Acadêmico e pedagógico (8 cards)

### E08-01 · Estruturar turmas, ofertas, professores e capacidade

**Fase:** MVP · **Prioridade:** P0 · **Módulo:** Acadêmico · **Dependências:** E05-03,E05-05

**Objetivo:** Definir capacidade, unidade, requisitos de professor e oferta, entregando resultado verificável para acadêmico.

**Checklist**
- [ ] Definir capacidade, unidade, requisitos de professor e oferta.
- [ ] Validar sobreposição.
- [ ] Modelar estados.

**Critério de aceite:** Turma respeita capacidade e restrições configuradas.

**Evidência obrigatória:** `evidencias/E08-01.md` · **Referência:** ERP educacional / UX

### E08-02 · Criar grade, horários e calendários de aula

**Fase:** MVP · **Prioridade:** P0 · **Módulo:** Acadêmico · **Dependências:** E08-01,E03-12

**Objetivo:** Modelar recorrências, feriados, remarcações e salas, entregando resultado verificável para acadêmico.

**Checklist**
- [ ] Modelar recorrências, feriados, remarcações e salas.
- [ ] Detectar conflitos.
- [ ] Notificar mudanças.

**Critério de aceite:** Testes cobrem horário de verão/fuso, conflito e cancelamento.

**Evidência obrigatória:** `evidencias/E08-02.md` · **Referência:** ERP educacional / UX

### E08-03 · Implementar chamada e presença auditável

**Fase:** MVP · **Prioridade:** P0 · **Módulo:** Acadêmico · **Dependências:** E08-02,E04-05

**Objetivo:** Suportar professor, justificativa e atraso, entregando resultado verificável para acadêmico.

**Checklist**
- [ ] Suportar professor, justificativa e atraso.
- [ ] Registrar revisão e trilha.
- [ ] Exportar dados por turma.

**Critério de aceite:** Percentuais e histórico conferem com chamada original.

**Evidência obrigatória:** `evidencias/E08-03.md` · **Referência:** ERP educacional / UX

### E08-04 · Projetar chamada offline com sincronização

**Fase:** Evolução · **Prioridade:** P0 · **Módulo:** Acadêmico · **Dependências:** E08-03,E10-04

**Objetivo:** Mapear pwa no dispositivo confiável, entregando resultado verificável para acadêmico.

**Checklist**
- [ ] Mapear pwa no dispositivo confiável.
- [ ] Armazenar mínimo.
- [ ] Resolver conflitos de edição.
- [ ] Expirar cache.

**Critério de aceite:** Reconexão sincroniza sem sobrescrever silenciosamente registro mais recente.

**Evidência obrigatória:** `evidencias/E08-04.md` · **Referência:** ERP educacional / UX

### E08-05 · Definir avaliações, notas e aprovação

**Fase:** MVP · **Prioridade:** P1 · **Módulo:** Acadêmico · **Dependências:** E08-01,E04-03

**Objetivo:** Configurar critérios, períodos e recuperação, entregando resultado verificável para acadêmico.

**Checklist**
- [ ] Configurar critérios, períodos e recuperação.
- [ ] Calcular médias com regras versionadas.
- [ ] Bloquear publicação indevida.

**Critério de aceite:** Mesmo conjunto de dados sempre produz resultado idêntico e auditável.

**Evidência obrigatória:** `evidencias/E08-05.md` · **Referência:** ERP educacional / UX

### E08-06 · Criar diário de classe e atividades

**Fase:** MVP · **Prioridade:** P1 · **Módulo:** Acadêmico · **Dependências:** E08-02,E03-10

**Objetivo:** Registrar conteúdo ministrado, materiais e tarefas, entregando resultado verificável para acadêmico.

**Checklist**
- [ ] Registrar conteúdo ministrado, materiais e tarefas.
- [ ] Restringir por papel.
- [ ] Vincular ao horário.

**Critério de aceite:** Histórico por aula consulta registros e anexos com permissão.

**Evidência obrigatória:** `evidencias/E08-06.md` · **Referência:** ERP educacional / UX

### E08-07 · Gerar certificados e documentos acadêmicos

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Acadêmico · **Dependências:** E08-05,E05-06

**Objetivo:** Criar templates e emissão com código verificador, entregando resultado verificável para acadêmico.

**Checklist**
- [ ] Criar templates e emissão com código verificador.
- [ ] Regras de conclusão.
- [ ] Revogação auditável.

**Critério de aceite:** Certificado só emite com elegibilidade válida e validação pública sem expor PII.

**Evidência obrigatória:** `evidencias/E08-07.md` · **Referência:** ERP educacional / UX

### E08-08 · Gerenciar transferência, trancamento e conclusão

**Fase:** MVP · **Prioridade:** P1 · **Módulo:** Acadêmico · **Dependências:** E08-01,E05-05,E07-03

**Objetivo:** Mapear migração de turma e unidade, aproveitamento e histórico, entregando resultado verificável para acadêmico.

**Checklist**
- [ ] Mapear migração de turma e unidade, aproveitamento e histórico.
- [ ] Refletir efeitos financeiros.
- [ ] Registrar aprovações.

**Critério de aceite:** Transições mantêm integridade de frequência, notas e cobranças.

**Evidência obrigatória:** `evidencias/E08-08.md` · **Referência:** ERP educacional / UX


## E09 — Comunicação omnichannel (6 cards)

### E09-01 · Definir matriz de eventos e comunicações

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Comunicação · **Dependências:** E04-06,E05-05

**Objetivo:** Catalogar eventos de matrícula, aula e cobrança, entregando resultado verificável para comunicação.

**Checklist**
- [ ] Catalogar eventos de matrícula, aula e cobrança.
- [ ] Diferenciar transacional e marketing.
- [ ] Consentimentos e frequência.

**Critério de aceite:** Cada evento tem destinatário, canal, opt-out e política de retenção.

**Evidência obrigatória:** `evidencias/E09-01.md` · **Referência:** APIs oficiais / governança

### E09-02 · Construir templates versionados e variáveis

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Comunicação · **Dependências:** E09-01

**Objetivo:** Criar editor restrito, preview e revisão, entregando resultado verificável para comunicação.

**Checklist**
- [ ] Criar editor restrito, preview e revisão.
- [ ] Validar placeholders e idioma.
- [ ] Incluir proteção a pii.

**Critério de aceite:** Templates têm histórico e falham fechado em variáveis ausentes.

**Evidência obrigatória:** `evidencias/E09-02.md` · **Referência:** APIs oficiais / governança

### E09-03 · Integrar mensageria por provedores oficiais

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Comunicação · **Dependências:** E09-02,E12-05

**Objetivo:** Modelar adapters e webhooks, entregando resultado verificável para comunicação.

**Checklist**
- [ ] Modelar adapters e webhooks.
- [ ] Homologar whatsapp business api, e-mail e sms conforme contrato.
- [ ] Respeitar políticas.

**Critério de aceite:** Sandbox comprova envio, entrega, erro e opt-out sem usar automação não oficial.

**Evidência obrigatória:** `evidencias/E09-03.md` · **Referência:** APIs oficiais / governança

### E09-04 · Criar inbox unificada com atribuição

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Comunicação · **Dependências:** E09-03,E04-04

**Objetivo:** Armazenar threads e eventos autorizados, entregando resultado verificável para comunicação.

**Checklist**
- [ ] Armazenar threads e eventos autorizados.
- [ ] Roteamento por unidade.
- [ ] Mascaramento e tempo de resposta.

**Critério de aceite:** Atendimento pode ser transferido sem perder contexto e respeita acesso.

**Evidência obrigatória:** `evidencias/E09-04.md` · **Referência:** APIs oficiais / governança

### E09-05 · Criar campanhas segmentadas com limites

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Comunicação · **Dependências:** E09-03,E09-04

**Objetivo:** Construir segmentação, janelas de envio, opt-out e aprovação, entregando resultado verificável para comunicação.

**Checklist**
- [ ] Construir segmentação, janelas de envio, opt-out e aprovação.
- [ ] Pré-visualizar público.
- [ ] Limite por tenant.

**Critério de aceite:** Teste impede envio sem autorização/consentimento aplicável.

**Evidência obrigatória:** `evidencias/E09-05.md` · **Referência:** APIs oficiais / governança

### E09-06 · Criar preferências e central de notificações

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Comunicação · **Dependências:** E09-01,E10-01

**Objetivo:** Permitir configuração por responsável/aluno e evento, entregando resultado verificável para comunicação.

**Checklist**
- [ ] Permitir configuração por responsável/aluno e evento.
- [ ] Notificação in-app.
- [ ] Preferências por canal.

**Critério de aceite:** Preferências são respeitadas, com exceções transacionais documentadas.

**Evidência obrigatória:** `evidencias/E09-06.md` · **Referência:** APIs oficiais / governança


## E10 — Portais, app e AVA (6 cards)

### E10-01 · Criar portal do aluno com dados essenciais

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Experiência · **Dependências:** E08-03,E08-05,E04-04

**Objetivo:** Exibir aulas, frequência, notas, comunicados e documentos autorizados, entregando resultado verificável para experiência.

**Checklist**
- [ ] Exibir aulas, frequência, notas, comunicados e documentos autorizados.
- [ ] Projetar mobile-first.
- [ ] A11y.

**Critério de aceite:** Aluno visualiza apenas seus dados e executa tarefas em celular.

**Evidência obrigatória:** `evidencias/E10-01.md` · **Referência:** Acessibilidade / self-service

### E10-02 · Criar portal do responsável e pagador

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Experiência · **Dependências:** E05-01,E07-03,E04-04

**Objetivo:** Permitir vínculos verificados, notificações, documentos e faturas, entregando resultado verificável para experiência.

**Checklist**
- [ ] Permitir vínculos verificados, notificações, documentos e faturas.
- [ ] Separar responsável legal e financeiro.
- [ ] Trilha.

**Critério de aceite:** Visibilidade compatível com vínculo e permissão, sem acesso entre alunos.

**Evidência obrigatória:** `evidencias/E10-02.md` · **Referência:** Acessibilidade / self-service

### E10-03 · Disponibilizar pagamentos e segunda via self-service

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Experiência · **Dependências:** E10-02,E07-04,E07-05

**Objetivo:** Integrar links seguros de cobrança, comprovante e renegociação permitida, entregando resultado verificável para experiência.

**Checklist**
- [ ] Integrar links seguros de cobrança, comprovante e renegociação permitida.
- [ ] Sem manipular cartão bruto.
- [ ] Documentar cenários-limite, riscos e testes de regressão.

**Critério de aceite:** Pagamento e baixa refletidos no portal com reconciliação e proteção contra dupla cobrança.

**Evidência obrigatória:** `evidencias/E10-03.md` · **Referência:** Acessibilidade / self-service

### E10-04 · Publicar PWA responsivo com offline controlado

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Experiência · **Dependências:** E02-07,E04-04

**Objetivo:** Criar manifest, caching seletivo, atualização segura e fallbacks, entregando resultado verificável para experiência.

**Checklist**
- [ ] Criar manifest, caching seletivo, atualização segura e fallbacks.
- [ ] Não persistir dados sensíveis sem justificativa.
- [ ] Documentar cenários-limite, riscos e testes de regressão.

**Critério de aceite:** App funciona nos dispositivos-alvo e limpa dados em logout.

**Evidência obrigatória:** `evidencias/E10-04.md` · **Referência:** Acessibilidade / self-service

### E10-05 · Especificar AVA e conteúdo didático

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Experiência · **Dependências:** E08-01,E03-10

**Objetivo:** Modelar trilhas, anexos, progresso e permissões, entregando resultado verificável para experiência.

**Checklist**
- [ ] Modelar trilhas, anexos, progresso e permissões.
- [ ] Avaliar construir x integrar lms.
- [ ] Importar conteúdo licenciado.

**Critério de aceite:** Prova de conceito aprovada, com métrica de progresso e conformidade de direitos autorais.

**Evidência obrigatória:** `evidencias/E10-05.md` · **Referência:** Acessibilidade / self-service

### E10-06 · Criar portal docente e tarefas pedagógicas

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Experiência · **Dependências:** E08-03,E08-05,E08-06

**Objetivo:** Priorizar chamada, avaliações, diário e comunicados, entregando resultado verificável para experiência.

**Checklist**
- [ ] Priorizar chamada, avaliações, diário e comunicados.
- [ ] Simplificar fluxo para tablets.
- [ ] Validar com professor.

**Critério de aceite:** Professor conclui chamada e lançamento sem acesso a turmas de terceiros.

**Evidência obrigatória:** `evidencias/E10-06.md` · **Referência:** Acessibilidade / self-service


## E11 — Dados, BI, automações e IA (7 cards)

### E11-01 · Construir catálogo de métricas e fontes

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Inteligência · **Dependências:** E00-05,E03-05

**Objetivo:** Definir fórmulas, granularidade, timezone e owner, entregando resultado verificável para inteligência.

**Checklist**
- [ ] Definir fórmulas, granularidade, timezone e owner.
- [ ] Garantir coerência financeiro/crm/acadêmico.
- [ ] Versionar.

**Critério de aceite:** Dicionário aprovado com testes de reconciliação de 10 métricas-chave.

**Evidência obrigatória:** `evidencias/E11-01.md` · **Referência:** BI governado / IA assistida

### E11-02 · Criar camada semântica e governança BI

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Inteligência · **Dependências:** E11-01,E04-04

**Objetivo:** Modelar visões com contexto de tenant/unidade, entregando resultado verificável para inteligência.

**Checklist**
- [ ] Modelar visões com contexto de tenant/unidade.
- [ ] Classificação pii.
- [ ] Atualizações incrementais.
- [ ] Custo.

**Critério de aceite:** Queries auditadas respeitam escopo e resultados reconciliados com transacional.

**Evidência obrigatória:** `evidencias/E11-02.md` · **Referência:** BI governado / IA assistida

### E11-03 · Criar dashboards acionáveis por perfil

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Inteligência · **Dependências:** E11-02,E02-05

**Objetivo:** Dar contexto, tendência e próxima ação, entregando resultado verificável para inteligência.

**Checklist**
- [ ] Dar contexto, tendência e próxima ação.
- [ ] Exportações seguras.
- [ ] Tratamento de dados ausentes.

**Critério de aceite:** Direção, comercial e financeiro validam decisões em dados piloto.

**Evidência obrigatória:** `evidencias/E11-03.md` · **Referência:** BI governado / IA assistida

### E11-04 · Construir alertas e detecção de anomalias

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Inteligência · **Dependências:** E11-03

**Objetivo:** Criar regras explicáveis para atraso, evasão e matrícula parada, entregando resultado verificável para inteligência.

**Checklist**
- [ ] Criar regras explicáveis para atraso, evasão e matrícula parada.
- [ ] Evitar discriminação.
- [ ] Permitir ajuste.

**Critério de aceite:** Alertas exibem razão, limiar e ação humana; falso-positivo medido.

**Evidência obrigatória:** `evidencias/E11-04.md` · **Referência:** BI governado / IA assistida

### E11-05 · Implementar workflow builder com aprovações

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Inteligência · **Dependências:** E03-06,E04-04

**Objetivo:** Definir gatilhos/eventos, condições e ações permitidas, entregando resultado verificável para inteligência.

**Checklist**
- [ ] Definir gatilhos/eventos, condições e ações permitidas.
- [ ] Dry-run e versionamento.
- [ ] Evitar loops.

**Critério de aceite:** Execução auditável e idempotente; usuários só automatizam ações autorizadas.

**Evidência obrigatória:** `evidencias/E11-05.md` · **Referência:** BI governado / IA assistida

### E11-06 · Projetar copiloto IA com RAG e autorização

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Inteligência · **Dependências:** E11-02,E04-04

**Objetivo:** Restringir contexto por tenant/role, citar origem, filtrar pii, logs mínimos, entregando resultado verificável para inteligência.

**Checklist**
- [ ] Restringir contexto por tenant/role, citar origem, filtrar pii, logs mínimos.
- [ ] Testar prompt injection.
- [ ] Documentar cenários-limite, riscos e testes de regressão.

**Critério de aceite:** IA não acessa dados fora do escopo nem executa ação sensível sem confirmação.

**Evidência obrigatória:** `evidencias/E11-06.md` · **Referência:** BI governado / IA assistida

### E11-07 · Criar recomendações explicáveis e opt-in

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Inteligência · **Dependências:** E11-04,E11-06

**Objetivo:** Sugerir próximas tarefas, risco de inadimplência e reposição, entregando resultado verificável para inteligência.

**Checklist**
- [ ] Sugerir próximas tarefas, risco de inadimplência e reposição.
- [ ] Definir fairness e feedback.
- [ ] Comparar baseline.

**Critério de aceite:** Recomendação explica base e pode ser recusada; sem decisões automáticas irreversíveis.

**Evidência obrigatória:** `evidencias/E11-07.md` · **Referência:** BI governado / IA assistida


## E12 — Integrações e migração (9 cards)

### E12-01 · Mapear integrações e conectores prioritários

**Fase:** MVP · **Prioridade:** P0 · **Módulo:** Integrações · **Dependências:** E00-02,E01-09

**Objetivo:** Entrevistar cliente e fornecedores, entregando resultado verificável para integrações.

**Checklist**
- [ ] Entrevistar cliente e fornecedores.
- [ ] Catalogar crm, psp, assinatura, contabilidade e lms.
- [ ] Definir contratos.

**Critério de aceite:** Matriz prioridade/custo/risco com fonte e owner.

**Evidência obrigatória:** `evidencias/E12-01.md` · **Referência:** APIs enterprise / reversibilidade

### E12-02 · Criar importador CSV/XLSX com prévia

**Fase:** MVP · **Prioridade:** P0 · **Módulo:** Integrações · **Dependências:** E05-01,E03-10

**Objetivo:** Upload autorizado, entregando resultado verificável para integrações.

**Checklist**
- [ ] Upload autorizado.
- [ ] Mapeamento de colunas.
- [ ] Validação e dry-run.
- [ ] Relatório de erros por linha.

**Critério de aceite:** Importação idempotente com amostra de 1k linhas e dados inválidos.

**Evidência obrigatória:** `evidencias/E12-02.md` · **Referência:** APIs enterprise / reversibilidade

### E12-03 · Definir estratégia de migração do legado

**Fase:** Fundação · **Prioridade:** P0 · **Módulo:** Integrações · **Dependências:** E12-01,E12-02,E01-10

**Objetivo:** Mapear entidades, ids externos, deduplicação e histórico, entregando resultado verificável para integrações.

**Checklist**
- [ ] Mapear entidades, ids externos, deduplicação e histórico.
- [ ] Negociar exportação autorizada.
- [ ] Criar rollback.

**Critério de aceite:** Plano de cutover e rollback aprovado, sem requerer acesso indevido ao F10.

**Evidência obrigatória:** `evidencias/E12-03.md` · **Referência:** APIs enterprise / reversibilidade

### E12-04 · Implementar ensaio de migração e conciliação

**Fase:** Piloto · **Prioridade:** P0 · **Módulo:** Integrações · **Dependências:** E12-03,E07-08

**Objetivo:** Rodar carga fictícia/anonimizada, entregando resultado verificável para integrações.

**Checklist**
- [ ] Rodar carga fictícia/anonimizada.
- [ ] Comparar contagens, valores e relacionamentos.
- [ ] Simular erros e reexecução.

**Critério de aceite:** Relatório zero divergência crítica e evidência de rollback executável.

**Evidência obrigatória:** `evidencias/E12-04.md` · **Referência:** APIs enterprise / reversibilidade

### E12-05 · Construir plataforma de webhooks e adapters

**Fase:** MVP · **Prioridade:** P0 · **Módulo:** Integrações · **Dependências:** E03-06,E03-08

**Objetivo:** Validar assinatura, timestamp, retries, dlq e ids, entregando resultado verificável para integrações.

**Checklist**
- [ ] Validar assinatura, timestamp, retries, dlq e ids.
- [ ] Catalogar rate limits.
- [ ] Monitorar integração.

**Critério de aceite:** Testes de replay e reordenação preservam consistência.

**Evidência obrigatória:** `evidencias/E12-05.md` · **Referência:** APIs enterprise / reversibilidade

### E12-06 · Criar API pública e portal de desenvolvedor

**Fase:** MVP · **Prioridade:** P1 · **Módulo:** Integrações · **Dependências:** E03-08,E04-04

**Objetivo:** Publicar scopes, exemplos, sandbox, api keys rotacionáveis e limites, entregando resultado verificável para integrações.

**Checklist**
- [ ] Publicar scopes, exemplos, sandbox, api keys rotacionáveis e limites.
- [ ] Versionar e depreciar.
- [ ] Documentar cenários-limite, riscos e testes de regressão.

**Critério de aceite:** App externa integra em sandbox sem suporte manual, com auditoria.

**Evidência obrigatória:** `evidencias/E12-06.md` · **Referência:** APIs enterprise / reversibilidade

### E12-07 · Planejar portabilidade e exportação completa

**Fase:** MVP · **Prioridade:** P1 · **Módulo:** Integrações · **Dependências:** E04-08,E12-02

**Objetivo:** Exportar dados e anexos em formatos abertos, entregando resultado verificável para integrações.

**Checklist**
- [ ] Exportar dados e anexos em formatos abertos.
- [ ] Documentar esquema.
- [ ] Verificar autorização e lgpd.

**Critério de aceite:** Cliente autorizado exporta e verifica amostra sem dependência comercial do fornecedor.

**Evidência obrigatória:** `evidencias/E12-07.md` · **Referência:** APIs enterprise / reversibilidade

### E12-08 · Homologar provedores por contrato e ambiente

**Fase:** MVP · **Prioridade:** P1 · **Módulo:** Integrações · **Dependências:** E12-01,E12-05

**Objetivo:** Validar psp, assinatura, mensageria e fiscal, entregando resultado verificável para integrações.

**Checklist**
- [ ] Validar psp, assinatura, mensageria e fiscal.
- [ ] Credenciais segregadas, sandbox e custos.
- [ ] Registrar falhas.

**Critério de aceite:** Matriz de homologação e fallback assinada pelo responsável.

**Evidência obrigatória:** `evidencias/E12-08.md` · **Referência:** APIs enterprise / reversibilidade

### E12-09 · Monitorar qualidade e contratos de integração

**Fase:** MVP · **Prioridade:** P1 · **Módulo:** Integrações · **Dependências:** E12-05,E14-07

**Objetivo:** Criar monitor de sync, dead letters, versão e alertas, entregando resultado verificável para integrações.

**Checklist**
- [ ] Criar monitor de sync, dead letters, versão e alertas.
- [ ] Permitir reprocessamento com aprovação.
- [ ] Documentar cenários-limite, riscos e testes de regressão.

**Critério de aceite:** Falhas visíveis e recuperáveis com rastreio end-to-end por transação.

**Evidência obrigatória:** `evidencias/E12-09.md` · **Referência:** APIs enterprise / reversibilidade


## E13 — Catálogo comercial e módulos SaaS (7 cards)

### E13-01 · Definir catálogo de módulos vendáveis

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** Comercialização · **Dependências:** E00-06

**Objetivo:** Separar core gratuito/incluso, secretaria, crm, financeiro, acadêmico, portais, mensageria, bi e ia, entregando resultado verificável para comercialização.

**Checklist**
- [ ] Separar core gratuito/incluso, secretaria, crm, financeiro, acadêmico, portais, mensageria, bi e ia.
- [ ] Modelar dependências.
- [ ] Documentar cenários-limite, riscos e testes de regressão.

**Critério de aceite:** Catálogo com dependências, pré-requisitos e dados persistentes ao desativar.

**Evidência obrigatória:** `evidencias/E13-01.md` · **Referência:** SaaS enterprise / entitlements

### E13-02 · Implementar entitlements por tenant e unidade

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** Comercialização · **Dependências:** E13-01,E03-09

**Objetivo:** Validar licença no servidor, entregando resultado verificável para comercialização.

**Checklist**
- [ ] Validar licença no servidor.
- [ ] Controlar features, seats e limites.
- [ ] Registrar mudanças.
- [ ] Não bloquear exportação.

**Critério de aceite:** Toggle reflete direito contratado sem ocultar dados por falha de cache.

**Evidência obrigatória:** `evidencias/E13-02.md` · **Referência:** SaaS enterprise / entitlements

### E13-03 · Criar planos, add-ons e limites transparentes

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** Comercialização · **Dependências:** E13-01

**Objetivo:** Modelar mensal/anual, piloto e franquia, entregando resultado verificável para comercialização.

**Checklist**
- [ ] Modelar mensal/anual, piloto e franquia.
- [ ] Atribuir limites claros.
- [ ] Versionar tabela comercial.

**Critério de aceite:** Simulador calcula valor por unidade/assento sem regras escondidas.

**Evidência obrigatória:** `evidencias/E13-03.md` · **Referência:** SaaS enterprise / entitlements

### E13-04 · Preparar trials, upgrade e downgrade seguros

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** Comercialização · **Dependências:** E13-02,E13-03

**Objetivo:** Provisionar workspace isolado, entregando resultado verificável para comercialização.

**Checklist**
- [ ] Provisionar workspace isolado.
- [ ] Upgrade sem migração destrutiva.
- [ ] Downgrade preserva dados e oferece exportação.

**Critério de aceite:** Testes mostram transições sem perda e trilha de aceite.

**Evidência obrigatória:** `evidencias/E13-04.md` · **Referência:** SaaS enterprise / entitlements

### E13-05 · Implementar medição de consumo e quotas

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Comercialização · **Dependências:** E13-02,E03-07

**Objetivo:** Medir mensagens, storage, usuários e automações sem expor pii, entregando resultado verificável para comercialização.

**Checklist**
- [ ] Medir mensagens, storage, usuários e automações sem expor pii.
- [ ] Alertas de consumo.
- [ ] Reconciliação.

**Critério de aceite:** Uso mensal reproduzível e excedente não gera cobrança surpresa.

**Evidência obrigatória:** `evidencias/E13-05.md` · **Referência:** SaaS enterprise / entitlements

### E13-06 · Criar faturamento da assinatura SaaS

**Fase:** Evolução · **Prioridade:** P2 · **Módulo:** Comercialização · **Dependências:** E13-03,E12-08

**Objetivo:** Integrar provedor de cobrança, entregando resultado verificável para comercialização.

**Checklist**
- [ ] Integrar provedor de cobrança.
- [ ] Notas conforme operação própria.
- [ ] Dunning proporcional.
- [ ] Conciliação e impostos com contador.

**Critério de aceite:** Cobrança, renovação, cancelamento e estorno funcionam em sandbox.

**Evidência obrigatória:** `evidencias/E13-06.md` · **Referência:** SaaS enterprise / entitlements

### E13-07 · Construir console de suporte e provisionamento

**Fase:** Piloto · **Prioridade:** P2 · **Módulo:** Comercialização · **Dependências:** E13-02,E04-05

**Objetivo:** Suporte com acesso temporário aprovado, trilha, impersonation controlada e dados mascarados, entregando resultado verificável para comercialização.

**Checklist**
- [ ] Suporte com acesso temporário aprovado, trilha, impersonation controlada e dados mascarados.
- [ ] Onboarding autoatendido.
- [ ] Documentar cenários-limite, riscos e testes de regressão.

**Critério de aceite:** Suporte não acessa dados de cliente sem autorização e ação auditada.

**Evidência obrigatória:** `evidencias/E13-07.md` · **Referência:** SaaS enterprise / entitlements


## E14 — Qualidade, SRE e lançamento (10 cards)

### E14-01 · Definir pirâmide de testes e Definition of Done

**Fase:** Fundação · **Prioridade:** P0 · **Módulo:** Qualidade · **Dependências:** E03-02

**Objetivo:** Padronizar unit, integração, contrato, e2e e evidências, entregando resultado verificável para qualidade.

**Checklist**
- [ ] Padronizar unit, integração, contrato, e2e e evidências.
- [ ] Template issue/pr.
- [ ] Red-green-refactor para regras.

**Critério de aceite:** PR exige testes, docs, revisão e evidência alinhada ao risco.

**Evidência obrigatória:** `evidencias/E14-01.md` · **Referência:** Microsoft Well-Architected

### E14-02 · Construir CI com gates de qualidade

**Fase:** Fundação · **Prioridade:** P0 · **Módulo:** Qualidade · **Dependências:** E14-01,E04-09

**Objetivo:** Pipeline paralelo de lint, tipos, testes, scan e build, entregando resultado verificável para qualidade.

**Checklist**
- [ ] Pipeline paralelo de lint, tipos, testes, scan e build.
- [ ] Branch protection.
- [ ] Ambiente de preview sem dados reais.

**Critério de aceite:** Branch padrão bloqueia merge quando gate crítico falha.

**Evidência obrigatória:** `evidencias/E14-02.md` · **Referência:** Microsoft Well-Architected

### E14-03 · Criar testes E2E de jornadas cross-module

**Fase:** MVP · **Prioridade:** P0 · **Módulo:** Qualidade · **Dependências:** E06-05,E07-03,E08-03

**Objetivo:** Automatizar lead→matrícula→cobrança→turma→presença, entregando resultado verificável para qualidade.

**Checklist**
- [ ] Automatizar lead→matrícula→cobrança→turma→presença.
- [ ] Acessibilidade e permissão.
- [ ] Seed determinística.

**Critério de aceite:** Suite verde em staging e captura relatório de falhas.

**Evidência obrigatória:** `evidencias/E14-03.md` · **Referência:** Microsoft Well-Architected

### E14-04 · Criar testes de propriedade para regras financeiras

**Fase:** MVP · **Prioridade:** P0 · **Módulo:** Qualidade · **Dependências:** E07-02,E07-06

**Objetivo:** Gerar cenários de parcelamento, estorno, conciliação e retry, entregando resultado verificável para qualidade.

**Checklist**
- [ ] Gerar cenários de parcelamento, estorno, conciliação e retry.
- [ ] Checar invariantes.
- [ ] Usar valores monetários seguros.

**Critério de aceite:** 1k cenários gerados sem desequilíbrio ou duplicação, seed reproduzível.

**Evidência obrigatória:** `evidencias/E14-04.md` · **Referência:** Microsoft Well-Architected

### E14-05 · Definir baseline e testes de carga por jornada

**Fase:** Piloto · **Prioridade:** P0 · **Módulo:** Qualidade · **Dependências:** E14-03,E03-04

**Objetivo:** Medir latência p50/p95, throughput e erros com dataset realista fictício, entregando resultado verificável para qualidade.

**Checklist**
- [ ] Medir latência p50/p95, throughput e erros com dataset realista fictício.
- [ ] Estabelecer budget por endpoint.
- [ ] Analisar gargalo.

**Critério de aceite:** Relatório reproduzível e SLO proposto com benchmark transparente.

**Evidência obrigatória:** `evidencias/E14-05.md` · **Referência:** Microsoft Well-Architected

### E14-06 · Criar pipeline de deploy e rollback

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** Qualidade · **Dependências:** E14-02,E03-05

**Objetivo:** Infra as code, migrations expand/contract, preview e canary, entregando resultado verificável para qualidade.

**Checklist**
- [ ] Infra as code, migrations expand/contract, preview e canary.
- [ ] Flags de kill switch.
- [ ] Rollback testado.

**Critério de aceite:** Release em staging revertida sem perda de consistência.

**Evidência obrigatória:** `evidencias/E14-06.md` · **Referência:** Microsoft Well-Architected

### E14-07 · Instrumentar observabilidade e suporte

**Fase:** Fundação · **Prioridade:** P1 · **Módulo:** Qualidade · **Dependências:** E14-02,E03-07

**Objetivo:** Adicionar logs estruturados, traces, métricas, dashboards e alertas, entregando resultado verificável para qualidade.

**Checklist**
- [ ] Adicionar logs estruturados, traces, métricas, dashboards e alertas.
- [ ] Correlação por tenant sem pii.
- [ ] Runbook.

**Critério de aceite:** Incidente de teste diagnosticável com trace ID sem vazamento.

**Evidência obrigatória:** `evidencias/E14-07.md` · **Referência:** Microsoft Well-Architected

### E14-08 · Projetar disponibilidade, backup e recuperação

**Fase:** Piloto · **Prioridade:** P1 · **Módulo:** Qualidade · **Dependências:** E14-06,E04-07

**Objetivo:** Definir rto/rpo por contrato, backups cifrados e teste de restore, entregando resultado verificável para qualidade.

**Checklist**
- [ ] Definir rto/rpo por contrato, backups cifrados e teste de restore.
- [ ] Incident response.
- [ ] Plano de continuidade.

**Critério de aceite:** Restore ensaiado e resultados atendem metas pactuadas.

**Evidência obrigatória:** `evidencias/E14-08.md` · **Referência:** Microsoft Well-Architected

### E14-09 · Realizar UAT e piloto controlado com cliente

**Fase:** Piloto · **Prioridade:** P1 · **Módulo:** Qualidade · **Dependências:** E14-03,E14-04,E14-05,E14-08

**Objetivo:** Validar 10 jornadas reais anonimizadas, treinamento e observação, entregando resultado verificável para qualidade.

**Checklist**
- [ ] Validar 10 jornadas reais anonimizadas, treinamento e observação.
- [ ] Coletar defeitos e tempo de tarefa.
- [ ] Gate go/no-go.

**Critério de aceite:** Termo UAT e plano de contingência aprovados, bloqueadores zerados.

**Evidência obrigatória:** `evidencias/E14-09.md` · **Referência:** Microsoft Well-Architected

### E14-10 · Preparar lançamento e ciclo contínuo de feedback

**Fase:** Evolução · **Prioridade:** P1 · **Módulo:** Qualidade · **Dependências:** E14-09,E13-07

**Objetivo:** Publicar docs, changelog, suporte, roadmap, métricas de adoção e processo de triagem, entregando resultado verificável para qualidade.

**Checklist**
- [ ] Publicar docs, changelog, suporte, roadmap, métricas de adoção e processo de triagem.
- [ ] Revisar pós-piloto.
- [ ] Documentar cenários-limite, riscos e testes de regressão.

**Critério de aceite:** Primeiro release tem playbook, rollback, incidentes e priorização de feedback.

**Evidência obrigatória:** `evidencias/E14-10.md` · **Referência:** Microsoft Well-Architected

