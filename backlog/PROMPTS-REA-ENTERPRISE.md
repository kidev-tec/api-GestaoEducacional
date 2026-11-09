# Prompts operacionais — REA + ERP Educacional Enterprise

> Execute somente em ambiente e conta autorizados. O alvo chamado **Hermes** precisa ser identificado com nome, versão e artefato. A conversa compartilhada não disponibilizou aqui seu histórico completo; não pressupor que seja o Hermes Agent da NousResearch, F10, ou qualquer outro produto.

## Prompt 01 — Preparação e inventário autorizado

```text
Atue como analista sênior de engenharia de produto, segurança e processos educacionais.
Nossa missão é compreender o comportamento observável e documentado de [ALVO HERMES, VERSÃO, ENDEREÇO/ARTEFATO], usando REA, para especificar um ERP SaaS educacional inteiramente original.

Regras:
1. Antes de usar ferramentas, documente artefato/URL, versão, escopo autorizado, papéis disponíveis e ambiente de testes.
2. Mostre alterações que o setup do REA pretende fazer e peça aprovação antes de aplicar.
3. Não contorne autenticação, licenciamento, restrições técnicas ou permissões. Não teste endpoints de terceiros, não copie código proprietário, assets ou marca.
4. Utilize apenas dados sintéticos, sessões e tráfego explicitamente autorizados; anonimize capturas e registros.
5. Registre cada conclusão como OBSERVADO, INFERIDO ou NÃO VERIFICADO, incluindo local exato da evidência, data e cenário.
6. Trabalhe uma jornada por vez. Primeiro observe e documente; só depois proponha implementação própria.

Primeira entrega: mapa de papéis e navegação, inventário por módulo, top 10 jornadas, riscos, lacunas e plano de testes. Não faça alterações no alvo.
Vincule descobertas aos cards E01-01 a E01-10.
```

## Prompt 02 — Investigação de uma funcionalidade

```text
Analise a funcionalidade [NOME] do sistema [ALVO], no papel de usuário [PAPEL], apenas no escopo autorizado.

Faça:
- Desenhe jornada de estados (entrada, validações, ações, erros, saída, auditabilidade).
- Identifique entidades, regras aparentes, permissões, integrações observáveis e casos excepcionais.
- Capture evidência precisa com versão, data, local, papel e dados redigidos.
- Distingua fato observado, inferência e perguntas em aberto.
- Não confunda comportamento visível com implementação interna comprovada.
- Produza requisito funcional abstrato, sem copiar interface, código nem texto distintivo do fornecedor.
- Compare propostas de melhoria com padrões enterprise: clean core, isolamento, auditoria, idempotência, acessibilidade e métricas.

Saída: relatório markdown evidencias/[CARD_ID].md + tabela cenário/entrada/resultado + modelo de dados conceitual + proposta original + testes de aceite positivos e negativos.
```

## Prompt 03 — Benchmark de excelência (SAP, Oracle, Dynamics)

```text
Para [MÓDULO], crie uma matriz:
(A) Necessidade real da escola;
(B) Comportamento observado na referência, com evidência;
(C) Padrão de engenharia e operação de grandes ERPs, com fonte oficial;
(D) Nosso projeto original e diferencial;
(E) Métrica de aceitação e custo de implementação.

Distingua práticas de arquitetura de funcionalidades comercializadas. Não afirme que produtos concorrentes não suportam uma função sem demonstrar.
Dê preferência a processos simples, extensíveis e verificáveis em vez de adotar complexidade por prestígio. Informe o que NÃO construir no MVP.
```

## Prompt 04 — Handoff clean-room de análise para implementação

```text
Receba somente os requisitos abstratos aprovados e a matriz de comportamentos, sem código ou assets proprietários do alvo.

Para o card [CARD_ID], entregue:
1. ADR quando afetar arquitetura;
2. Contrato de domínio/API/erros;
3. Casos de teste RED (incluindo acesso não autorizado, tenant errado, retry e falha externa);
4. Implementação GREEN original;
5. REFACTOR sem quebrar invariantes;
6. Logs/traces sem PII, critérios WCAG conforme aplicável;
7. Evidência do teste, cobertura de cenários críticos e checklist de DoD;
8. Limitações e itens de dívida técnica.

Não implementar recursos fora do card nem acoplar módulos via tabelas privadas. Ações financeiras sensíveis requerem aprovação explícita e auditoria.
```

## Prompt 05 — Auditoria independente de release

```text
Atue como revisor técnico independente. Analise o que foi realmente implementado — não apenas o relato do agente.
Cheque isolamento multi-tenant nas interfaces, filas, busca, exports; idempotência financeira; backups e restore testado; RBAC/ABAC, LGPD e ASVS; acessibilidade; documentação, integração e testes E2E.

Resultado: PASS / BLOCK / NOT TESTED por controle, evidência precisa, severidade e ação corretiva. É proibido certificar como pronto um item sem evidência.
```

## Modelo de evidência por card

```md
# [CARD_ID] — [TÍTULO]
- Alvo/versão:
- Data e ambiente:
- Autorização e papel:
- Evidência (caminho/trecho/captura redigida):
- Classificação: OBSERVADO | INFERIDO | NÃO VERIFICADO
- Passos de reprodução autorizados:
- Entrada sintética:
- Resultado esperado e observado:
- Casos negativos:
- Requisito abstrato sem conteúdo proprietário:
- Proposta original e vantagens:
- Riscos e limitações:
- Autor / revisor:
- Commits / testes / relatórios:
```
