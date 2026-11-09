# Política de autonomia dos agentes — v1

## Níveis de autonomia

- **A0 — Ler:** examinar docs, backlog, testes, código e artefatos locais; permitido dentro do workspace autorizado.
- **A1 — Planejar:** criar planos, diagramas, protótipos offline e simulações sintéticas; permitido com logs.
- **A2 — Implementar local:** editar branch isolada, executar testes locais, gerar PR rascunho; permitido após dependências e escopo do card.
- **A3 — Integrar:** merge em branch protegida, alterações de permissões, criação de secrets, ativação de conectores/serviços externos; requer aprovação humana e CI.
- **A4 — Operar:** deploy de produção, migrations destrutivas, movimentação financeira real, exclusão de dados, disparos externos em massa, mudanças de segurança ou observabilidade de produção; requer aprovação humana explícita específica, plano de rollback e dupla revisão onde aplicável.

O agente só pode elevar nível após aprovação documentada para uma ação concreta; autorização de um card não autoriza ações futuras. Não manipular proteções de branch nem mascarar resultados de testes para atingir gate.

## Limites para autonomia longa

- Trabalhar em **um card** por vez por agente escritor; tarefas de leitura paralelas são permitidas.
- Alteração que ultrapasse escopo ou cause impacto em módulos fora do card -> pausar e criar RFC.
- Dúvida de domínio, exigência fiscal, dados reais ou licença -> marcar BLOCKED em vez de inventar.
- Contexto saturado -> persistir handoff, não fingir memória perfeita.
- Agente implementador não pode ser único responsável pela revisão de seu próprio código.
- Proibido prometer operação em background; execução depende do agente/harness estar de fato ativo e autorizado.

## Controle de artefatos

Toda mudança deve vincular card, branch, commit, testes e evidência. Segredos, dados pessoais, credenciais, cookies, prints sem anonimização e dumps reais nunca entram em memória/PR.
