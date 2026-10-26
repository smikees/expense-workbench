"""Run the real authenticated app against a throwaway synthetic installation."""
from pathlib import Path
import argparse,contextlib,http.cookiejar,json,re,shutil,socket,subprocess,sys,tempfile,time
import urllib.request,urllib.parse,urllib.error
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from setup import initialize

def main(php):
    count=0
    def check(value):
        nonlocal count
        assert value;count+=1
    with tempfile.TemporaryDirectory(prefix='expense-workbench-test-') as directory:
        root=Path(directory);shutil.copytree(ROOT/'site',root/'site',ignore=shutil.ignore_patterns('.private'))
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        with contextlib.redirect_stdout(__import__('io').StringIO()):initialize(root,php,'demo-test','synthetic-test-password-only',port,True)
        log=(root/'server.log').open('wb')
        proc=subprocess.Popen([php,'-S',f'127.0.0.1:{port}','-t',str(root/'site'),str(root/'site'/'router.php')],stdout=log,stderr=log)
        origin=f'http://127.0.0.1:{port}';jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        def call(path,data=None,headers=None,opener=client):
            req=urllib.request.Request(origin+path,data=data,headers=headers or {})
            try:
                with opener.open(req,timeout=5) as response:return response.status,response.read(),response.headers
            except urllib.error.HTTPError as error:return error.code,error.read(),error.headers
        try:
            for _ in range(30):
                try:code,body,headers=call('/login');break
                except urllib.error.URLError:time.sleep(.1)
            else:raise RuntimeError('Test server did not start.')
            check(code==200);check(call('/api/data')[0]==401)
            check(b'service_token' not in call('/.private/config.json')[1])
            csrf=re.search(rb'name="csrf" value="([a-f0-9]+)"',body)[1].decode()
            form=urllib.parse.urlencode({'csrf':csrf,'username':'demo-test','password':'synthetic-test-password-only'}).encode()
            code,body,headers=call('/login',form);check(code==200 and b'Monthly overview' in body)
            check(call('/.private/config.json')[0]==404)
            check(call('/app/notes.php')[0]==404)
            data=json.loads(call('/api/data')[1]);check(len(data['transactions'])==48)
            check(call('/style.css')[0]==200);check(call('/category-icons/cart-24-regular.svg')[0]==200)
            check(call('/vendor/chart.umd.js')[0]==200)
            payload=json.dumps({'transaction_id':1,'version':0,'text':'Synthetic restaurant context'}).encode()
            headers={'Content-Type':'application/json','X-Expenses-Notes':'1','Origin':origin}
            check(call('/api/notes',payload,{**headers,'Origin':'https://example.invalid'})[0]==403)
            code,body,_=call('/api/notes',payload,headers);check(code==200);check(json.loads(body)['note']['version']==1)
            check(call('/api/notes',payload,headers)[0]==409)
            data=json.loads(call('/api/data')[1]);check(data['transactions'][0]['note']['text']=='Synthetic restaurant context')
            check(call('/transactions/1')[0]==200)
            check(call('/api/sync/notes')[0]==401)
            config=json.loads((root/'site'/'.private'/'config.json').read_text())
            service={'Authorization':'Bearer '+config['service_token']}
            exported=json.loads(call('/api/sync/notes',headers=service)[1]);check(len(exported['revisions'])==1)
            ack=json.dumps({'transaction_id':1,'version':1,'text':'','reviewed':True}).encode()
            code,body,_=call('/api/sync/notes',ack,{**service,'Content-Type':'application/json'})
            check(code==200 and json.loads(body)['note']['status']=='reviewed')
            check(call('/api/sync/notes',ack,{**service,'Content-Type':'application/json'})[0]==409)
            # New note content is still visible after review and server restart.
            proc.terminate();proc.wait(timeout=10)
            proc=subprocess.Popen([php,'-S',f'127.0.0.1:{port}','-t',str(root/'site'),str(root/'site'/'router.php')],stdout=log,stderr=log)
            time.sleep(.3)
            exported=json.loads(call('/api/sync/notes',headers=service)[1]);check(len(exported['revisions'])==2)
            print(f'{count} local HTTP/auth/note persistence checks passed.')
        finally:
            proc.terminate();proc.wait(timeout=10);log.close()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--php',default=shutil.which('php') or 'php');main(p.parse_args().php)
