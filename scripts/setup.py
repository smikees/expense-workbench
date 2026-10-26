"""Initialize a new local installation. Never run inside the distributed template."""
from pathlib import Path
import argparse, getpass, json, secrets, subprocess, shutil, datetime, os

ROOT = Path(__file__).resolve().parents[1]

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    try: path.chmod(0o600)
    except OSError: pass

def groups():
    return [dict(id=i,label=n,color=c,description=d) for i,n,c,d in [
        ('fixed','Fixed','#1e6581','Rent, child support and utilities'),
        ('food','Food','#458363','Groceries, restaurants and order in'),
        ('subscriptions','Subscriptions','#8560a8','Confirmed subscriptions'),
        ('shopping','Shopping','#c18838','Shopping, clothing and electronics'),
        ('other','Other','#7b8b95','Other expenses')]]

def empty_snapshot():
    today=datetime.date.today().isoformat()
    return {'transactions':[], 'accounts':[], 'meta':{
        'hosted':True,'read_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'scope_start':today,'imported_through':today,'account_imported_through':{},
        'coverage_summary':'No real transactions imported yet.','spending_groups':groups(),
        'bank_sync':{'status':'not configured','schedule':'Automatic sync not configured','feeds':[]},
        'coverage':[],'loans':[],'backup':None}}

def demo_snapshot():
    data=empty_snapshot();rows=[];index=0
    for month in ['2025-01','2025-02','2025-03']:
        for day,name,category,amount,kind,group in [
            (1,'Example property manager','Rent',90000,'expense','fixed'),
            (3,'Example market','Groceries',12530,'expense','food'),
            (6,'Example bistro','Restaurants',4820,'expense','food'),
            (9,'Example takeaway','Orders',2350,'expense','food'),
            (10,'Example broadband','Internet',3000,'expense','fixed'),
            (11,'Example energy','Electricity',6800,'expense','fixed'),
            (12,'Example heating','Heating',2700,'expense','fixed'),
            (13,'Example water','Water',1900,'expense','fixed'),
            (14,'Example software','Software & AI',1800,'expense','subscriptions'),
            (15,'Example rail','Train',4200,'expense','other'),
            (16,'Example hotel','Hotels',13500,'expense','other'),
            (17,'Example shop','Shopping',5900,'expense','shopping'),
            (18,'Example shop','Shopping',1200,'refund','shopping'),
            (20,'Unidentified example','Uncategorized',1500,'expense','other'),
            (22,'Example contribution','Household contributions',5000,'income',None),
            (23,'Own savings','Transfer',10000,'transfer',None)]:
            index+=1;value=amount+(int(month[-2:])-1)*50 if kind=='expense' else amount
            rows.append(dict(id=index,group_id=index,date=f'{month}-{day:02}',
                type='deposit' if kind in ['income','refund'] else 'transfer' if kind=='transfer' else 'withdrawal',
                description='Entirely fictional demonstration entry',merchant=name,account_id=1,
                account='Demo current EUR',category=category,amount=value,currency='EUR',
                eur_amount=value,kind=kind,spending_group=group,source_id=1,destination_id=2,
                source='Demo current EUR',destination='Demo savings EUR',destination_amount=value,
                destination_currency='EUR',refund=kind=='refund',logo=None,
                recurring={'name':'Example software','kind':'subscription'} if group=='subscriptions' else None,
                review='What was this example payment for?' if category=='Uncategorized' else None,
                rule='Synthetic demo',note={'text':'','version':0,'status':'empty','updated_at':None}))
    data['transactions']=rows;data['accounts']=[{'id':1,'name':'Demo current EUR'},{'id':2,'name':'Demo savings EUR'}]
    data['meta'].update(scope_start='2025-01-01',imported_through='2025-03-23',
        coverage_summary='DEMO — all amounts, accounts and merchants are fictional.',
        coverage=[{'account':'Demo accounts','status':'Synthetic example only','warning':False}])
    return data

def initialize(root,php,username,password,port=8787,demo=False):
    private=root/'site'/'.private'
    if private.exists(): raise RuntimeError('This installation is already initialized. Refusing to overwrite it.')
    if not username or len(password)<12: raise ValueError('Choose a username and a password of at least 12 characters.')
    # Password goes through stdin, never command arguments or console output.
    result=subprocess.run([php,'-r','echo password_hash(stream_get_contents(STDIN), PASSWORD_DEFAULT);'],
        input=password,text=True,capture_output=True,check=True)
    password_hash=result.stdout.strip()
    if not password_hash.startswith('$'): raise RuntimeError('Password hashing failed.')
    private.mkdir(parents=True,mode=0o700)
    (private/'.htaccess').write_text('Require all denied\n',encoding='utf-8')
    write_json(private/'config.json', {'origin':f'http://127.0.0.1:{port}','timezone':'UTC',
        'users':{username:password_hash},'dummy_hash':password_hash,'service_token':secrets.token_urlsafe(48)})
    subprocess.run([php,'-r',"$db=new SQLite3($argv[1]);$db->exec('CREATE TABLE notes (transaction_id INTEGER PRIMARY KEY, text TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL)');$db->exec('CREATE TABLE revisions (transaction_id INTEGER NOT NULL, version INTEGER NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL, author TEXT NOT NULL, PRIMARY KEY(transaction_id,version))');$db->close();",str(private/'notes.sqlite')],check=True)
    write_json(private/'ledger-00000000.json',demo_snapshot() if demo else empty_snapshot())
    # Worker secrets live outside the web tree and are NEVER deployed.
    worker=root/'private';worker.mkdir(mode=0o700)
    write_json(worker/'settings.json',{'firefly_url':'http://127.0.0.1:8080','firefly_token':'',
        'scope_start':datetime.date.today().replace(day=1).isoformat(),'timezone':'UTC',
        'site_origin':f'http://127.0.0.1:{port}','mode':'demo' if demo else 'live',
        'import_jobs':[],'import_jobs_verified':False,'hosting':None,
        'rules':[],'overrides':{}})
    print(f'Initialized. Open http://127.0.0.1:{port} after starting the server. No bank has been connected.')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--php',default=shutil.which('php') or 'php')
    parser.add_argument('--user',default='owner');parser.add_argument('--port',type=int,default=8787)
    parser.add_argument('--demo',action='store_true');args=parser.parse_args()
    initialize(ROOT,args.php,args.user,getpass.getpass('Choose dashboard password (12+ characters): '),args.port,args.demo)
