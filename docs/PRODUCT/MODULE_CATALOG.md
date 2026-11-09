# Catálogo de módulos vendáveis — proposta

**Princípio:** core compartilhado não pode ser uma opção que cliente desliga; módulos são produtos sobre um domínio e segurança comuns.

| Área | Contém | Licenciamento proposto | Pré-requisito |
|---|---|---|---|
| Core | organização, unidades, pessoas, identidades, permissões, auditoria | incluso | nenhum |
| Admissões & CRM | leads, funis, campanhas, proposta, conversão | adicional | Core |
| Secretaria | matrículas, turmas, documentos, contratos | principal | Core |
| Financeiro | contas a receber/pagar, cobrança, conciliação | adicional | Core + Secretaria* |
| Acadêmico | turmas, calendário, frequência, avaliações | adicional | Core + Secretaria |
| Comunicação | templates, notificações e eventos multicanal | adicional | Core |
| Portais | aluno, responsável e docentes | adicional | Core + módulos de dados respectivos |
| BI & Automações | indicadores, receitas e motor de workflow | adicional | Core e eventos relevantes |
| Integrações | APIs, webhooks, importadores e conectores | por plano/volume | Core |

\* O financeiro pode ser vendido de maneira independente para contas não relacionadas a matrículas, mas cobranças educacionais dependem de contratos.

## Regras de entitlements

- Checagem **server-side** a cada caso de uso; UI apenas comunica disponibilidade.
- Chave por tenant, plano, módulo, vigência, unidade e limites explícitos; decisões auditáveis.
- Suspensão de módulo não deve apagar dados; exportação e políticas de retenção permanecem.
- Upgrade/downgrade, trials, cobranças e inadimplência exigem estados e testes de transição.
- Feature flags não equivalem a licença, nem substituem RBAC/ABAC.
