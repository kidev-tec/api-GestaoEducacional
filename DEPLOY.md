# Deploy — ERP Platform (Hostinger + Caddy + Docker)

> Decisão Rafael 10/11/2026. **Não commitar `.env`** (só `.env.example`).

## Arquivos
- `Dockerfile.api` — multi-stage (deps → build → runtime), usuário não-root, healthcheck `/health`
- `docker-compose.yml` — postgres 17 + api + caddy (TLS automático)
- `Caddyfile` — reverse proxy + security headers

## Deploy na Hostinger (passo a passo)
```bash
# 1. No servidor (com docker + compose instalados)
git clone <repo> erp && cd erp

# 2. Env (NUNCA no git)
cat > .env <<'EOF'
POSTGRES_DB=erp
POSTGRES_USER=erp
POSTGRES_PASSWORD=<senha-forte>
EOF
chmod 600 .env

# 3. Ajustar Caddyfile com o domínio real (DNS → apontando pro IP do VPS)

# 4. Subir
docker compose up -d --build
docker compose logs -f api   # migrations rodam no boot; /health deve responder

# 5. Validar
curl -s https://erp.seudominio.com/health
```

## Staging
Mesmo compose; trocar domínio no Caddyfile (ex.: `erp-stg.seudominio.com`) e usar outro volume/pgdata.

## Rollback
`docker compose down && git checkout <tag anterior> && docker compose up -d --build`

## Notas
- Migrations são idempotentes (001..007) — boot re-roda sem quebrar.
- Backup: `docker compose exec db pg_dump -U erp erp > backup.sql` (cron no host).
- Desktop (Electron) NÃO vai pro Docker — distribuição segue por instaladores (AppImage/EXE).
