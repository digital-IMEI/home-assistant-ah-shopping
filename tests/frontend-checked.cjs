const {chromium}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();
  await page.setContent('<style>body{margin:0}ah-shopping-card{display:block;width:450px;height:440px}</style>');
  await page.addScriptTag({path:path.resolve(__dirname,'../custom_components/ah_shopping/frontend/ah-shopping-card.js')});
  const result=await page.evaluate(async()=>{
   const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
   const card=document.createElement('ah-shopping-card');card.setConfig({show_scan:false});document.body.append(card);
   let items=[1,2,3].map(id=>({product_id:id,title:`Product ${id}`,quantity:1,price_now:2,checked:false})),seq=0;
   const publish=()=>card.hass={states:{'todo.list':{last_updated:String(++seq),attributes:{ah_shopping_list:true,items:items.map(i=>({...i}))}}}};
   publish();
   const row=pid=>card.shadowRoot.querySelector(`[data-pid="${pid}"]`).closest('.item');
   const noActionsWhenNothingStruck=!card.shadowRoot.querySelector('.checkedActions');
   const openHeight=row(2).getBoundingClientRect().height;const retainedRow=row(2);
   items=items.map(i=>i.product_id===3?i:{...i,checked:true});publish();
   const struck=row(1).classList.contains('checked')&&row(2).classList.contains('checked')&&!row(3).classList.contains('checked');
   const lineThrough=getComputedStyle(row(1).querySelector('.info b')).textDecorationLine==='line-through'&&getComputedStyle(row(3).querySelector('.info b')).textDecorationLine==='none';
   const sameRowSize=row(2).getBoundingClientRect().height===openHeight&&row(3).getBoundingClientRect().height===openHeight;
   const rowNodeRetained=retainedRow===row(2);
   const buttons=[...card.shadowRoot.querySelectorAll('.checkedActions [data-checked-action]')].map(b=>b.dataset.checkedAction).join(',');
   const actionsShown=buttons==='restore,remove';
   const calls=[];
   card._service=async name=>{calls.push(name);items=name==='remove_checked'?items.filter(i=>!i.checked):items.map(i=>({...i,checked:false}));publish();return {count:2};};
   window.confirm=()=>false;card.shadowRoot.querySelector('[data-checked-action="remove"]').click();await settle();
   const cancelledRemoveDoesNothing=calls.length===0&&items.length===3;
   card.shadowRoot.querySelector('[data-checked-action="restore"]').click();await settle();
   const restored=calls.join(',')==='restore_checked'&&!card.shadowRoot.querySelector('.item.checked')&&!card.shadowRoot.querySelector('.checkedActions')&&card._message==='2 producten teruggezet';
   items=items.map(i=>i.product_id===3?i:{...i,checked:true});publish();
   window.confirm=()=>true;card.shadowRoot.querySelector('[data-checked-action="remove"]').click();await settle();
   const removed=calls.join(',')==='restore_checked,remove_checked'&&items.length===1&&card.shadowRoot.querySelectorAll('.item').length===1&&card._message==='2 producten verwijderd';
   card._service=async()=>{throw new Error('simulated AH failure');};
   items=[{...items[0],checked:true}];publish();
   card.shadowRoot.querySelector('[data-checked-action="restore"]').click();await settle();
   const errorReported=card._messageError===true&&card._message==='simulated AH failure'&&!card._checkedBusy&&!!card.shadowRoot.querySelector('.checkedActions');
   card.remove();
   const order=document.createElement('ah-shopping-card');order.setConfig({show_scan:false,product_source:'next_order'});document.body.append(order);
   order.hass={states:{order:{last_updated:'1',attributes:{ah_next_order:true,items:[{product_id:5,title:'Ordered',quantity:1,checked:true}]}}}};
   const readOnlyOrderHasNoActions=!order.shadowRoot.querySelector('.checkedActions');order.remove();
   return {noActionsWhenNothingStruck,struck,lineThrough,sameRowSize,rowNodeRetained,actionsShown,cancelledRemoveDoesNothing,restored,removed,errorReported,readOnlyOrderHasNoActions};
  });
  for(const [key,value] of Object.entries(result))assert.equal(value,true,key);
  console.log('PASS: struck-through rows, unchanged row size and nodes, restore/remove buttons, confirmation, errors and read-only order view');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
