"""Local maintenance worker: Firefly read adapter, publication and website-note review.

Bank authentication belongs to the official importer. This worker only GETs Firefly.
Import jobs are explicit owner-approved argv arrays, never commands from notes.
"""
from pathlib import Path
from contextlib import contextmanager
import argparse, datetime as dt, decimal, ftplib, hashlib, io, json, os, re, shutil
import signal, ssl, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from setup import empty_snapshot, write_json

ROOT=Path(__file__).resolve().parents[1]
D=decimal.Decimal

def now(): return dt.datetime.now(dt.timezone.utc).isoformat()
def read(path, default=None):
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else default
def atomic(path,value):
    temp=path.with_name(path.name+'.tmp');write_json(temp,value);os.replace(temp,path)
def settings(): return read(ROOT/'private'/'settings.json')
def local_config(): return read(ROOT/'site'/'.private'/'config.json')
def require_url(url):
    p=urllib.parse.urlparse(url)
    if p.username or p.password or p.query or p.fragment: raise ValueError('URL must not contain credentials, query or fragment.')
    if p.scheme!='https' and not (p.scheme=='http' and p.hostname in ['127.0.0.1','localhost','::1']):
        raise ValueError('Use HTTPS except for loopback development.')
    return url.rstrip('/')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): raise RuntimeError('Unexpected redirect; credentials were not forwarded.')

def request(url, token=None, body=None):
    # HTTPS uses the platform's validating CA store. No unverified fallback.
    headers={'Accept':'application/json','User-Agent':'ExpenseWorkbench/1.0'}
    if token: headers['Authorization']='Bearer '+token
    if body is not None: headers['Content-Type']='application/json'
    req=urllib.request.Request(url,data=json.dumps(body).encode() if body is not None else None,headers=headers)
    opener=urllib.request.build_opener(NoRedirect())
    for attempt in range(3 if body is None else 1):
        try:
            with opener.open(req,timeout=30) as response:
                raw=response.read(32*1024*1024+1)
                if len(raw)>32*1024*1024: raise ValueError('Response too large.')
                return json.loads(raw)
        except urllib.error.HTTPError as error:
            if body is not None or error.code not in [429,500,502,503,504] or attempt==2: raise
        except (TimeoutError,urllib.error.URLError):
            if body is not None or attempt==2: raise
        time.sleep(2**attempt)

