#!/usr/bin/env python3
"""Dependency-free governance validator. Does NOT run the application."""
from pathlib import Path
import json, re, sys

R=Path(__file__).resolve().parents[1]
errors=[]
required=['README.md','ARCHITECTURE.md','DESIGN.md','PLAN.md','MOC.md','SPEC-DRIVEN-DEVELOPMENT.md','AGENTS.md',
          'docs/ARCHITECTURE/PLATFORM_STRATEGY.md','docs/GOVERNANCE/QUALITY_GATES_100.md',
          'docs/TESTING/TEST_STRATEGY.md','docs/BRAND/BRAND_BOOK.md',
          'docs/RESEARCH/SCOPE_AUTHORIZATION.md','docs/SECURITY/SECURITY_BASELINE.md',
          'specs/traceability.json']
for fn in required:
    if not (R/fn).is_file(): errors.append('MISSING REQUIRED: '+fn)
try:
    cards=json.loads((R/'backlog/CARDS-DADOS.json').read_text(encoding='utf8'))
    trace=json.loads((R/'specs/traceability.json').read_text(encoding='utf8'))['cards']
except Exception as e:
    print('FAIL: Cannot parse backlog/traceability:',e);sys.exit(1)
ids=[c['ID'] for c in cards]
if len(ids)!=123 or len(set(ids))!=len(ids): errors.append('EXPECTED 123 UNIQUE CARDS, got '+str(len(ids)))
if len(trace)!=123 or {t['card_id'] for t in trace}!=set(ids):errors.append('TRACEABILITY mismatch')
for c in cards:
    ident=c['ID']
    for fn in (f'cards/{ident}.md',f'specs/cards/{ident}.md'):
        p=R/fn
        if not p.is_file():errors.append('MISSING '+fn)
        elif ident not in p.read_text(encoding='utf8'):errors.append('MISSING ID '+fn)
allowed={'DRAFT','IN_REVIEW','APPROVED','IMPLEMENTING','VERIFYING','ACCEPTED','SUPERSEDED'}
for p in (R/'specs/cards').glob('*.md'):
    body=p.read_text(encoding='utf8')
    m=re.search(r'^- \*\*Status:\*\* ([A-Z_]+)',body,re.M)
    if not m or m.group(1) not in allowed:
        errors.append('INVALID SPEC STATUS: '+str(p.relative_to(R)))
        continue
    if m.group(1) in {'APPROVED','IMPLEMENTING','VERIFYING','ACCEPTED'}:
        for stamp in ['**Approver:**','**Approval evidence:**','**Approved version:**']:
            if stamp not in body: errors.append('MISSING APPROVAL METADATA: '+str(p.relative_to(R))+' '+stamp)
for f in (R/'MOC.md', R/'README.md', R/'ARCHITECTURE.md', R/'DESIGN.md'):
    if f.exists():
        text=f.read_text(encoding='utf8')
        # Validate all inline relative Markdown links (no internet/anchors).
        for target in re.findall(r'\]\(([^)]+)\)', text):
            target=target.split('#',1)[0]
            if target and not re.match(r'^[a-z]+://', target) and not (f.parent/target).exists():
                errors.append('BROKEN LINK '+str(f.relative_to(R))+' -> '+target)
if errors:
    print('FAIL: '+str(len(errors))+' governance issues')
    for e in errors:print(' -',e)
    sys.exit(1)
print(f'PASS: documents present; {len(ids)} cards and {len(trace)} draft specs mapped; no missing MOC links')
print('NOTE: app unit/integration/E2E/coverage/security tests have NOT been run by this validator')
