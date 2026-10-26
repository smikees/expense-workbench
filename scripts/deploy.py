"""Optional explicit-FTPS deployment. Only app assets and site configuration are sent.
Run --initialize only on a NEW remote directory; existing notes are never overwritten.
"""
import argparse, io, json, ftplib
from pathlib import Path
from workbench import ROOT, settings, local_config, ftp_connection, upload_verified, require_url

def mkdir(ftp,path):
    try:ftp.mkd(path)
    except Exception:
        previous=ftp.pwd();ftp.cwd(path);ftp.cwd(previous) # Prove it already exists.

def deploy(initial=False):
    config=settings();hosting=config.get('hosting')
    if not hosting:raise ValueError('Configure hosting first in private/settings.json.')
    origin=require_url(config['site_origin'])
    if not origin.startswith('https://'):raise ValueError('Remote deployment requires an HTTPS site origin.')
    site=ROOT/'site';webconfig=local_config();webconfig['origin']=origin
    with ftp_connection(hosting) as ftp:
        if initial:
            names=ftp.nlst()
            if any(name not in ['.','..'] for name in names):raise ValueError('Initial deployment requires an empty dedicated directory.')
        else:
            # Do not silently recreate a lost notes DB.
            ftp.voidcmd('TYPE I')
            if not ftp.size('.private/notes.sqlite'):raise ValueError('Restore the existing website notes database first.')
        mkdir(ftp,'.private');mkdir(ftp,'app');mkdir(ftp,'.private/deploy-backups')
        # Private denial must be installed before any private files.
        upload_verified(ftp,'.private/.htaccess',b'Require all denied\n')
        paths=[p for p in (site/'app').rglob('*') if p.is_file()]+[site/'index.php',site/'.htaccess']
        for path in paths:
            relative=path.relative_to(site).as_posix()
            parts=relative.split('/')[:-1]
            for index in range(1,len(parts)+1):mkdir(ftp,'/'.join(parts[:index]))
            if not initial:
                old=io.BytesIO()
                try:ftp.retrbinary('RETR '+relative,old.write)
                except ftplib.error_perm as error:
                    if not str(error).startswith('550'):raise
                else:
                    import time
                    backup='.private/deploy-backups/'+str(time.time_ns())+'-'+path.name
                    upload_verified(ftp,backup,old.getvalue())
            upload_verified(ftp,relative,path.read_bytes())
        upload_verified(ftp,'.private/config.json',json.dumps(webconfig).encode())
        if initial:
            # Read the database consistently even if the local UI is running.
            import sqlite3,tempfile
            with tempfile.TemporaryDirectory() as directory:
                backup=Path(directory)/'notes.sqlite'
                source=sqlite3.connect(site/'.private'/'notes.sqlite');dest=sqlite3.connect(backup)
                source.backup(dest);dest.close();source.close()
                upload_verified(ftp,'.private/notes.sqlite',backup.read_bytes())
    # Once hosted, the remote notes store is authoritative. Local server forwards there.
    from workbench import atomic, current_snapshot, publish
    atomic(ROOT/'site'/'.private'/'remote.json',{'origin':origin})
    publish(current_snapshot(),config)
    print('Deployment transferred. Run remote security and login checks before considering it complete.')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--initialize',action='store_true');args=p.parse_args();deploy(args.initialize)
