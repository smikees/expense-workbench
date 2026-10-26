"""Start the authenticated dashboard on loopback only."""
import argparse,json,subprocess,urllib.parse,shutil
from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--php',default=shutil.which('php') or 'php');args=p.parse_args()
config=json.loads((root/'site'/'.private'/'config.json').read_text())
origin=urllib.parse.urlparse(config['origin'])
if origin.scheme!='http' or origin.hostname!='127.0.0.1':raise SystemExit('Local server requires a loopback HTTP origin.')
subprocess.run([args.php,'-S','127.0.0.1:'+str(origin.port or 8787),'-t',str(root/'site'),str(root/'site'/'router.php')],cwd=root,check=True)
