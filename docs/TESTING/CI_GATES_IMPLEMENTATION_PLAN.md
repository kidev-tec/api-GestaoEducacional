# Plan para ativar gates reais no monorepo

## Bootstrap

1. Criar workspace, scripts nomeados e lockfile reproduzível.
2. Criar estrutura `packages/domain`, `packages/api-contract`, `packages/ui`, `apps/api`, `apps/web` conforme ADR.
3. Adicionar Vitest e config baseada em `templates/vitest.config.example.ts`; comprovar que um arquivo novo não testado faz CI falhar.
4. Ativar OpenAPI lint + Orval e exigir geração sem diff pendente.
5. Ativar Storybook + testes de interação + visual diff e fluxos Playwright P0.
6. Acionar Testcontainers PostgreSQL e isolar dados por build/test.
7. Ativar scans SAST/dependências/segredos e proteger branch.
8. Adicionar job de auditoria de matriz P0: comparar cenários propostos/ativos com IDs de testes marcados P0; falhar se algum P0 obrigatório estiver sem automação.
9. Homologar pipeline com falhas propositalmente inseridas e removidas (mutation de CI); registrar evidência.

## Não aprovado como PASS antes de existir código

A workflow real disponível neste kit verifica somente documentação. `templates/github-actions/quality-gates.example.yml` é **exemplo**, não um check ativo. Habilitar no GitHub somente após validar localmente e no PR do scaffold. Assim evitamos um CI “verde” que ainda não testa nada de aplicação.
