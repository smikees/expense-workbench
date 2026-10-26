'use strict';
const $=s=>document.querySelector(s);
function savedCategoryExpansion(){let saved={};try{saved=JSON.parse(localStorage.getItem('expenses-category-expansion')||'{}')||{};}catch{}return Object.fromEntries(Object.keys(ExpenseReporting.children).map(name=>[name,saved[name]===true]));}
const state={data:null,view:'overview',month:'',currency:localStorage.getItem('expenses-currency')||'ANY',account:'all',category:null,search:'',kind:'spending',sort:'date-desc',reviewSort:'amount-desc',limit:40,chart:null,recurringSelection:null,expanded:savedCategoryExpansion()};
state.noteEditors=new Map();
state.activeNoteId=null;
const titles={overview:'Monthly overview',subscriptions:'Recurrent payments',review:'Needs review',data:'Data & coverage'};
const money=(cents,currency=(state.currency==='ANY'?'EUR':state.currency))=>new Intl.NumberFormat('en-IE',{style:'currency',currency,maximumFractionDigits:2}).format(cents/100);
const monthName=(month,short=false)=>new Intl.DateTimeFormat('en-GB',{month:short?'short':'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${month}-15T12:00:00Z`));
const day=date=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sum=rs=>rs.reduce((n,r)=>n+r.amount,0);
const link=r=>state.data?.meta.hosted?`/transactions/${r.id}`:`http://127.0.0.1:8080/transactions/show/${r.group_id}`;
const reporting=ExpenseReporting;
function syncSortHeaders(scope,order){
 document.querySelectorAll(`[data-sort-scope="${scope}"]`).forEach(button=>{
  const field=button.dataset.sortField,active=order.startsWith(field+'-'),ascending=order.endsWith('-asc');
  button.closest('th').setAttribute('aria-sort',active?(ascending?'ascending':'descending'):'none');
  const next=reporting.nextSort(order,field),description=field==='amount'?(next.endsWith('-desc')?'largest first':'smallest first'):field==='date'?(next.endsWith('-desc')?'newest first':'oldest first'):(next.endsWith('-asc')?'A to Z':'Z to A');
  button.title=`Sort by ${button.textContent.trim()}, ${description}`;
  button.setAttribute('aria-label',button.title);
 });
}
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-sort-field]');if(!button)return;
 const review=button.dataset.sortScope==='review',key=review?'reviewSort':'sort';
 state[key]=reporting.nextSort(state[key],button.dataset.sortField);state.limit=40;
 if(review)renderReview();else renderTable();
});
// Show the hovered stack only: total breakdown or the separate category comparison.
Chart.Interaction.modes.totalBar=(chart,event,options,finalPosition)=>reporting.totalBarItems(chart,event,options,finalPosition,Chart.Interaction.modes);
const categoryLabel=name=>reporting.label(name||'Needs review');
const categoryAppearance=name=>ExpenseCategoryAppearance.get(name==='flow:income'?'Interest':name);
const fixedCategories=new Set(['Child support','Rent','Utilities','Internet','Electricity','Heating','Water','Phone & internet']);
function categoryBadge(name,label=categoryLabel(name)){
 const appearance=categoryAppearance(name);
 return `<span class="category-pill" style="--category-color:${appearance.color};--category-tint:${appearance.tint}"><span class="category-icon" style="--category-icon:url('${appearance.icon}')" aria-hidden="true"></span><span>${esc(label)}</span></span>`;
}
function categoryButton(item,max,child=false){
 const selected=state.category===item.name;
 const appearance=categoryAppearance(item.appearance||item.name);
 const share=max>0?Math.abs(item.amount)/max*100:0;
 const contents=`<span class="category-title">${categoryBadge(item.appearance||item.name,item.label||categoryLabel(item.name))}${!child&&fixedCategories.has(item.name)?'<span class="fixed-category-icon" role="img" aria-label="Fixed expense" title="Fixed expense"></span>':''}</span><strong class="${item.amount<0||item.incoming?'amount-credit':''}"${item.amount<0?` aria-label="Net credit ${esc(money(Math.abs(item.amount)))}" title="Net credit"`:''}>${item.incoming?'+':''}${money(Math.abs(item.amount))}</strong><div class="bar-track" aria-hidden="true"><div class="bar" style="width:${Math.min(share,100)}%;background:${appearance.color}"></div></div>${child?`<span class="sr-only">${share.toFixed(1)}% of section activity${item.amount<0?'; net credit':''}</span>`:''}`;
 return `<button class="category-row ${child?'category-child':''} ${item.children?.length?'category-parent':''} ${selected?'selected':''}" data-category="${esc(item.name)}" aria-pressed="${selected}">${contents}</button>`;
}
function categorySection(item,max){
 if(!item.children.length)return `<div class="category-section">${categoryButton(item,max)}</div>`;
 const open=state.expanded[item.name]===true,id='category-breakdown-'+encodeURIComponent(item.name);
 const sectionActivity=item.children.reduce((total,child)=>total+Math.abs(child.amount),0);
 return `<div class="category-section has-breakdown"><div class="category-heading">${categoryButton(item,max)}<button class="category-disclosure" data-toggle-category="${esc(item.name)}" aria-expanded="${open}" aria-controls="${id}" aria-label="${open?'Collapse':'Expand'} ${esc(item.name)} breakdown"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6"/></svg></button></div><div id="${id}" class="category-breakdown ${open?'is-open':''}" aria-hidden="${!open}" ${open?'':'inert'}><div><ul class="category-children" aria-label="${esc(item.name)} subsections">${item.children.map(child=>`<li>${categoryButton(child,sectionActivity,true)}</li>`).join('')}</ul></div></div></div>`;
}
function merchantMarkup(r,label=r.merchant,subtitle='',withNote=false,withCategory=false){
 const initials=String(label).replace(/[^\p{L}\p{N}\s]/gu,' ').trim().split(/\s+/).slice(0,2).map(s=>s[0]||'').join('').toUpperCase()||'?';
 const image=r.logo&&/^\/logos\/[a-z0-9-]+\.(svg|png|ico|jpg|webp)$/.test(r.logo)?`<img class="merchant-logo" src="${esc(r.logo)}" width="28" height="28" loading="lazy" alt="">`:esc(initials);
 return `<span class="merchant-row"><span class="merchant-avatar" aria-hidden="true" data-initials="${esc(initials)}">${image}</span><span class="merchant-copy"><span class="merchant-name"><span class="merchant">${esc(label)}</span>${withCategory?categoryBadge(r.category||'Uncategorized'):''}${withNote?noteButton(r):''}</span>${subtitle?`<span class="subline">${esc(subtitle)}</span>`:''}</span></span>`;
}
const sourceReviewFeeds=()=>state.data?.meta.bank_sync?.feeds?.filter(feed=>feed.source_held)||[];
const needsReview=row=>!!row.review||row.note?.status==='pending';
function noteButton(row){
 const hasNote=!!row.note?.text;
 return `<button class="note-icon-button ${hasNote?'has-note':''}" data-note-action="open" data-note-id="${row.id}" title="${hasNote?'Edit note':'Add a note'}" aria-label="${hasNote?'Edit':'Add'} note for ${esc(row.merchant)} on ${day(row.date)}"><span class="note-action-icon" aria-hidden="true"></span></button>`;
}
function noteMarkup(row){
 const note=row.note,hasNote=!!note?.text;
 return hasNote?`<div class="transaction-note"><p class="note-preview" dir="auto">${esc(note.text)}</p><span class="note-state">${note.status==='pending'?'Awaiting review':'Reviewed'}</span></div>`:'';
}
function noteEditor(row){
 const editor=state.noteEditors.get(row.id);if(!editor)return '';
 return `<div class="note-editor"><label for="note-text">Your note</label><textarea id="note-text" data-note-draft="${row.id}" rows="4" maxlength="5000" aria-describedby="note-help" ${editor.saving?'disabled':''}>${esc(editor.draft)}</textarea><p class="help" id="note-help">Saved ${state.data?.meta.hosted?'on this website':'on this computer'} for a later review. Saving does not change categories. Clear the text and save to remove the note.</p><div class="note-actions"><button class="button note-save" data-note-action="save" data-note-id="${row.id}" ${editor.saving||editor.conflict?'disabled':''}>${editor.saving?'Saving…':'Save note'}</button><button class="button secondary" data-note-action="cancel" data-note-id="${row.id}" ${editor.saving?'disabled':''}>Cancel</button><span class="help note-character-count">${editor.draft.length.toLocaleString()} / 5,000</span></div>${editor.error?`<p class="note-error" role="alert">${esc(editor.error)}</p>`:''}${editor.conflict?`<div class="note-conflict"><b>Saved version</b><p dir="auto">${esc(editor.conflict.text)||'No note'}</p><div class="note-actions"><button class="button secondary" data-note-action="overwrite" data-note-id="${row.id}">Save my version</button><button class="text-button" data-note-action="use-saved" data-note-id="${row.id}">Use saved version</button></div></div>`:''}</div>`;
}
function renderNoteModal(){
 if(state.activeNoteId===null)return;
 const row=baseRows().find(row=>row.id===state.activeNoteId)||state.data.transactions.find(row=>row.id===state.activeNoteId);if(!row)return;
 const incoming=row.type==='deposit',transfer=row.kind==='transfer',direction=transfer?'Transfer · excluded':incoming?'Incoming':'Outgoing';
 const date=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${row.date}T12:00:00Z`));
 $('#note-dialog-title').textContent=row.note?.text?'Edit transaction note':'Add transaction note';
 $('#note-dialog-close').disabled=!!state.noteEditors.get(row.id)?.saving;
 $('#note-transaction-info').innerHTML=`<div class="note-transaction-heading">${merchantMarkup(row,transfer?`${row.source} → ${row.destination}`:row.merchant)}<strong class="note-transaction-amount ${incoming?'refund-value':''}">${transfer?'':incoming?'+':'−'}${money(row.amount,row.currency)}</strong></div><dl class="note-transaction-details"><div><dt>Date</dt><dd>${esc(date)}</dd></div><div><dt>Account</dt><dd>${esc(row.account)}</dd></div><div><dt>Category</dt><dd>${categoryBadge(transfer?'Transfer':row.category,transfer?'Transfer · excluded':categoryLabel(row.category))}</dd></div><div><dt>Direction</dt><dd>${esc(direction)}</dd></div></dl>${row.description?`<details class="note-bank-description" open><summary>Bank description</summary><p>${esc(row.description)}</p></details>`:''}${row.review?`<p class="note-review-context"><b>Needs review:</b> ${esc(row.review)}</p>`:''}`;
 if(row.original_currency&&row.original_currency!=='EUR')$('#note-transaction-info').insertAdjacentHTML('beforeend',`<p class="help">Original amount: ${money(row.original_amount,row.original_currency)} · ECB ${esc(row.fx.rate_date)}: 1 EUR = ${esc(row.fx.currency_per_eur)} ${esc(row.original_currency)}</p>`);
 $('#note-dialog-form').innerHTML=noteEditor(row);
}
function closeNoteModal(discard=false){
 const id=state.activeNoteId;if(id===null||state.noteEditors.get(id)?.saving)return;
 if(discard)state.noteEditors.delete(id);state.activeNoteId=null;$('#note-dialog').close();focusNoteButton(id);
}
function refreshNotesUI(){
 $('#review-count').textContent=baseRows().filter(needsReview).length+sourceReviewFeeds().length;
 if(state.view==='overview')renderTable();else if(state.view==='review')renderReview();else if(state.view==='subscriptions')renderRecurring();
 if(state.activeNoteId!==null)renderNoteModal();
}
function focusNoteButton(id){document.querySelector(`#${state.view==='review'?'review':state.view==='subscriptions'?'subscriptions-view':'transactions'} [data-note-action="open"][data-note-id="${id}"]`)?.focus({preventScroll:true});}
async function saveNote(id){
 const editor=state.noteEditors.get(id);if(!editor||editor.saving)return;
 editor.saving=true;editor.error='';refreshNotesUI();
 try{
  const response=await fetch('/api/notes',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Expenses-Notes':'1'},body:JSON.stringify({transaction_id:id,text:editor.draft,version:editor.version})});
  const result=await response.json();
  if(!response.ok){if(response.status===409&&result.note){editor.conflict=result.note;const row=state.data.transactions.find(row=>row.id===id);if(row)row.note=result.note;}throw Error(result.error||'Could not save the note. Try again.');}
  const row=state.data.transactions.find(row=>row.id===id);row.note=result.note;state.noteEditors.delete(id);closeNoteModal();refreshNotesUI();focusNoteButton(id);
  $('#note-status').textContent=result.note.text?`Note saved for ${row.merchant}. ${result.note.status==='pending'?'Awaiting review.':'Already reviewed.'}`:`Note removed for ${row.merchant}.`;
 }catch(error){editor.saving=false;editor.error=editor.conflict?'Another window updated this note. Your draft is kept; compare the saved version below.':`${error.message} Your draft is kept.`;refreshNotesUI();$('#note-text')?.focus();}
}
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-note-action]');if(!button)return;
 const id=Number(button.dataset.noteId),action=button.dataset.noteAction,row=state.data.transactions.find(row=>row.id===id);if(!row)return;
 if(action==='open'){
  if(!state.noteEditors.has(id))state.noteEditors.set(id,{draft:row.note?.text||'',version:row.note?.version||0,saving:false,error:''});
  state.activeNoteId=id;renderNoteModal();if(!$('#note-dialog').open)$('#note-dialog').showModal();$('#note-text')?.focus();
 }else if(action==='cancel'){closeNoteModal(true);refreshNotesUI();focusNoteButton(id);}
 else if(action==='save')saveNote(id);
 else if(action==='overwrite'){const editor=state.noteEditors.get(id);editor.version=editor.conflict.version;editor.conflict=null;saveNote(id);}
 else if(action==='use-saved'){const editor=state.noteEditors.get(id);editor.draft=editor.conflict.text;editor.version=editor.conflict.version;editor.conflict=null;editor.error='';refreshNotesUI();$('#note-text')?.focus();}
});
$('#note-dialog-close').addEventListener('click',()=>closeNoteModal());
$('#note-dialog').addEventListener('cancel',event=>{event.preventDefault();closeNoteModal();});
document.addEventListener('input',event=>{
 const id=Number(event.target.dataset.noteDraft);if(!id)return;const editor=state.noteEditors.get(id);if(!editor)return;editor.draft=event.target.value;event.target.closest('.note-editor').querySelector('.note-character-count').textContent=`${editor.draft.length.toLocaleString()} / 5,000`;
});
window.addEventListener('beforeunload',event=>{if([...state.noteEditors].some(([id,editor])=>editor.draft!==(state.data.transactions.find(row=>row.id===id)?.note?.text||''))){event.preventDefault();event.returnValue='';}});
function baseRows(){const rows=state.data.transactions.filter(r=>r.date>=state.data.meta.scope_start&&(state.account==='all'||(r.kind==='transfer'?[r.source_id,r.destination_id].includes(Number(state.account)):r.account_id===Number(state.account))));return reporting.currencyRows(rows,state.currency);}
function periodRows(month=state.month){return baseRows().filter(r=>r.date.startsWith(month));}
function totals(rows){const expenses=rows.filter(r=>r.kind==='expense'),refunds=rows.filter(r=>r.kind==='refund'),income=rows.filter(r=>r.kind==='income');return {expenses,refunds,income,gross:sum(expenses),credit:sum(refunds),net:sum(expenses)-sum(refunds)-sum(income),incomeTotal:sum(income),transfers:rows.filter(r=>r.kind==='transfer').length};}
function prevMonth(m){const d=new Date(`${m}-15T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7);}
function setView(view){state.view=view;localStorage.setItem('expenses-view',view);render();window.scrollTo({top:0,behavior:'instant'});}
function render(){if(!state.data)return;$('#fx-note').hidden=state.currency!=='ANY'||state.view==='data';$('.loading').hidden=true;for(const v of Object.keys(titles))$(`#${v}-view`).hidden=v!==state.view;
 $('#view-title').textContent=titles[state.view];document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===state.view);b.setAttribute('aria-current',b.dataset.view===state.view?'page':'false');});
 const through=state.data.meta.account_imported_through?.[state.account]||state.data.meta.imported_through;renderSyncStatus();
 $('.toolbar').hidden=state.view==='data';$('#period-note').hidden=state.view==='data';$('.month-control').hidden=!['overview','subscriptions'].includes(state.view);const partial=state.month===through.slice(0,7);$('#period-note').textContent=state.view==='overview'?(partial?`Partial month · imported through ${day(through)}`:'Imported activity · see account coverage'):state.view==='subscriptions'?`Totals for ${monthName(state.month)} · history across all imports`:'All imported history · currency and account filters apply';$('#period-note').classList.toggle('partial',partial&&state.view==='overview');
 $('#review-count').textContent=baseRows().filter(needsReview).length+sourceReviewFeeds().length;
 $('#previous').disabled=$('#month').selectedIndex===$('#month').options.length-1;$('#next').disabled=$('#month').selectedIndex===0;
 if(state.view==='overview')renderOverview();if(state.view==='subscriptions')renderRecurring();if(state.view==='review')renderReview();if(state.view==='data')renderData();
}
function renderSyncStatus(){
 if(!state.data)return;
 const notice=reporting.syncNotice(state.data.meta.bank_sync,new Date(),state.data.meta.timezone||'UTC'); $('#asof-text').textContent=notice.text;$('#sync-success-icon').toggleAttribute('hidden',!notice.success);$('#asof').classList.toggle('sync-attention',notice.attention);
}
// Re-evaluate after midnight or returning to a tab without reading the banks.
setInterval(renderSyncStatus,60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)renderSyncStatus();});
function renderOverview(){const rows=periodRows(),t=totals(rows);$('#net-spend').textContent=money(t.net);$('#gross').textContent=money(t.gross);$('#refunds').textContent=money(t.credit);$('#income').textContent=money(t.incomeTotal);$('#transfer-count').textContent=`${t.transfers} movements`;
 const previous=totals(periodRows(prevMonth(state.month)));const partial=state.month===state.data.meta.imported_through.slice(0,7);$('#comparison').textContent=partial?'Month to date; not compared with a full month.':previous.net>0?`${Math.abs((t.net-previous.net)/previous.net*100).toFixed(1)}% ${t.net>=previous.net?'more':'less'} than ${monthName(prevMonth(state.month),true)}`:'No comparable prior month in the imported history.';
 const cs=reporting.categoryTree(rows),max=Math.max(...cs.map(item=>Math.abs(item.amount)),1);
 $('#category-list').innerHTML=(cs.length?cs.map(item=>categorySection(item,max)).join(''):'<p class="empty">No spending recorded for this selection.</p>')+`<div class="income-category">${categorySection({name:'flow:income',appearance:'Interest',label:'Income',amount:sum(rows.filter(r=>reporting.matches(r,'flow:income'))),incoming:true,children:[]},max)}<p class="help">All incoming payments and refunds. Transfers excluded; shown separately from spending.</p></div>`;
 $('#clear-category').hidden=!state.category;
 $('#subscription-spend').textContent=money(sum(t.expenses.filter(r=>r.recurring?.kind==='subscription')));$('#uncategorized').textContent=money(sum(t.expenses.filter(r=>!r.category)));
 const months=[...new Set(state.data.transactions.filter(r=>r.date>=state.data.meta.scope_start&&r.kind!=='opening').map(r=>r.date.slice(0,7)))].sort();const groups=[...state.data.meta.spending_groups.map(g=>g.id==='food'?{...g,label:'Food & groceries'}:g),{id:'income',label:'Income',color:'#24694e',description:'External incoming money, deducted from the monthly total. Own-account transfers and opening balances excluded.'}];
 const breakdown=months.map(m=>{const values=Object.fromEntries(groups.map(g=>[g.id,0]));for(const r of periodRows(m)){if(r.kind==='income')values.income-=r.amount;else if(r.spending_group&&['expense','refund'].includes(r.kind))values[r.spending_group]+=reporting.signed(r);}return values;});
 renderTrend(months,groups,breakdown);
 renderTable();
}
function renderTrend(months,groups,breakdown){
 const selected=state.category,selectionLabel=categoryLabel(selected),comparison=reporting.monthlyComparison(baseRows(),months,selected);
 const current=comparison.find(value=>value.month===state.month),comparisonColor=categoryAppearance(selected?.startsWith('direct:')?selected.slice(7):selected).color;
 const negativeFloor=Math.min(0,...breakdown.map(v=>Object.values(v).reduce((n,c)=>n+Math.min(c,0),0)/100),...comparison.map(v=>selected?v.selected/100:0))*1.3;
 const positivePeak=Math.max(0,...breakdown.map(v=>Object.values(v).reduce((n,c)=>n+Math.max(c,0),0)/100),...comparison.map(v=>selected?v.selected/100:0));
 $('#trend-legend').innerHTML=groups.map(g=>`<li title="${esc(g.description)}"><span style="background:${esc(g.color)}" aria-hidden="true"></span>${esc(g.label)}</li>`).join('')+(selected?`<li class="comparison-legend"><span style="background:${comparisonColor}" aria-hidden="true"></span>${esc(selectionLabel)} comparison</li>`:'');
 $('#trend-selection').hidden=!selected;
 $('#trend-selection').innerHTML=selected?`<strong>${esc(selectionLabel)} ${money(current.selected)}</strong><span>${monthName(state.month,true)}${current.total>0?` · ${selected==='flow:income'?'incoming payments & refunds':'category spending'} · net outflow ${money(current.total)}`:` · total ${money(current.total)}`}</span>`:'';
 $('#trend').setAttribute('aria-label',`Monthly net outflow by group${selected?`, with ${selectionLabel} beside each total`:''} in ${state.currency==='ANY'?'EUR (all currencies)':state.currency}`);
 $('#trend-accessible').innerHTML=`<table><caption>Monthly net outflow by group in ${esc(state.currency==='ANY'?'EUR (all currencies)':state.currency)}${selected?(selected==='flow:income'?'; comparison shows all incoming payments and refunds':'; comparison shows category spending before income'):''}</caption><thead><tr><th>Month</th>${groups.map(g=>`<th>${esc(g.label)}</th>`).join('')}<th>Net outflow</th>${selected?`<th>${esc(selectionLabel)} comparison</th>`:''}</tr></thead><tbody>${comparison.map((value,i)=>`<tr><th>${monthName(value.month)}</th>${groups.map(g=>`<td>${money(breakdown[i][g.id])}</td>`).join('')}<td>${money(value.total)}</td>${selected?`<td>${money(value.selected)}</td>`:''}</tr>`).join('')}</tbody></table>`;
 $('#trend-values').hidden=!selected;
 $('#trend-comparison').innerHTML=selected?`<table><thead><tr><th>Month</th><th class="number">Total</th><th class="number">${esc(selectionLabel)}</th></tr></thead><tbody>${comparison.map(value=>`<tr${value.month===state.month?' class="comparison-current"':''}><th scope="row">${monthName(value.month,true)}</th><td class="number">${money(value.total)}</td><td class="number">${money(value.selected)}</td></tr>`).join('')}</tbody></table>`:'';
 const datasets=groups.map(g=>({label:g.label,stack:'spending',data:breakdown.map(v=>v[g.id]/100),backgroundColor:months.map(m=>g.color+(m===state.month?'':'B3')),borderRadius:2,maxBarThickness:55}));
 if(selected)datasets.push({label:selectionLabel+' comparison',stack:'selection',data:comparison.map(value=>value.selected/100),backgroundColor:months.map(m=>comparisonColor+(m===state.month?'':'B3')),borderRadius:2,maxBarThickness:36});
 // Compare on the same axis. Labels and tooltips use net totals, never the sum of both bars.
 const valueLabels={id:'comparisonValues',afterDatasetsDraw(chart){
  const {ctx,scales:{y},chartArea}=chart,narrow=chartArea.width/months.length<110;
  const format=value=>reporting.formatBarValue(value,state.currency,narrow);
  ctx.save();ctx.textAlign='center';
  comparison.forEach((value,index)=>{
   const totalBar=chart.getDatasetMeta(0).data[index],selectedBar=selected?chart.getDatasetMeta(groups.length).data[index]:null;
   const top=Object.values(breakdown[index]).reduce((n,c)=>n+Math.max(c,0),0),bottom=Object.values(breakdown[index]).reduce((n,c)=>n+Math.min(c,0),0);
   ctx.font='10px Roboto, Arial, sans-serif';ctx.fillStyle='#596c77';
   ctx.fillText(format(value.total),totalBar.x,y.getPixelForValue((top||bottom)/100)+(top||!bottom?-7:14));
   if(selectedBar){ctx.font='600 10px Roboto, Arial, sans-serif';ctx.fillStyle=comparisonColor;
    ctx.fillText(format(value.selected),selectedBar.x,y.getPixelForValue(value.selected/100)+(value.selected>=0?-7:14));}
  });ctx.restore();
 }};
 if(state.chart)state.chart.destroy();Chart.defaults.font.family='Roboto, Arial, sans-serif';Chart.defaults.color='#596c77';
 state.chart=new Chart($('#trend'),{type:'bar',plugins:[valueLabels],data:{labels:months.map(m=>monthName(m,true)),datasets},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},animation:!window.matchMedia('(prefers-reduced-motion: reduce)').matches?{duration:350}:false,plugins:{legend:{display:false},tooltip:{mode:'totalBar',intersect:true,callbacks:{label:ctx=>`${ctx.dataset.label}: ${money(Math.round(ctx.parsed.y*100))}`,footer:items=>{if(!items.length)return '';const value=comparison[items[0].dataIndex];const isComparison=items[0].dataset.stack==='selection';return `${isComparison?'Monthly net outflow':'Net outflow'}: ${money(value.total)}\nExpenses − refunds − income`;}}}},scales:{x:{stacked:true,grid:{display:false},ticks:{font:{size:11}}},y:{stacked:true,beginAtZero:true,min:negativeFloor,suggestedMax:positivePeak*1.18,border:{display:false},grid:{color:context=>context.tick.value===0?'#8195a1':'#edf1f4',lineWidth:context=>context.tick.value===0?1.5:1},ticks:{font:{size:10},callback:v=>new Intl.NumberFormat('en',{notation:'compact'}).format(v)}}},onClick:(e,els)=>{if(els.length){state.month=months[els[0].index];$('#month').value=state.month;state.limit=40;localStorage.setItem('expenses-month',state.month);render();}}}});
 $('#trend-note').textContent=`${state.currency==='ANY'?'All currencies in EUR · ECB transaction-date rates (previous published day when needed).':state.currency+' only.'} ${monthName(state.data.meta.imported_through.slice(0,7),true)} is partial. ${selected?'Right bar: '+selectionLabel+(selected==='flow:income'?' incoming payments and refunds.':' category spending.')+' Labels rounded; hover either bar or open exact values. ':'Totals rounded; hover for exact values. Select a category below to compare. '}Select a bar to change month.`;
}
function tableRows(){let rows=periodRows().filter(r=>state.kind==='all'?r.kind!=='opening':state.kind==='spending'?['expense','refund'].includes(r.kind):state.kind==='incoming'?reporting.matches(r,'flow:income'):r.kind===state.kind);
 if(state.category)rows=rows.filter(r=>reporting.matches(r,state.category));const q=state.search.toLocaleLowerCase();if(q)rows=rows.filter(r=>`${r.merchant} ${r.description} ${categoryLabel(r.category)} ${r.source} ${r.destination} ${r.note?.text||''}`.toLocaleLowerCase().includes(q));
 return reporting.sortRows(rows,state.sort);
}
function renderTable(){syncSortHeaders('transactions',state.sort);$('#sort').value=state.sort;const rows=tableRows();$('#transaction-count').textContent=`(${rows.length})`;$('#category-caption').textContent=state.category==='flow:income'?`Incoming payments and refunds for ${monthName(state.month)}.`:state.category?`Filtered to ${categoryLabel(state.category)}${reporting.children[state.category]?' and its subsections':''}.`:`Purchases and refunds for ${monthName(state.month)}.`;
 $('#transactions').innerHTML=rows.length?rows.slice(0,state.limit).map(r=>`<tr><td>${day(r.date)}</td><td>${merchantMarkup(r,r.kind==='transfer'?`${r.source} → ${r.destination}`:r.merchant,r.review?'Needs review':'',true)}${noteMarkup(r)}</td><td>${categoryBadge(r.kind==='transfer'?'Transfer':r.category,r.kind==='transfer'?'Transfer · excluded':r.kind==='refund'?`${r.category?categoryLabel(r.category):'Merchant'} credit`:categoryLabel(r.category))}</td><td>${esc(r.account)}</td><td class="number ${r.kind==='expense'?'amount-debit':['refund','income'].includes(r.kind)?'amount-credit':''}">${r.kind==='refund'||r.kind==='income'?'+':r.kind==='expense'?'−':''}${money(r.amount)}${originalAmountMarkup(r)}</td><td><a class="open-link" href="${link(r)}" target="_blank" rel="noreferrer" aria-label="Open ${esc(r.merchant)} transaction ${state.data?.meta.hosted?'details':'in Firefly'}">Open ↗</a></td></tr>`).join(''):'<tr><td colspan="6" class="empty">No transactions match these filters. Try another month or clear your search.</td></tr>';
 $('#show-more').hidden=rows.length<=state.limit;$('#table-note').textContent=`Showing ${Math.min(rows.length,state.limit)} of ${rows.length} transactions. Transfers and opening balances are excluded from spending.`;
}
function originalAmountMarkup(row){return row.original_currency&&row.original_currency!=='EUR'?`<span class="subline fx-original" title="${esc('ECB '+row.fx?.rate_date+': 1 EUR = '+row.fx?.currency_per_eur+' '+row.original_currency)}">${money(row.original_amount,row.original_currency)}</span>`:'';}
function recurringGroups(){return reporting.recurrentGroups(baseRows()).sort((a,b)=>b.latest.amount-a.latest.amount);}
function renderRecurring(){
 const all=recurringGroups(),kind=$('#recurring-kind').value,query=$('#recurring-search').value,groups=reporting.recurrentSearch(all.filter(g=>kind==='all'||g.bucket===kind),query),label=reporting.recurrentLabels[kind];
 $('#recurring-total').textContent=money(reporting.recurrentTotal(all,state.month));$('#recurring-total-label').textContent=`Total recurrent payments · ${monthName(state.month)}`;
 $('#recurring-filtered').textContent=money(reporting.recurrentTotal(groups,state.month));$('#recurring-filtered-label').textContent=`${label}${query.trim()?' · search results':''} · ${monthName(state.month)}`;
 $('#recurring-explanation').textContent='Actual outgoing payments in the selected month, including items needing confirmation. Currency and account filters apply; search narrows the category total. These totals are not a forecast; the current month may be incomplete.';
 $('#recurring-headers').innerHTML=['Service',monthName(state.month,true),'Latest charge','Last seen','History','Observation',''].map(h=>`<th>${esc(h)}</th>`).join('');
 $('#recurring').innerHTML=groups.length?groups.map(g=>{const amounts=[...new Set(g.rows.map(r=>r.amount))];let observation=g.kind==='candidate'?'Needs confirmation':g.months.length>=2?'Recurring charges observed':'Limited history';if(amounts.length>1)observation+=' · amount varies';return `<tr><td>${merchantMarkup(g.latest,g.name,reporting.recurrentLabels[g.bucket]+' · '+g.latest.account,true)}${noteMarkup(g.latest)}</td><td class="number">${money(sum(g.rows.filter(r=>r.date.startsWith(state.month))))}</td><td class="number">${money(g.latest.amount)}</td><td>${day(g.latest.date)}</td><td>${g.rows.length} charges / ${g.months.length} months</td><td><span class="${g.kind==='candidate'?'badge review':'subline'}">${observation}</span></td><td><button class="text-button" data-service="${esc(g.key)}">History</button></td></tr>`;}).join(''):'<tr><td colspan="7" class="empty">No recurrent payments for this selection.</td></tr>';
 if(state.recurringSelection&&groups.some(g=>g.key===state.recurringSelection))renderRecurringDetail(state.recurringSelection);else {state.recurringSelection=null;$('#recurring-detail').hidden=true;}
}
function renderRecurringDetail(key){const g=recurringGroups().find(g=>g.key===key);if(!g){$('#recurring-detail').hidden=true;return;}$('#recurring-detail').hidden=false;$('#recurring-detail-title').textContent=`${g.name} · charge history`;
 $('#recurring-history').innerHTML=[...g.months].reverse().map(m=>{const rs=g.rows.filter(r=>r.date.startsWith(m));return `<div class="history-month"><b>${monthName(m,true)}</b><span>${money(sum(rs))}</span>${rs.map(r=>`<div class="recurring-history-entry"><div>${day(r.date)}: ${money(r.amount)} ${noteButton(r)}</div>${noteMarkup(r)}</div>`).join('')}</div>`;}).join('');
}
function renderReview(){const held=sourceReviewFeeds();$('#source-review-issues').hidden=!held.length;$('#source-review-issues').innerHTML=held.map(feed=>`<div class="panel source-review-issue"><h2>${esc(feed.name)} · import check needed</h2><p>A bank entry could not be safely reconciled. New entries for this feed are held; its saved transactions remain available and other bank feeds continue updating.</p><p class="help">Last successful check: ${esc(feed.imported_through||'not yet verified')}. The next daily run retries this feed. A source or mapping issue that persists needs maintenance; no transaction is guessed or deleted.</p></div>`).join('');syncSortHeaders('review',state.reviewSort);const rows=reporting.sortRows(baseRows().filter(needsReview),state.reviewSort);$('#review').innerHTML=rows.length?rows.map(r=>{const incoming=r.type==='deposit';return `<tr><td>${day(r.date)}</td><td>${merchantMarkup(r,r.merchant,r.account,true,true)}${noteMarkup(r)}</td><td><span class="badge ${incoming?'refund':''}">${incoming?'Incoming':'Outgoing'}</span></td><td>${esc(r.review||'New note awaiting review.')}</td><td class="number review-amount ${incoming?'refund-value':''}">${incoming?'+':'−'}${money(r.amount)}${originalAmountMarkup(r)}</td><td><a class="open-link" href="${link(r)}" target="_blank" rel="noreferrer">${state.data?.meta.hosted?'Details ↗':'Open in Firefly ↗'}</a></td></tr>`;}).join(''):'<tr><td colspan="6" class="empty">No items need review in this currency and account.</td></tr>';
}
function renderData(){const sync=state.data.meta.bank_sync;const stamp=value=>value?new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:state.data?.meta.timezone||'UTC'}).format(new Date(value)):'Not yet verified';$('#sync-summary').textContent=`${sync.schedule}. ${sync.status==='ok'?'Last run completed':sync.status==='running'?'Sync is running':sync.status==='error'?'Sync stopped; reconciliation needs attention':sync.status==='partial'?'Some bank feeds need attention':sync.status==='overdue'?'Sync is overdue; keep Codex running for scheduled updates':'Sync is being configured'}${sync.finished_at?' · '+stamp(sync.finished_at)+' '+(state.data?.meta.timezone||'UTC'):''}.`;$('#sync-feeds').innerHTML=sync.feeds.map(b=>`<div class="coverage-row"><b>${esc(b.name)}</b><p class="${b.needs_attention?'warning':''}">${b.status==='ok'?'Connected · checked through '+esc(b.imported_through):'Needs attention · last successful check '+esc(stamp(b.last_success))}${b.review_count?' · '+b.review_count+' transaction update'+(b.review_count===1?'':'s')+' in Needs review':''}${b.valid_until?' · consent expires '+esc(stamp(b.valid_until)):''}</p></div>`).join('');$('#coverage').innerHTML=state.data.meta.coverage.map(c=>`<div class="coverage-row"><b>${esc(c.account)}</b><p class="${c.warning?'warning':''}">${esc(c.status)}</p></div>`).join('');$('#loans').innerHTML=state.data.meta.loans.map(l=>{const received=state.data.transactions.filter(r=>r.kind==='transfer'&&r.destination_id===l.account_id&&r.destination_currency===l.currency).reduce((s,r)=>s+r.destination_amount,0),paid=state.data.transactions.filter(r=>r.kind==='transfer'&&r.source_id===l.account_id&&r.currency===l.currency).reduce((s,r)=>s+r.amount,0);return `<div class="coverage-row"><b>${esc(l.name)}<br>${money(received-paid,l.currency)}</b><p>Outstanding receivable · expected ${esc(l.expected)}. Loan funding is shown among transfers.</p></div>`;}).join('')||'<p>No loans recorded.</p>';$('#backup-status').textContent=state.data.meta.backup?`Latest startup backup: ${state.data.meta.backup.date}. Ledger and reporting settings saved locally.`:'No dashboard startup backup has been recorded yet.';}
function exportCsv(){const rows=tableRows();const cell=s=>{s=String(s??'');if(/^\s*[=+@\-]|^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};const csv=[['Date','Merchant','Category','Account','Type','Amount','Currency','Original amount','Original currency','FX currency per EUR','FX rate date','Note','Note status'],...rows.map(r=>[r.date,r.kind==='transfer'?`${r.source} to ${r.destination}`:r.merchant,r.category||'',r.account,r.kind,(r.amount/100).toFixed(2),r.currency,((r.original_amount??r.amount)/100).toFixed(2),r.original_currency||r.currency,r.fx?.currency_per_eur??'',r.fx?.rate_date??'',r.note?.text||'',r.note?.status||'empty'])].map(row=>row.map(cell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`expenses-${state.month}-${state.currency}.csv`;a.click();URL.revokeObjectURL(url);}
async function load(){const button=$('#refresh');button.disabled=true;$('#message').hidden=true;try{const response=await fetch('/api/data',{cache:'no-store',credentials:'same-origin'});const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to read the ledger.');state.data=data;
 const months=[...new Set(data.transactions.filter(r=>r.date>=data.meta.scope_start&&r.kind!=='opening').map(r=>r.date.slice(0,7)))].sort();const saved=localStorage.getItem('expenses-month');if(new URLSearchParams(location.search).has('latest')){state.month=months.at(-1);state.view='overview';}if(!months.length)months.push(data.meta.imported_through.slice(0,7));state.month=months.includes(state.month)?state.month:months.includes(saved)?saved:months.at(-1);$('#month').innerHTML=[...months].reverse().map(m=>`<option value="${m}">${monthName(m)}</option>`).join('');$('#month').value=state.month;
 const currencies=[...new Set(data.transactions.map(r=>r.currency))].sort();if(state.currency!=='ANY'&&!currencies.includes(state.currency))state.currency='ANY';$('#currency').innerHTML='<option value="ANY">Any (in EUR)</option>'+currencies.map(c=>`<option>${esc(c)}</option>`).join('');$('#currency').value=state.currency;
 $('#account').innerHTML='<option value="all">All accounts</option>'+data.accounts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('');$('#account').value=state.account;$('#fx-note').hidden=state.currency!=='ANY';render();
 }catch(e){$('#message').textContent=e.message+' Use Refresh ledger to retry.';$('#message').hidden=false;$('#loading').hidden=true;}finally{button.disabled=false;}}
$('.brand').addEventListener('click',event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||!state.data)return;event.preventDefault();state.month=$('#month').options[0].value;$('#month').value=state.month;state.category=null;state.account='all';$('#account').value='all';state.search='';$('#search').value='';state.kind='spending';$('#transaction-kind').value='spending';state.limit=40;localStorage.setItem('expenses-month',state.month);setView('overview');});
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.go)));
$('#refresh').addEventListener('click',load);$('#month').addEventListener('change',e=>{state.month=e.target.value;state.limit=40;localStorage.setItem('expenses-month',state.month);render();});
for(const [id,key] of [['currency','currency'],['account','account']])$(`#${id}`).addEventListener('change',e=>{state[key]=e.target.value;if(key==='currency')localStorage.setItem('expenses-currency',state.currency);state.category=null;state.limit=40;render();});
for(const [id,delta] of [['previous',1],['next',-1]])$(`#${id}`).addEventListener('click',()=>{const s=$('#month');s.selectedIndex+=delta;s.dispatchEvent(new Event('change'));});
function focusCategory(name){[...document.querySelectorAll('#category-list [data-category]')].find(b=>b.dataset.category===name)?.focus({preventScroll:true});}
$('#category-list').addEventListener('click',e=>{
 const toggle=e.target.closest('[data-toggle-category]');
 if(toggle){
  const name=toggle.dataset.toggleCategory,open=state.expanded[name]!==true;state.expanded[name]=open;
  try{localStorage.setItem('expenses-category-expansion',JSON.stringify(state.expanded));}catch{/* Keep controls usable when browser storage is unavailable. */}
  toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',`${open?'Collapse':'Expand'} ${name} breakdown`);
  const panel=document.getElementById(toggle.getAttribute('aria-controls'));panel.inert=!open;panel.setAttribute('aria-hidden',String(!open));panel.classList.toggle('is-open',open);return;
 }
 const b=e.target.closest('[data-category]');if(!b)return;const name=b.dataset.category;state.category=state.category===name?null:name;state.kind=state.category==='flow:income'?'incoming':'spending';$('#transaction-kind').value=state.kind;state.limit=40;render();focusCategory(name);
});
$('#clear-category').addEventListener('click',()=>{const name=state.category;state.category=null;if(state.kind==='incoming'){state.kind='spending';$('#transaction-kind').value='spending';}render();focusCategory(name);});$('#search').addEventListener('input',e=>{state.search=e.target.value;state.limit=40;renderTable();});$('#transaction-kind').addEventListener('change',e=>{state.kind=e.target.value;state.category=null;state.limit=40;renderOverview();});$('#sort').addEventListener('change',e=>{state.sort=e.target.value;renderTable();});$('#show-more').addEventListener('click',()=>{state.limit+=40;renderTable();});$('#download').addEventListener('click',exportCsv);
$('#recurring-search').addEventListener('input',renderRecurring);$('#recurring-kind').addEventListener('change',renderRecurring);$('#recurring').addEventListener('click',e=>{const b=e.target.closest('[data-service]');if(b){state.recurringSelection=b.dataset.service;renderRecurringDetail(b.dataset.service);$('#recurring-detail').scrollIntoView({behavior:'smooth',block:'nearest'});}});$('#close-recurring').addEventListener('click',()=>{state.recurringSelection=null;$('#recurring-detail').hidden=true;});
state.view=Object.keys(titles).includes(localStorage.getItem('expenses-view'))?localStorage.getItem('expenses-view'):'overview';load();

// Graceful fallback for a missing or corrupt cached image, without inline handlers.
document.addEventListener('error',event=>{if(event.target instanceof HTMLImageElement&&event.target.classList.contains('merchant-logo')){const avatar=event.target.parentElement;avatar.textContent=avatar.dataset.initials||'?';}},true);
