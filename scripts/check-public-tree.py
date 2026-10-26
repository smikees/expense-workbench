"""Check tracked source (or a clean archive) without reading ignored runtime data.

This is a publication safety net, not a substitute for human privacy review.
"""
from pathlib import Path
import re, subprocess, sys

ROOT = Path(__file__).resolve().parents[1]
if (ROOT / '.git').exists():
    names = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    paths = [ROOT / name for name in names if name]
else:
    paths = [p for p in ROOT.rglob('*') if p.is_file() and '__pycache__' not in p.parts]

bad = []
for path in paths:
    rel = path.relative_to(ROOT)
    if any(part.lower() in {'private', '.private', 'imports', 'backups', 'data', 'logs'} for part in rel.parts):
        bad.append((str(rel), 'private runtime path')); continue
    if path.name == '.env' or path.suffix.lower() in {'.sqlite', '.sqlite3', '.db', '.pem', '.key', '.pfx', '.p12', '.csv', '.pdf', '.zip', '.pyc', '.log'}:
        bad.append((str(rel), 'private/runtime file type')); continue
    if path.suffix in {'.woff2', '.png', '.jpg'}:
        continue
    text = path.read_bytes().decode('utf-8', errors='replace')
    patterns = {
        'private key': r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
        'GitHub credential': r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b',
        'possible IBAN': r'\b(?:ES|RO|DE|NL|LT|FR|GB)\d{2}[A-Z0-9]{12,30}\b',
        'machine-specific home path': r'[A-Z]:[\\/]Users[\\/][^\s]+',
        'embedded password hash': r'\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}',
    }
    for reason, pattern in patterns.items():
        if re.search(pattern, text): bad.append((str(rel), reason))
if bad:
    for path, reason in bad: print(f'{path}: {reason}', file=sys.stderr)
    sys.exit(1)
print(f'Public-tree checks passed for {len(paths)} source files; manual privacy review still required.')
