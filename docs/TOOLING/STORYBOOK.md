# Storybook — catálogo e contrato de UX

## Por que usar

Design system compartilhado entre módulos/verticais; telas operacionais densas requerem consistência, acessibilidade e prevenção de regressão. Storybook documenta variantes e estados; play functions podem testar interações, e testes visuais podem comparar snapshots.

## Requisitos por componente

- Story `Default` e todos os estados relevantes (error, empty, loading, disabled, keyboard focus).
- Suporte a light/dark e zoom sem perda de semântica; uso de tokens, não cores arbitrárias.
- Interações com `play` onde houver validação, teclado e callback.
- a11y rules e revisão humana para formulários, modais, tabelas e navegação.
- Snapshots visuais controlados; PR que muda baseline exige aprovação design/reviewer.
- `*.stories.tsx` não deve acessar serviços reais nem PII.

## Organização sugerida

`packages/ui/src/` é library; `apps/web/` usa UI; `packages/ui/.storybook` expõe catálogo. Storybook **não** substitui Playwright E2E ponta a ponta nem testes das regras de autorização do backend.
