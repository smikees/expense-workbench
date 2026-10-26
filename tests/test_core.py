"""Synthetic regression tests. No bank, network or existing installation is accessed."""
from pathlib import Path
import io,json,sys,tempfile,unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import workbench as w
from setup import demo_snapshot

def transaction(**updates):
    tx=dict(transaction_journal_id='1',type='withdrawal',date='2025-02-03T12:00:00+00:00',
        source_id='1',destination_id='2',source_name='Example current',destination_name='Example market',
        description='Synthetic grocery purchase',amount='12.34',currency_code='EUR',currency_decimal_places=2)
    tx.update(updates);return tx

class Core(unittest.TestCase):
    def test_exact_money(self):
        self.assertEqual(w.cents('12.34'),1234)
        for bad in ['-1','NaN','Infinity','0.001']:
            with self.assertRaises(ValueError):w.cents(bad)
    def test_normalization_and_refund(self):
        r=w.normalize(transaction(),1,{});self.assertEqual((r['amount'],r['kind']),(1234,'expense'))
        r=w.normalize(transaction(type='deposit',tags=['refund']),1,{})
        self.assertEqual((r['kind'],r['account_id']),('refund',2))
    def test_precision_and_dates(self):
        for change in [dict(currency_decimal_places=3),dict(date='2025-02-30'),dict(type='unknown')]:
            with self.assertRaises(ValueError):w.normalize(transaction(**change),1,{})
    def test_rules_do_not_alter_money(self):
        c={'rules':[{'match':'market','category':'Groceries','amount':1}]}
        row=w.normalize(transaction(),1,c)
        self.assertEqual((row['amount'],row['category'],row['spending_group']),(1234,'Groceries','food'))
    def test_source_change_isolated(self):
        old=w.normalize(transaction(),1,{})
        changed=w.normalize(transaction(amount='99.00'),1,{})
        new=w.normalize(transaction(transaction_journal_id='2'),1,{})
        rows,proposals=w.reconcile([old],[changed,new])
        self.assertEqual(len(rows),2);self.assertEqual(rows[0]['amount'],1234);self.assertIn('1',proposals)
    def test_identical_replay(self):
        old=w.normalize(transaction(),1,{})
        rows,proposals=w.reconcile([old],[old]);self.assertEqual(len(rows),1);self.assertFalse(proposals)
    def test_missing_and_duplicate(self):
        old=w.normalize(transaction(),1,{})
        rows,proposals=w.reconcile([old],[]);self.assertEqual(len(rows),1);self.assertTrue(proposals)
        with self.assertRaises(ValueError):w.reconcile([old],[old,old])
    def test_historical_fx(self):
        r=dict(amount=10000,currency='RON',date='2025-01-05')
        converted=w.value_eur(r,{'2025-01-03':{'RON':'5'}})
        self.assertEqual(converted['eur_amount'],2000);self.assertEqual(converted['fx']['rate_date'],'2025-01-03')
        self.assertEqual(r['amount'],10000)
        with self.assertRaises(ValueError):w.value_eur(r,{'2024-01-03':{'RON':'5'}})
    def test_encrypted_url_boundary(self):
        self.assertEqual(w.require_url('http://127.0.0.1:8787/'),'http://127.0.0.1:8787')
        for url in ['http://example.com','https://user:pass@example.com','https://example.com/?token=x']:
            with self.assertRaises(ValueError):w.require_url(url)
    def test_upload_failure_preserves_old(self):
        class FTP:
            renamed=False
            def storbinary(self,*args):pass
            def retrbinary(self,command,callback):callback(b'truncated')
            def rename(self,*args):self.renamed=True
        ftp=FTP()
        with self.assertRaises(RuntimeError):w.upload_verified(ftp,'ledger-test.json',b'complete')
        self.assertFalse(ftp.renamed)
    def test_missing_job_does_not_stop_healthy_job(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(w,'ROOT',Path(folder)):
            (Path(folder)/'private').mkdir()
            jobs=[{'name':'bad','argv':['nonexistent-workbench-test-executable']},
                  {'name':'good','argv':[sys.executable,'-c','pass']}]
            self.assertEqual(w.import_jobs({'import_jobs':jobs,'import_jobs_verified':True}),['bad'])
    def test_jobs_disabled_until_verified(self):
        with self.assertRaises(ValueError):w.import_jobs({'import_jobs':[{'name':'x','argv':['x']}]})
    def test_demo_has_no_real_sources(self):
        data=demo_snapshot();self.assertEqual(len(data['transactions']),48)
        self.assertTrue(all(r['description'].startswith('Entirely fictional') for r in data['transactions']))
    def test_remote_revision_loss_stops(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(w,'ROOT',Path(folder)),patch.object(w,'local_config',return_value={'service_token':'synthetic-test'}):
            private=Path(folder)/'private';private.mkdir()
            old={'transaction_id':1,'version':1,'text':'synthetic'}
            w.atomic(private/'web-notes.json',{'notes':[],'revisions':[old]})
            with patch.object(w,'request',return_value={'notes':[],'revisions':[]}):
                with self.assertRaises(ValueError):w.site_notes({'site_origin':'http://127.0.0.1:8787'})
            self.assertEqual(w.read(private/'web-notes.json')['revisions'],[old])
    def test_snapshot_holds_malformed_row_and_keeps_other_rows(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(w,'ROOT',Path(folder)):
            root=Path(folder);(root/'private').mkdir();(root/'site'/'.private').mkdir(parents=True)
            w.atomic(root/'site'/'.private'/'ledger-000.json',demo_snapshot())
            def pages(endpoint,config):
                if 'accounts' in endpoint:return [{'id':'1','attributes':{'name':'Example current'}}]
                return [{'id':'1','attributes':{'transactions':[transaction(),transaction(transaction_journal_id='2',amount='broken')]}}]
            with patch.object(w,'pages',side_effect=pages):
                data=w.snapshot({'mode':'live','scope_start':'2025-01-01'}, {})
            self.assertEqual(len(data['transactions']),1)
            self.assertEqual(data['meta']['bank_sync']['status'],'partial')
            self.assertTrue(data['meta']['bank_sync']['feeds'][0]['source_held'])
    def test_no_acknowledgement_when_publication_fails(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(w,'ROOT',Path(folder)):
            root=Path(folder);(root/'private').mkdir()
            config={'mode':'live','site_origin':'http://127.0.0.1:8787','overrides':{}}
            w.atomic(root/'private'/'settings.json',config)
            notes={'notes':[{'transaction_id':1,'version':2,'status':'pending'}]}
            with patch.object(w,'site_notes',return_value=notes),patch.object(w,'snapshot',return_value={}),patch.object(w,'publish',side_effect=RuntimeError('synthetic outage')),patch.object(w,'request') as request:
                with self.assertRaises(RuntimeError):w.review(config,[{'id':1,'version':2,'set':{'category':'Groceries'}}])
                request.assert_not_called()
    def test_conflicted_note_does_not_block_next(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(w,'ROOT',Path(folder)):
            root=Path(folder);(root/'private').mkdir()
            config={'mode':'live','site_origin':'http://127.0.0.1:8787','overrides':{}}
            w.atomic(root/'private'/'settings.json',config)
            notes={'notes':[{'transaction_id':1,'version':3,'status':'pending'},{'transaction_id':2,'version':1,'status':'pending'}]}
            with patch.object(w,'site_notes',return_value=notes),patch.object(w,'snapshot',return_value={}),patch.object(w,'publish'),patch.object(w,'local_config',return_value={'service_token':'test'}),patch.object(w,'request') as request,patch('builtins.print'):
                w.review(config,[{'id':1,'version':2,'set':{'category':'Groceries'}},{'id':2,'version':1,'set':{'category':'Restaurants'}}])
                self.assertEqual(request.call_count,1);self.assertEqual(request.call_args.args[2]['transaction_id'],2)
    def test_deferred_version_reappears_when_edited(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(w,'ROOT',Path(folder)):
            (Path(folder)/'private').mkdir();w.atomic(Path(folder)/'private'/'deferred-notes.json',{'1':2})
            with patch.object(w,'site_notes',return_value={'notes':[{'transaction_id':1,'version':2,'status':'pending'},{'transaction_id':2,'version':3,'status':'pending'}]}):
                self.assertEqual([r['transaction_id'] for r in w.pending_notes({})],[2])
            with patch.object(w,'site_notes',return_value={'notes':[{'transaction_id':1,'version':3,'status':'pending'}]}):
                self.assertEqual(len(w.pending_notes({})),1)

if __name__=='__main__':unittest.main()
