# Matriz de stories para componentes críticos

| Componente | Estados obrigatórios |
|---|---|
| DataTable | loading, data, empty, error, sorted, selected, keyboard, pagination |
| MoneyInput | valid, invalid, disabled, locale, readonly, precision edge cases |
| EnrollmentForm | blank, validation errors, pending, server error, success, readonly |
| RoleGate | allowed, denied, pending, forbidden, entitlement expired |
| ConfirmDialog | open, closed, escape, focus-trap, destructive review |
| ModuleCard | active, trial, suspended, unavailable, readonly |
| AsyncWorkflow | idle, running, paused, retrying, completed, failed |
| Toast/Alert | info, warning, error, success, accessible live regions |

Todos os estados em temas claro/escuro e acessibilidade de teclado; visual baselines revisadas. Usar MSW apenas para teste de frontend; regras reais testadas no backend.
