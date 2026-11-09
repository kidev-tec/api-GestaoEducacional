# G6b — Evidências (2026-11-09)

## Entregáveis (apps/desktop/release/)
- `ERP Platform-0.1.0.AppImage` (125 MB) — Linux portátil
- `erp-desktop_0.1.0_amd64.deb` (101 MB) — Debian/Mint/Ubuntu (deps libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6)
- `linux-unpacked/` — binário direto (usado no smoke)

## Gates
- Unit main (lib.ts): 12/12, coverage 100×4 perFile (resolveTargetUrl 5 cenários, isAllowedUrl 4 grupos)
- Preload: 3 testes de superfície (só erpDesktop version/platform; sem ipcRenderer/fs/child_process/process)
- tsc clean; web build OK (base './' relativo para file://)
- Smoke E2E real: Electron abre em Xvfb, carrega dist do web, UI COMPLETA renderizada (screenshot desktop-window.png, verificado por visão: header, tabs teal, form, estado vazio)
- electron-builder: deb + AppImage gerados, metadata deb validada (dpkg-deb -I)
- Segurança no código do main: contextIsolation true, nodeIntegration false, sandbox true, will-navigate restrito a localhost/127.0.0.1/file, links externos vão pro browser do sistema

## Bugs achados no smoke
1. dist do web usava paths absolutos `/assets/...` → não carrega em file:// → fix `base: './'` no vite.config do web
2. electron range version quebra electron-builder → pinned 45.2.3
3. name com escopo @erp quebrava fpm → renomeado erp-desktop
