# Acessibilidade, visual regression e desempenho

## Storybook

Cada componente base descreve estados `default/hover/focus/disabled/loading/error/empty/success` quando aplicáveis; light/dark, teclado e data density. Stories com dados sintéticos. Play functions verificam comportamentos (sem forçar clicks em elementos que deveriam ser inacessíveis).

## Regressão visual

Snapshots estáveis com fonte, relógio, viewport e animações controladas. Nenhuma aprovação automática de baseline após alterações de design. Mudança legítima requer diff revisado e justificativa. Preferir teste por componente para minimizar flakiness.

## A11y

WCAG 2.2 AA no fluxo crítico: foco, teclado, nomes acessíveis, descrição de erro, contraste, zoom e reflow. `axe` detecta uma parte dos problemas; revisão humana com teclado e leitor de tela é obrigatória antes de piloto.

## Performance

Medição de LCP/INP/CLS, p95 das APIs e operações críticas em ambiente representativo. Definir orçamento e SLO com baseline da escola piloto; pré-definir que degradações estatisticamente significativas bloqueiam regressões. Não exigir nota Lighthouse 100 em ambiente de CI de forma cega por variabilidade de laboratório.
