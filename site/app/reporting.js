'use strict';
// Reporting-only hierarchy. Ledger categories remain leaves; parents are never extra spending.
(function(root){
 const children=Object.freeze({__proto__:null,Food:['Restaurants','Orders'],Utilities:['Internet','Electricity','Heating','Water'],Transport:['Rides & taxis','Public transport'],Travel:['Hotels','Train','Car Rentals','Plane']});
 const directPrefix='direct:';
 const label=category=>category==='flow:income'?'Income':category?.startsWith(directPrefix)?'Other '+category.slice(directPrefix.length).toLowerCase():category==='Orders'?'Order in':category;
 const categoryOf=row=>row.category||'Needs review';
 const matches=(row,selection)=>!selection||(selection==='flow:income'?['income','refund'].includes(row.kind):selection.startsWith(directPrefix)?categoryOf(row)===selection.slice(directPrefix.length):categoryOf(row)===selection||(children[selection]||[]).includes(categoryOf(row)));
 const signed=row=>row.kind==='expense'?row.amount:row.kind==='refund'?-row.amount:0;
 const cashflow=row=>row.kind==='income'?-row.amount:signed(row);
 const transactionAmount=row=>['refund','income'].includes(row.kind)||row.type==='deposit'?row.amount:-row.amount;
 const formatBarValue=(cents,currency,narrow=false)=>new Intl.NumberFormat('en-IE',{style:'currency',currency:currency==='ANY'?'EUR':currency,minimumFractionDigits:0,maximumFractionDigits:narrow&&Math.abs(cents)>=100000?1:0,...(narrow?{notation:'compact'}:{})}).format(cents/100);
 const collator=new Intl.Collator('en',{numeric:true,sensitivity:'base',ignorePunctuation:false});
 const sortFields=Object.freeze({date:'date',merchant:'merchant',category:'category',account:'account',amount:'amount',direction:'direction',review:'review'});
 function syncNotice(sync,now=new Date(),timezone="UTC"){
  const finished=new Date(sync?.finished_at||NaN),valid=Number.isFinite(finished.getTime())&&finished<=now;
  const localDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
  const success=sync?.status==='ok'&&valid&&localDay(finished)===localDay(now)&&Array.isArray(sync.feeds)&&sync.feeds.length>0&&sync.feeds.every(feed=>feed.status==='ok'&&!feed.needs_attention);
  const date=valid?new Intl.DateTimeFormat('en-GB',{timeZone:timezone,day:'numeric',month:'short',year:'numeric'}).format(finished):null;
  const attention=['error','partial','overdue'].includes(sync?.status)||sync?.feeds?.some(feed=>feed.needs_attention);
  const text=success?`Connected accounts synched on ${date}`:attention?'Bank sync needs attention · See Data & coverage':sync?.status==='running'?'Bank sync is running':sync?.status==='ok'&&date?`Last completed sync: ${date}`:'Bank sync has not completed successfully';
  return {success,attention:!!attention,text:text+' · Refresh reads the saved ledger'};
 }
 function nextSort(current,field){const first=['amount','date'].includes(field)?'desc':'asc';return current.startsWith(field+'-')?field+'-'+(current.endsWith('-asc')?'desc':'asc'):field+'-'+first;}
 function sortRows(rows,order){
  const split=order.lastIndexOf('-'),field=order.slice(0,split),direction=order.slice(split+1)==='asc'?1:-1;
  if(!Object.hasOwn(sortFields,field))return [...rows];
  const value=row=>field==='amount'?transactionAmount(row):field==='merchant'?(row.kind==='transfer'?`${row.source} → ${row.destination}`:row.merchant)||'':field==='category'?label(row.kind==='transfer'?'Transfer':categoryOf(row)):field==='direction'?(row.kind==='transfer'?'Transfer':row.type==='deposit'?'Incoming':'Outgoing'):field==='review'?(row.review||'New note awaiting review.'):row[field]??'';
  return [...rows].sort((a,b)=>{const primary=field==='amount'?Number(value(a))-Number(value(b)):collator.compare(String(value(a)),String(value(b)));return primary*direction||String(a.date).localeCompare(String(b.date))||(a.id||0)-(b.id||0);});
 }
 function categoryTree(rows){
  const values=new Map();
  for(const row of rows)if(['expense','refund'].includes(row.kind)){
   const name=categoryOf(row);values.set(name,(values.get(name)||0)+signed(row));
  }
  const leaves=new Set(Object.values(children).flat());
  const roots=[...values].filter(([name])=>!leaves.has(name)&&!children[name]).map(([name,amount])=>({name,amount,children:[]}));
  for(const [name,names] of Object.entries(children))if(values.has(name)||names.some(child=>values.has(child))){
   const entries=names.map(child=>({name:child,amount:values.get(child)||0}));
   // A future/legacy direct parent posting remains visible and reconciles too.
   if(values.has(name))entries.push({name:directPrefix+name,label:label(directPrefix+name),appearance:name,amount:values.get(name),direct:true});
   roots.push({name,amount:entries.reduce((n,item)=>n+item.amount,0),children:entries});
  }
  return roots.sort((a,b)=>b.amount-a.amount||a.name.localeCompare(b.name));
 }
 function monthlyComparison(rows,months,selection){
  const values=new Map(months.map(month=>[month,{month,total:0,selected:0}]));
  for(const row of rows){const value=values.get(row.date.slice(0,7));if(!value)continue;
   value.total+=cashflow(row);if(selection&&matches(row,selection))value.selected+=selection==='flow:income'?row.amount:signed(row);
  }
  return [...values.values()];
 }
 function totalBarItems(chart,event,options,finalPosition,modes){
  const hits=modes.nearest(chart,event,{...options,axis:'xy',intersect:true},finalPosition);
  const isTotal=item=>chart.data.datasets[item.datasetIndex].stack==='spending';
  const selection=hits.filter(item=>chart.data.datasets[item.datasetIndex].stack==='selection');
  if(selection.length)return selection;
  if(!hits.some(isTotal))return [];
  return modes.index(chart,event,{...options,intersect:true},finalPosition).filter(isTotal);
 }
 function currencyRows(rows,currency){
  if(currency==='ANY')return rows.map(row=>{
   if(!Number.isSafeInteger(row.eur_amount))throw Error('A historical exchange rate is missing. The combined view is unavailable; use an individual currency.');
   return {...row,amount:row.eur_amount,currency:'EUR',original_amount:row.amount,original_currency:row.currency};
  });
  return rows.filter(r=>r.currency===currency||(r.kind==='transfer'&&r.destination_currency===currency)).map(r=>r.kind==='transfer'&&r.currency!==currency?{...r,amount:r.destination_amount,currency:r.destination_currency,account:r.destination}:r);
 }
 const recurrentLabels={all:'All recurrent',subscription:'Subscriptions',utilities:'Utilities',bank:'Bank payments',other:'Other recurrent'};
 function paymentMatches(row,query){return !query.trim()||[row.merchant,row.category,row.account,row.description,row.note?.text].filter(Boolean).join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());}
 function recurrentSearch(groups,query){return groups.filter(g=>!query.trim()||[g.name,recurrentLabels[g.bucket]].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())||g.rows.some(r=>paymentMatches(r,query)));}
 function incomingRows(rows,month,query=''){return sortRows(rows.filter(r=>['income','refund'].includes(r.kind)&&r.date.startsWith(month)&&paymentMatches(r,query)),'date-desc');}
 function recurrentGroups(rows){
  const groups=new Map(),utilities=new Set(['Utilities','Internet','Electricity','Heating','Water','Phone & internet']);
  for(const row of rows){
   if(row.kind!=='expense')continue;
   const inferred=utilities.has(row.category)?'utilities':['Bank fees','Loan repayments'].includes(row.category)?'bank':['Rent','Child support'].includes(row.category)?'other':null;
   if(!row.recurring&&!inferred)continue;
   const bucket=inferred||(row.recurring.kind==='bill'?'other':'subscription');
   const name=row.recurring?.name||(['Rent','Child support'].includes(row.category)?row.category:row.merchant);
   const key=JSON.stringify([name,row.account_id,row.currency,bucket]);
   const group=groups.get(key)||{key,name,bucket,kind:row.recurring?.kind||'bill',rows:[]};group.rows.push(row);groups.set(key,group);
  }
  return [...groups.values()].map(group=>{group.rows.sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id);group.latest=group.rows.at(-1);group.kind=group.latest.recurring?.kind||'bill';group.months=[...new Set(group.rows.map(r=>r.date.slice(0,7)))];return group;});
 }
 function recurrentTotal(groups,month,bucket='all'){return groups.filter(g=>bucket==='all'||g.bucket===bucket).reduce((total,g)=>total+g.rows.filter(r=>r.date.startsWith(month)).reduce((n,r)=>n+r.amount,0),0);}
 const api={children,label,matches,signed,cashflow,transactionAmount,formatBarValue,sortRows,nextSort,categoryTree,monthlyComparison,totalBarItems,currencyRows,syncNotice,recurrentGroups,recurrentTotal,recurrentLabels,recurrentSearch,incomingRows};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ExpenseReporting=api;
})(globalThis);
