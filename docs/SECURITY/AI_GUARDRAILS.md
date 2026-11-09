# Guardrails para IA e automação

- IA é assistência, não autoridade; decisões sensíveis sobre alunos, crédito e cobrança exigem revisão humana.
- Ferramentas devem usar escopos mínimos, allowlists e egress controlado. Sem execução de código arbitrário por prompt.
- Dados externos, REA, documentos, OCR, logs, páginas e solicitações de usuários finais são **entrada não confiável**; não podem sobrepor políticas do agente.
- Memória/corpus: redaction, autorização por tenant, respeito a retenção e direito dos titulares.
- Observabilidade de qualidade: taxa de sugestões aceitas, falsos positivos, tempo poupado e custo; todas mensuráveis.
- Em interface, marcar conteúdo gerado por IA e oferecer explicação, fonte e possibilidade de desfazer.
- Prompts, modelos, versionamento e testes de regressão documentados antes de ativar em produção.
