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

   card.shadowRoot.querySelector('[data-search-add][data-pid="1"]').click();await settle();
   const added=calls[1][0]==='add_product'&&calls[1][1].product_id===1&&calls[1][1].quantity===1&&card._message==='Rode ui toegevoegd';
   const listUpdated=card.shadowRoot.querySelector('.items [data-row-key="p:1"]')!==null;
   const clearedAfterAdd=!card.shadowRoot.querySelector('.searchResults')&&input().value===''&&card._searchQuery==='';
   const addedOnTop=card.shadowRoot.querySelector('.items [data-row-key]').dataset.rowKey==='p:1';

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
   const busyDisabled=card.shadowRoot.querySelector('#searchGo').disabled===true;
   card.shadowRoot.querySelector('#searchClose')?.click();card._closeSearch();
   release({products:[{id:9,title:'Melk'}]});await settle();
   const staleIgnored=!card.shadowRoot.querySelector('.searchResults')&&card.shadowRoot.querySelector('#searchGo').disabled===false;
   card.remove();
   return {hiddenByDefault,tooShortRejected,searched,resultsShown,marksOnList,inputKept,added,listUpdated,clearedAfterAdd,addedOnTop,errorReported,emptyMessage,closed,busyDisabled,staleIgnored};
  });
  for(const [key,value] of Object.entries(result))assert.equal(value,true,key);
  console.log('PASS: optional search field, results with list quantity and Bonus, add and clear, errors, empty result, close and stale responses');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
