const {chromium}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:800,height:700}});
  await page.setContent('<style>body{margin:0}ah-shopping-card{display:block;height:400px}</style>');
  await page.addScriptTag({path:path.resolve(__dirname,'../custom_components/ah_shopping/frontend/ah-shopping-card.js')});
  const result=await page.evaluate(()=>{
   const card=document.createElement('ah-shopping-card');card.setConfig({show_scan:false,product_source:'next_order'});document.body.append(card);
   let seq=0;
   const show=(type,extra={})=>{card.hass={states:{order:{last_updated:String(++seq),attributes:{ah_next_order:true,order_id:300,tracking_type:type,items:[{product_id:1,title:'Melk',quantity:1}],...extra}}}};
     const bar=card.shadowRoot.querySelector('.orderProgress');
     return bar?`${bar.querySelectorAll('.done').length}:${bar.querySelector('.current .stepLabel').textContent}`:'none';};
   const steps={none:show(''),planned:show('PLANNED'),afterCutOff:show('',{is_after_cut_off:true}),sentToLogistics:show('PLANNED',{order_state:'PLANNED_FOR_DELIVERY'}),preparing:show('PREPARING'),transit:show('IN_TRANSIT',{order_state:'PLANNED_FOR_DELIVERY'}),delivered:show('DELIVERED'),deliveredState:show('',{order_state:'DELIVERED'})};
   const undeliveredIsNotDelivered=show('',{order_state:'UNDELIVERED',is_after_cut_off:true})==='2:Inpakken';
   const outForDelivery=show('UNDERWAY',{order_state:'OUT_FOR_DELIVERY'})==='3:Onderweg'&&show('',{order_state:'OUT_FOR_DELIVERY'})==='3:Onderweg';
   const note=()=>card.shadowRoot.querySelector('.orderNote')?.textContent||'';
   show('UNDERWAY',{tracking_message:'Er zijn nog 3 klanten voor je. Onze bezorger verwacht tussen 16:40 en 17:10 uur bij je te zijn.'});const queueFromMessage=note()==='Nog 3 klanten voor je';
   show('UNDERWAY',{tracking_message:'Er is nog 1 klant voor je.'});const oneCustomer=note()==='Nog 1 klant voor je';
   show('UNDERWAY',{tracking_message:'Je bent de eerstvolgende.'});const nextUp=note()==='Je bent de eerstvolgende';
   show('UNDERWAY',{customers_ahead:2,tracking_message:''});const fromAttribute=note()==='Nog 2 klanten voor je';
   show('PLANNED',{order_state:'PLANNED_FOR_DELIVERY',tracking_message:'Er zijn nog 3 klanten voor je.'});const onlyWhileUnderway=note()==='';
   const node=card.shadowRoot.querySelector('.orderProgress');show('IN_TRANSIT');
   const retained=node===card.shadowRoot.querySelector('.orderProgress');
   card.hass={states:{order:{last_updated:String(++seq),attributes:{ah_next_order:true,items:[]}}}};
   const noOrderNoBar=!card.shadowRoot.querySelector('.orderProgress');
   card.remove();
   const list=document.createElement('ah-shopping-card');list.setConfig({show_scan:false});document.body.append(list);
   list.hass={states:{list:{last_updated:'1',attributes:{ah_shopping_list:true,items:[{product_id:1,title:'Melk',quantity:1}]}}}};
   const listHasNoBar=!list.shadowRoot.querySelector('.orderProgress');
   return {steps,undeliveredIsNotDelivered,retained,noOrderNoBar,listHasNoBar,outForDelivery,queueFromMessage,oneCustomer,nextUp,fromAttribute,onlyWhileUnderway};
  });
  assert.deepEqual(result.steps,{none:'1:Besteld',planned:'1:Besteld',afterCutOff:'2:Inpakken',sentToLogistics:'2:Inpakken',preparing:'2:Inpakken',transit:'3:Onderweg',delivered:'4:Geleverd',deliveredState:'4:Geleverd'});
  for(const key of ['undeliveredIsNotDelivered','retained','noOrderNoBar','listHasNoBar','outForDelivery','queueFromMessage','oneCustomer','nextUp','fromAttribute','onlyWhileUnderway'])assert.equal(result[key],true,key);
  console.log('PASS: order progress Besteld, Inpakken, Onderweg and Geleverd from the cut-off, order state and track & trace type, centred labels, customers ahead while out for delivery; only for an existing order');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
