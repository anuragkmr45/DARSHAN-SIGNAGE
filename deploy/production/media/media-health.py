#!/usr/bin/env python3
import json
import importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location('host_witness', Path(__file__).with_name('host-witness.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
try:
    meta = json.loads(Path('role.json').read_text())
    root = Path(meta['private_root'])
    secret = module.private_bytes(root / 'media' / 'control-secret', 1000).decode().strip()
    health = module.https_json(meta['control_url'] + '/internal/health', secret, root / 'host' / 'site-ca.crt')
    authority = json.loads(module.private_bytes(root / 'media' / 'authority.json', 1000))
    if (health.get('status') != 'ready' or health.get('authority_mode') != 'backend'
            or health.get('protocol_version') != 1 or health.get('authority_epoch') != authority['epoch_id']
            or not health.get('accepting_new_runs') or health.get('isolation_complete')):
        raise ValueError('MEDIA_NOT_READY')
    print('Verified HTTPS media health, backend authority epoch and admission headroom. This is not frame/audio/load acceptance.')
except Exception as error:
    print('Media health rejected: ' + type(error).__name__)
    raise SystemExit(1)