@contextmanager
def locked():
    path=ROOT/'private'/'worker.lock';path.parent.mkdir(exist_ok=True)
    with path.open('a+b') as f:
        f.seek(0);f.write(b'0');f.flush();f.seek(0)
        if os.name=='nt':
            import msvcrt
            msvcrt.locking(f.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(f.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        try: yield
        finally:
            f.seek(0)
            if os.name=='nt': msvcrt.locking(f.fileno(),msvcrt.LK_UNLCK,1)
            else: fcntl.flock(f.fileno(),fcntl.LOCK_UN)

def pages(endpoint,config):
    base=require_url(config['firefly_url']);token=config['firefly_token']
    if not token: raise ValueError('Configure a Firefly token in private/settings.json first.')
    out=[];deadline=time.monotonic()+180
    for page in range(1,1001):
        if time.monotonic()>deadline:raise TimeoutError('Firefly read budget exhausted.')
        separator='&' if '?' in endpoint else '?'
        data=request(base+endpoint+separator+urllib.parse.urlencode({'page':page,'limit':100}),token)
        out.extend(data['data'])
        if page>=int(data['meta']['pagination']['total_pages']): return out
    raise RuntimeError('Pagination exceeded the safety limit; previous snapshot preserved.')

def cents(value):
    number=D(str(value))
    if not number.is_finite() or number<0 or number*100!=(number*100).to_integral_value():
        raise ValueError('Unsupported monetary precision or amount.')
    return int(number*100)

def group(row):
    c=row['category']
    if row['kind'] not in ['expense','refund']: return None
    if c in ['Rent','Child support','Utilities','Internet','Electricity','Heating','Water']:return 'fixed'
    if c in ['Food','Groceries','Restaurants','Orders']:return 'food'
    if c=='Subscriptions' or (row.get('recurring') or {}).get('kind')=='subscription':return 'subscriptions'
    if c in ['Shopping','Clothing','Electronics','Digital purchases']:return 'shopping'
    return 'other'

def normalize(tx,group_id,config):
    kind={'withdrawal':'expense','deposit':'income','transfer':'transfer','opening balance':'opening'}.get(tx['type'])
    if kind is None: raise ValueError('Unsupported transaction type.')
    date=tx['date'][:10];dt.date.fromisoformat(date)
    if int(tx.get('currency_decimal_places',2))!=2: raise ValueError('This starter supports two-decimal currencies only.')
    ident=int(tx['transaction_journal_id']);source=int(tx['source_id']);dest=int(tx['destination_id'])
    if ident<1:raise ValueError('Invalid stable journal ID.')
    incoming=kind=='income';category=tx.get('category_name') or 'Uncategorized'
    row=dict(id=ident,group_id=int(group_id),date=date,type=tx['type'],kind=kind,
        description=tx['description'],merchant=tx['source_name'] if incoming else tx['destination_name'],
        account_id=dest if incoming else source,account=tx['destination_name'] if incoming else tx['source_name'],
        source_id=source,destination_id=dest,source=tx['source_name'],destination=tx['destination_name'],
        amount=cents(tx['amount']),currency=tx['currency_code'],category=category,
        destination_amount=cents(tx.get('foreign_amount') or tx['amount']),
        destination_currency=tx.get('foreign_currency_code') or tx['currency_code'],
        logo=None,recurring=None,refund=False,rule='Firefly category',review=None)
    tags=tx.get('tags') or []
    if incoming and 'refund' in tags:row.update(kind='refund',refund=True)
    # Exact/substring mappings only: no arbitrary expression evaluation or note commands.
    for rule in config.get('rules',[]):
        match=rule.get('match','').casefold()
        if match and match in (row['merchant']+' '+row['description']).casefold():
            for key in ['category','merchant','recurring','logo']:
                if key in rule:row[key]=rule[key]
    override=config.get('overrides',{}).get(str(ident),{})
    for key in ['category','merchant','recurring','review','logo']:
        if key in override:row[key]=override[key]
    if 'refund' in override:
        if row['type']!='deposit':raise ValueError('Refund override requires an incoming deposit.')
        row.update(refund=bool(override['refund']),kind='refund' if override['refund'] else 'income')
    if row['category']=='Uncategorized' and 'review' not in override:row['review']='Please clarify the purpose of this transaction.'
    row['spending_group']=group(row)
    return row

def fingerprint(row):
    return {k:row.get(k) for k in ['date','type','amount','currency','source_id','destination_id','destination_amount','destination_currency','description']}

def reconcile(previous, fresh):
    """Keep financial revisions separate. Never drop a previously published row."""
    saved={r['id']:r for r in previous};result=[];proposals={};seen=set()
    for row in fresh:
        ident=row['id']
        if ident in seen:raise ValueError('Duplicate journal identity in Firefly response.')
        seen.add(ident);old=saved.get(ident)
        if old and fingerprint(old)!=fingerprint(row):
            proposals[str(ident)]={'saved':fingerprint(old),'proposed':fingerprint(row)}
            row=dict(old);row['review']='Source entry changed. Original values retained; review the protected proposal before accepting a correction.'
        result.append(row)
    for ident,old in saved.items():
        if ident not in seen:
            row=dict(old);row['review']='This saved entry was absent from the latest Firefly read. Review before removing.'
            result.append(row);proposals[str(ident)]={'saved':fingerprint(old),'proposed':None}
    return result,proposals

def rates_for(rows):
    cache_path=ROOT/'private'/'ecb-rates.json';cache=read(cache_path,{'rates':{}})
    if all(r['currency']=='EUR' for r in rows):return {}
    if time.time()-cache.get('fetched_at',0)>3600:
        try:
            url='https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml'
            with urllib.request.urlopen(url,timeout=30) as response:doc=ET.fromstring(response.read(16*1024*1024))
            for node in doc.iter():
                if 'time' in node.attrib:
                    cache['rates'][node.attrib['time']]={child.attrib['currency']:child.attrib['rate'] for child in node}
            cache['fetched_at']=time.time();atomic(cache_path,cache)
        except (OSError,ET.ParseError):
            # Complete valid older rates are sufficient. Missing dates still fail below.
            pass
    return cache['rates']

def value_eur(row,rates):
    if row['currency']=='EUR':return dict(row,eur_amount=row['amount'],fx={'currency_per_eur':'1','rate_date':row['date']})
    day=dt.date.fromisoformat(row['date'])
    for offset in range(11):
        date=(day-dt.timedelta(days=offset)).isoformat();rate=rates.get(date,{}).get(row['currency'])
        if rate and D(rate)>0:
            value=int((D(row['amount'])/D(rate)).quantize(D('1'),rounding=decimal.ROUND_HALF_UP))
            return dict(row,eur_amount=value,fx={'currency_per_eur':str(rate),'rate_date':date})
    raise ValueError('Missing historical FX valuation; preserving the previous snapshot.')

def current_snapshot():
    paths=sorted((ROOT/'site'/'.private').glob('ledger-*.json'),reverse=True)
    if not paths:raise RuntimeError('No initialized snapshot.')
    return read(paths[0])

def snapshot(config,status):
    previous=current_snapshot()
    if config.get('mode')=='demo':raise ValueError('Set mode=live and choose scope_start before importing. Demo is separate.')
    accounts=pages('/api/v1/accounts?type=asset',config)
    groups=pages('/api/v1/transactions?'+urllib.parse.urlencode({'start':config['scope_start']}),config)
    fresh=[];held=[];valid_ids=set()
    for entry in groups:
        for tx in entry['attributes']['transactions']:
            try:
                row=normalize(tx,entry['id'],config);fresh.append(row);valid_ids.add(row['id'])
            except (ValueError,KeyError,TypeError,decimal.InvalidOperation):
                held.append({'group_id':entry['id'],'reason':'Unsupported or malformed posting; inspect Firefly.'})
    prior=[] if previous['meta'].get('demo') or 'DEMO' in previous['meta'].get('coverage_summary','') else previous['transactions']
    rows,proposals=reconcile(prior,fresh)
    atomic(ROOT/'private'/'source-proposals.json',proposals)
    atomic(ROOT/'private'/'held-entries.json',held)
    rates=rates_for(rows);rows=[value_eur(row,rates) for row in rows]
    data=empty_snapshot();data['transactions']=rows
    data['accounts']=[{'id':int(a['id']),'name':a['attributes']['name']} for a in accounts]
    today=dt.date.today().isoformat();latest=max([r['date'] for r in rows],default=config['scope_start'])
    data['meta'].update(scope_start=config['scope_start'],timezone=config.get('timezone','UTC'),
        imported_through=latest,coverage_summary='Saved Firefly activity. Latest transaction date does not prove complete bank coverage.',
        coverage=[{'account':a['name'],'status':'Read from Firefly; verify coverage against the source statement.','warning':False} for a in data['accounts']])
    data['meta']['bank_sync']={'status':'partial' if held or proposals or status.get('failed_jobs') else 'ok',
        'schedule':'Configured local worker; see operator schedule','finished_at':now(),
        'feeds':[{'name':'Firefly reporting adapter','status':'partial' if held else 'ok',
            'source_held':bool(held),'needs_attention':bool(held),'review_count':len(proposals),
            'last_success':now(),'imported_through':latest,'valid_until':None}]+
            [{'name':name,'status':'error','source_held':True,'needs_attention':True,'last_success':None,'imported_through':None} for name in status.get('failed_jobs',[])]}
    return data

def site_notes(config):
    origin=require_url(config['site_origin']);token=local_config()['service_token']
    state=request(origin+'/api/sync/notes',token)
    if not isinstance(state.get('notes'),list) or not isinstance(state.get('revisions'),list):raise ValueError('Invalid note state.')
    # Refuse missing or rewritten immutable remote revisions.
    old=read(ROOT/'private'/'web-notes.json',{'notes':[],'revisions':[]})
    index={(r['transaction_id'],r['version']):r for r in state['revisions']}
    for r in old['revisions']:
        if index.get((r['transaction_id'],r['version']))!=r:raise ValueError('Website note revision changed or disappeared. Restore website backup.')
    atomic(ROOT/'private'/'web-notes.json',state)
    return state

def ftp_connection(config):
    host=config['host'];ftp=ftplib.FTP_TLS(context=ssl.create_default_context(),timeout=30)
    # Host MUST be the provider's certificate-covered FTPS hostname.
    ftp.connect(host,int(config.get('port',21)));ftp.login(config['username'],config['password']);ftp.prot_p()
    ftp.cwd(config['directory']);return ftp

def upload_verified(ftp,name,payload):
    temp=name+'.uploading';ftp.storbinary('STOR '+temp,io.BytesIO(payload))
    actual=io.BytesIO();ftp.retrbinary('RETR '+temp,actual.write)
    if hashlib.sha256(actual.getvalue()).digest()!=hashlib.sha256(payload).digest():raise RuntimeError('Upload verification failed; old snapshot remains live.')
    ftp.rename(temp,name)

def publish(data,config):
    stamp=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d%H%M%S%f')
    payload=(json.dumps(data,ensure_ascii=False)+'\n').encode();name='ledger-'+stamp+'.json'
    path=ROOT/'site'/'.private'/name
    atomic(path,data)
    if config.get('hosting'):
        with ftp_connection(config['hosting']) as ftp:upload_verified(ftp,'.private/'+name,payload)
    atomic(ROOT/'private'/'publish-status.json',{'status':'ok','finished_at':now(),'snapshot':name,'sha256':hashlib.sha256(payload).hexdigest()})

def import_jobs(config):
    if config.get('import_jobs') and not config.get('import_jobs_verified'):
        raise ValueError('Verify duplicate, transfer, revision and timeout behavior before enabling scheduled import jobs.')
    failures=[]
    for job in config.get('import_jobs',[]):
        name=job['name'];argv=job['argv']
        if not isinstance(argv,list) or not all(isinstance(v,str) for v in argv):raise ValueError('Import argv must be a list.')
        log=ROOT/'private'/('job-'+hashlib.sha256(name.encode()).hexdigest()[:12]+'.log')
        with log.open('wb') as output:
            try:
                proc=subprocess.Popen(argv,cwd=ROOT,stdout=output,stderr=subprocess.STDOUT,
                    start_new_session=os.name!='nt',creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            except OSError:
                failures.append(name);continue
            try:code=proc.wait(timeout=min(900,max(30,int(job.get('timeout',180)))))
            except subprocess.TimeoutExpired:
                if os.name=='nt':subprocess.run(['taskkill','/PID',str(proc.pid),'/T','/F'],capture_output=True)
                else:os.killpg(proc.pid,signal.SIGKILL)
                proc.wait();code=-1
            if code!=0:failures.append(name)
    return failures

def sync(config):
    result={'started_at':now(),'status':'running','failed_jobs':[]};atomic(ROOT/'private'/'sync-status.json',result)
    try:
        result['failed_jobs']=import_jobs(config)
        data=snapshot(config,result);publish(data,config)
        result['status']=data['meta']['bank_sync']['status']
    except Exception as error:
        result['status']='error';result['error_type']=type(error).__name__
        raise
    finally:
        result['finished_at']=now();atomic(ROOT/'private'/'sync-status.json',result)

def review(config,changes):
    """Apply a structured, owner-authorized clarification file, not note instructions."""
    allowed={'category','merchant','refund','recurring','review'};processed=[];conflicts=[]
    if not isinstance(changes,list):raise ValueError('Changes must be a list.')
    for change in changes:
        ident=int(change['id']);version=int(change['version']);fields=change['set']
        if not isinstance(fields,dict) or set(fields)-allowed:raise ValueError('Only reporting fields may change.')
        if 'refund' in fields and not isinstance(fields['refund'],bool):raise ValueError('refund must be boolean.')
        for key in ['merchant','category','review']:
            if key in fields and fields[key] is not None and not isinstance(fields[key],str):raise ValueError('Invalid reporting field.')
        if 'recurring' in fields and fields['recurring'] is not None:
            value=fields['recurring']
            if not isinstance(value,dict) or value.get('kind') not in ['subscription','bill','candidate'] or not isinstance(value.get('name'),str):raise ValueError('Invalid recurring service.')
        notes=site_notes(config);current=next((r for r in notes['notes'] if r['transaction_id']==ident),None)
        if not current or current['version']!=version or current['status']!='pending':conflicts.append(ident);continue
        if str(ident) in read(ROOT/'private'/'source-proposals.json',{}):
            conflicts.append(ident);continue # Financial/source corrections require deliberate separate reconciliation.
        backup=ROOT/'private'/('settings-backup-'+str(time.time_ns())+'.json');shutil.copyfile(ROOT/'private'/'settings.json',backup)
        config.setdefault('overrides',{}).setdefault(str(ident),{}).update(fields)
        atomic(ROOT/'private'/'settings.json',config)
        data=snapshot(config,{});publish(data,config)
        # Publication precedes acknowledgement. POST is never blindly retried.
        try:
            request(require_url(config['site_origin'])+'/api/sync/notes',local_config()['service_token'],
                {'transaction_id':ident,'version':version,'text':'','reviewed':True})
            processed.append(ident)
        except urllib.error.HTTPError as error:
            if error.code!=409:raise
            conflicts.append(ident)
    site_notes(config)
    atomic(ROOT/'private'/'review-status.json',{'finished_at':now(),'processed':len(processed),'conflicted':len(conflicts)})
    print(json.dumps({'processed':len(processed),'conflicted':len(conflicts)}))

def pending_notes(config):
    state=site_notes(config);deferred=read(ROOT/'private'/'deferred-notes.json',{})
    return [r for r in state['notes'] if r['status']=='pending' and deferred.get(str(r['transaction_id']))!=r['version']]

def defer(config,change):
    ident=int(change['id']);version=int(change['version']);question=change['question']
    if not isinstance(question,str) or not question.strip() or len(question)>500:raise ValueError('Provide a concise question.')
    state=site_notes(config);note=next((r for r in state['notes'] if r['transaction_id']==ident),None)
    if not note or note['version']!=version:raise ValueError('Note version changed; defer was not applied.')
    shutil.copyfile(ROOT/'private'/'settings.json',ROOT/'private'/('settings-backup-'+str(time.time_ns())+'.json'))
    config.setdefault('overrides',{}).setdefault(str(ident),{})['review']=question
    atomic(ROOT/'private'/'settings.json',config);publish(snapshot(config,{}),config)
    deferred=read(ROOT/'private'/'deferred-notes.json',{});deferred[str(ident)]=version
    atomic(ROOT/'private'/'deferred-notes.json',deferred)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['sync','notes','review','publish','defer'])
    parser.add_argument('--changes',type=Path);args=parser.parse_args();config=settings()
    with locked():
        if args.command=='sync':sync(config)
        elif args.command=='notes':
            print(json.dumps(pending_notes(config),ensure_ascii=False))
        elif args.command=='review':
            if not args.changes:raise ValueError('Provide a structured --changes JSON file.')
            review(config,read(args.changes))
        elif args.command=='defer':
            if not args.changes:raise ValueError('Provide a private JSON file with id, version and question.')
            defer(config,read(args.changes))
        else:publish(current_snapshot(),config)

if __name__=='__main__':
    try:main()
    except Exception as error:
        print('Maintenance failed ('+type(error).__name__+'). Saved data was retained. Inspect private status files.',file=sys.stderr)
        sys.exit(1)
