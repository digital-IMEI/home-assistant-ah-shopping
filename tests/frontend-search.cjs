const {chromium}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();
  await page.setContent('<style>body{margin:0}ah-shopping-card{display:block;width:450px;height:520px}</style>');
  await page.addScriptTag({path:path.resolve(__dirname,'../custom_components/ah_shopping/frontend/ah-shopping-card.js')});
  const result=await page.evaluate(async()=>{
   const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
   const plain=document.createElement('ah-shopping-card');plain.setConfig({show_scan:false});document.body.append(plain);
   plain.hass={states:{list:{last_updated:'1',attributes:{ah_shopping_list:true,items:[]}}}};
   const hiddenByDefault=!plain.shadowRoot.querySelector('#searchForm');plain.remove();

   const card=document.createElement('ah-shopping-card');card.setConfig({show_scan:false,show_search:true});document.body.append(card);
   let items=[{product_id:2,title:'Bosui',quantity:1,price_now:0.99}],seq=0;
   const publish=()=>card.hass={states:{list:{last_updated:String(++seq),attributes:{ah_shopping_list:true,items:items.map(i=>({...i}))}}}};
   publish();
   const calls=[];
   card._service=async(name,data)=>{
    calls.push([name,data]);
    if(name==='search_products')return {products:[{id:1,title:'Rode ui',price_now:1.25},{id:2,title:'Bosui',price_now:0.99,is_bonus:true,bonus_mechanism:'2e halve prijs'},{id:0,title:'Ongeldig'}]};
    if(name==='add_product'){const hit=items.find(i=>i.product_id===data.product_id);if(hit)hit.quantity++;else items.push({product_id:data.product_id,title:'Rode ui',quantity:1});publish();return {};}
    return {};
   };
   const input=()=>card.shadowRoot.querySelector('#searchInput');
   const submit=async text=>{input().value=text;input().dispatchEvent(new Event('input'));card.shadowRoot.querySelector('#searchForm').requestSubmit();await settle();};

   await submit('u');
   const tooShortRejected=calls.length===0&&card._messageError===true;
   const retainedInput=input();
   await submit('  ui ');
   const searched=calls.length===1&&calls[0][0]==='search_products'&&calls[0][1].query==='ui'&&calls[0][1].limit===8;
   const rows=()=>[...card.shadowRoot.querySelectorAll('.searchResults [data-row-key]')].map(r=>r.dataset.rowKey).join(',');
   const resultsShown=rows()==='s:1,s:2'&&card.shadowRoot.querySelector('.searchSummary').textContent.includes('2 resultaten voor “ui”');
   const marksOnList=card.shadowRoot.querySelector('[data-row-key="s:2"]').textContent.includes('1 op lijst')&&card.shadowRoot.querySelector('[data-row-key="s:2"] .bonus')!==null;
   const inputKept=retainedInput===input()&&input().value==='  ui ';

   const pause=ms=>new Promise(r=>setTimeout(r,ms));
   card.shadowRoot.querySelector('[data-search-add][data-pid="1"]').click();await settle();
   const waitsBeforeAdding=calls.length===1&&card.shadowRoot.querySelector('[data-row-key="s:1"] .qty span')?.textContent==='1';
   await pause(2100);await settle();
   const added=calls[1][0]==='add_product'&&calls[1][1].product_id===1&&calls[1][1].quantity===1&&card._message==='Rode ui toegevoegd';
   const listUpdated=card.shadowRoot.querySelector('.items [data-row-key="p:1"]')!==null;
   const clearedAfterAdd=!card.shadowRoot.querySelector('.searchResults')&&input().value===''&&card._searchQuery==='';
   const addedOnTop=card.shadowRoot.querySelector('.items [data-row-key]').dataset.rowKey==='p:1';

   // Two taps on + add 2 at once; − back to 0 cancels; picking another product adds the first right away.
   const picks=[];const search=card._service;
   card._service=async(name,data)=>{if(name==='add_product'){picks.push(`${data.product_id}x${data.quantity}`);return {};}return search(name,data);};
   await submit('ui');
   const plus=pid=>card.shadowRoot.querySelector(`[data-search-add][data-pid="${pid}"]`).click();
   const minus=pid=>card.shadowRoot.querySelector(`[data-search-minus][data-pid="${pid}"]`).click();
   plus(2);await pause(300);plus(2);await settle();
   const shownTwo=card.shadowRoot.querySelector('[data-row-key="s:2"] .qty span')?.textContent==='2'&&picks.length===0;
   await pause(1200);await settle();
   const stillWaitingAfterASecond=picks.length===0&&!!card.shadowRoot.querySelector('[data-search-confirm][data-pid="2"]');
   await pause(1000);await settle();
   const addedTwo=picks.join(',')==='2x2'&&card._message==='2× Bosui toegevoegd'&&!card.shadowRoot.querySelector('.searchResults');
   await submit('ui');plus(1);await settle();minus(1);await settle();await pause(2100);await settle();
   const minusCancels=picks.length===1&&!card.shadowRoot.querySelector('[data-search-minus]');
   plus(1);await settle();plus(2);await settle();
   const switchCommitsFirst=picks.join(',')==='2x2,1x1'&&!!card.shadowRoot.querySelector('.searchResults');
   card.shadowRoot.querySelector('#searchClose').click();await settle();
   const closeCommitsPick=picks.join(',')==='2x2,1x1,2x1'&&!card.shadowRoot.querySelector('.searchResults');
   await submit('ui');plus(1);plus(1);plus(1);await settle();
   card.shadowRoot.querySelector('[data-search-confirm][data-pid="1"]').click();await settle();
   const confirmAddsNow=picks.at(-1)==='1x3'&&card._message==='3× Rode ui toegevoegd'&&!card.shadowRoot.querySelector('.searchResults');
   card._service=search;

   card._service=async()=>{throw new Error('simulated AH failure');};
   await submit('kaas');
   const errorReported=card._messageError===true&&card._message==='simulated AH failure'&&!card._searchBusy&&rows()==='';

   card._service=async()=>({products:[]});
   await submit('xyz');
   const emptyMessage=rows()===''&&card.shadowRoot.querySelector('.searchSummary').textContent.includes('Geen producten gevonden voor “xyz”');

   card.shadowRoot.querySelector('#searchClose').click();await settle();
   const closed=!card.shadowRoot.querySelector('.searchResults')&&input().value==='';

   let release;card._service=()=>new Promise(r=>{release=r;});
   await submit('melk');
   const busyShown=input().getAttribute('aria-busy')==='true'&&card.shadowRoot.querySelector('.searchSummary').textContent.startsWith('Zoeken…')&&!card.shadowRoot.querySelector('#searchGo');
   card.shadowRoot.querySelector('#searchClose')?.click();card._closeSearch();
   release({products:[{id:9,title:'Melk'}]});await settle();
   const staleIgnored=!card.shadowRoot.querySelector('.searchResults')&&input().getAttribute('aria-busy')==='false';

   const wait=ms=>new Promise(r=>setTimeout(r,ms));
   const typed=text=>{input().value=text;input().dispatchEvent(new Event('input'));};
   const auto=[];card._service=async(name,data)=>{auto.push(data.query);return {products:[{id:3,title:'Jonge kaas'}]};};
   input().focus();typed('k');await wait(900);
   const oneLetterWaits=auto.length===0;
   typed('ka');await wait(300);typed('kaa');await wait(300);typed('kaas');
   const notWhileTyping=auto.length===0;
   await wait(900);await settle();
   const searchedAfterPause=auto.join(',')==='kaas'&&rows()==='s:3'&&document.activeElement===card&&card.shadowRoot.activeElement===input();
   typed('kaas ');await wait(900);
   const sameQueryNotRepeated=auto.length===1;
   typed('');await settle();
   const clearedCloses=!card.shadowRoot.querySelector('.searchResults');
   card.remove();
   return {oneLetterWaits,notWhileTyping,searchedAfterPause,sameQueryNotRepeated,clearedCloses,hiddenByDefault,tooShortRejected,searched,resultsShown,marksOnList,inputKept,waitsBeforeAdding,added,listUpdated,clearedAfterAdd,addedOnTop,shownTwo,stillWaitingAfterASecond,addedTwo,confirmAddsNow,minusCancels,switchCommitsFirst,closeCommitsPick,errorReported,emptyMessage,closed,busyShown,staleIgnored};
  });
  for(const [key,value] of Object.entries(result))assert.equal(value,true,key);
  console.log('PASS: optional search field, results with list quantity and Bonus, quantity picking with a 2 s pause or ✓, add and clear, errors, empty result, close, stale responses and automatic search after a typing pause');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
