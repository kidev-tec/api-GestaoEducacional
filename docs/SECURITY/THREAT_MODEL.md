# Threat model inicial (a completar em E04-01)

## Ativos

Dados de alunos e responsáveis, financeiro e contratos, credenciais, registros pedagógicos, arquivos, eventos, chaves de integração e trilha de auditoria.

## Fronteiras

Browser ↔ API; autenticação ↔ tenancy; API ↔ banco/cache/storage; serviços internos ↔ gateways; workers ↔ filas; integração ↔ webhooks; IA ↔ ferramentas e documentos externos.

## Ameaças iniciais

Cross-tenant read/write, IDOR/BOLA, privilege escalation, sessão roubada, logs vazando PII, reprocessamento financeiro duplicado, webhook forjado, exportação massiva, arquivo malicioso, prompt injection, supply chain comprometida, restauração que quebra segregação, abuso de configuração de receitas.

## Planos de mitigação

Identity policy por caso de uso; testes negativos; princípios de privilégio mínimo e segregação; criptografia; validação do servidor; assinaturas de webhook; idempotência; proteção de upload; redaction; revisão de dependências; limites nas ferramentas de IA; isolamento de ambiente.

Toda ameaça deve ganhar `ID`, probabilidade/impacto, proprietário, controle, caso de teste, evidência e risco residual.
