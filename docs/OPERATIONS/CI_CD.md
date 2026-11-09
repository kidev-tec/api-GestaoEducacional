# CI/CD e supply chain

**Disponível neste pacote:** validação de governança com Python stdlib em `.github/workflows/governance.yml`.
**Ainda não disponível:** build/lint/tests de aplicativo; não simular checks verdes.

Quando o stack for escolhido, exigir: install reprodutível, lint, typecheck, unit, integration isolados, E2E críticos, segurança de dependências, secret scanning, análise de licenças, SBOM quando aplicável, migrations dry-run, preview, artifact versionado e deployment progressivo.

Branch protection: PR obrigatório, revisão independente, status checks, CODEOWNERS definidos com pessoas reais, restrição de force push; aprovações para ambientes de produção.

CI não deve receber segredos de produção em PR não confiável. Publicações externas e deploy requerem configuração e aprovação humana.
