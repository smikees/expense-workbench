'use strict';
const assert=require('node:assert/strict');
const r=require('../site/app/reporting.js');
const rows=[
 {id:1,date:'2025-02-01',category:'Groceries',amount:10000,kind:'expense'},
 {id:2,date:'2025-02-02',category:'Groceries',amount:2000,kind:'refund'},
 {id:3,date:'2025-02-03',category:'Interest',amount:3000,kind:'income'},
 {id:4,date:'2025-02-04',category:'Transfer',amount:90000,kind:'transfer'}];
assert.equal(rows.reduce((n,x)=>n+r.cashflow(x),0),5000);
assert.equal(r.categoryTree(rows)[0].amount,8000);
assert.deepEqual(r.sortRows(rows.slice(0,3),'amount-desc').map(x=>x.id),[3,2,1]);
assert.equal(r.nextSort('date-desc','merchant'),'merchant-asc');
assert.equal(r.nextSort('merchant-asc','merchant'),'merchant-desc');
assert.equal(r.matches({category:'Hotels'},'Travel'),true);
assert.equal(r.matches({category:'Hotels'},'direct:Travel'),false);
assert.equal(r.matches({category:'Travel'},'direct:Travel'),true);
const tree=r.categoryTree([{category:'Restaurants',kind:'expense',amount:100},{category:'Orders',kind:'expense',amount:200}]);
assert.equal(tree[0].amount,300);assert.equal(tree[0].children.length,2);
assert.equal(r.monthlyComparison(rows,['2025-02'],'Groceries')[0].selected,8000);
assert.equal(r.currencyRows([{currency:'RON',amount:500,eur_amount:100}],'ANY')[0].amount,100);
assert.throws(()=>r.currencyRows([{currency:'RON',amount:500}],'ANY'));
assert.match(r.formatBarValue(10000,'EUR'),/€/);
const recurrent=r.recurrentGroups([
 {id:10,date:'2025-02-01',category:'Rent',amount:90000,kind:'expense',merchant:'Example landlord',account_id:1,currency:'EUR'},
 {id:11,date:'2025-02-03',category:'Internet',amount:3000,kind:'expense',merchant:'Example broadband',account_id:1,currency:'EUR'},
 {id:12,date:'2025-02-04',category:'Software & AI',amount:1800,kind:'expense',merchant:'Example software',account_id:1,currency:'EUR',recurring:{name:'Example service',kind:'candidate'}}
]);
assert.equal(r.recurrentTotal(recurrent,'2025-02'),94800);
assert.equal(r.recurrentTotal(recurrent,'2025-02','utilities'),3000);
assert.equal(r.recurrentSearch(recurrent,'broadband').length,1);
assert.equal(r.incomingRows(rows,'2025-02').length,2);
const sync={status:'ok',finished_at:'2025-02-01T23:30:00Z',feeds:[{status:'ok'}]};
assert.equal(r.syncNotice(sync,new Date('2025-02-02T00:30:00Z'),'UTC').success,false);
assert.equal(r.syncNotice(sync,new Date('2025-02-02T00:30:00Z'),'Asia/Tokyo').success,true);
console.log('20 synthetic reporting assertions passed.');
