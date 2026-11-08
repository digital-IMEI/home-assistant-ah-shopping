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
   const show=type=>{card.hass={states:{order:{last_updated:String(++seq),attributes:{ah_next_order:true,order_id:300,tracking_type:type,items:[{product_id:1,title:'Melk',quantity:1}]}}}};
     const bar=card.shadowRoot.querySelector('.orderProgress');
     return bar?`${bar.querySelectorAll('.done').length}:${bar.querySelector('.current .stepLabel').textContent}`:'none';};
   const steps={none:show(''),planned:show('PLANNED'),preparing:show('PREPARING'),transit:show('IN_TRANSIT'),delivered:show('DELIVERED')};
   const node=card.shadowRoot.querySelector('.orderProgress');show('IN_TRANSIT');
   const retained=node===card.shadowRoot.querySelector('.orderProgress');
   card.hass={states:{order:{last_updated:String(++seq),attributes:{ah_next_order:true,items:[]}}}};
   const noOrderNoBar=!card.shadowRoot.querySelector('.orderProgress');
   card.remove();
   const list=document.createElement('ah-shopping-card');list.setConfig({show_scan:false});document.body.append(list);
   list.hass={states:{list:{last_updated:'1',attributes:{ah_shopping_list:true,items:[{product_id:1,title:'Melk',quantity:1}]}}}};
   const listHasNoBar=!list.shadowRoot.querySelector('.orderProgress');
   return {steps,retained,noOrderNoBar,listHasNoBar};
  });
  assert.deepEqual(result.steps,{none:'1:Besteld',planned:'1:Besteld',preparing:'2:Inpakken',transit:'3:Onderweg',delivered:'4:Geleverd'});
  for(const key of ['retained','noOrderNoBar','listHasNoBar'])assert.equal(result[key],true,key);
  console.log('PASS: order progress Besteld, Inpakken, Onderweg and Geleverd from the track & trace type; only for an existing order');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
