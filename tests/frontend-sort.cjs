const {chromium}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();
  await page.setContent('<style>body{margin:0}ah-shopping-card{display:block;width:450px;height:440px}</style>');
  await page.addScriptTag({path:path.resolve(__dirname,'../custom_components/ah_shopping/frontend/ah-shopping-card.js')});
  const result=await page.evaluate(async()=>{
   const items=[
    {product_id:1,title:'Yoghurt',quantity:1,category:'Zuivel, eieren'},
    {product_id:2,title:'Appels',quantity:1,category:'Fruit, verse sappen'},
    {item_id:'t1',title:'Iets lekkers',quantity:1},
    {product_id:3,title:'Melk',quantity:2,category:'Zuivel, eieren'},
    {product_id:4,title:'Peren',quantity:1,category:'Fruit, verse sappen'}
   ];
   const states=list=>({states:{list:{last_updated:String(Math.random()),attributes:{ah_shopping_list:true,items:list.map(i=>({...i}))}}}});
   const layout=card=>[...card.shadowRoot.querySelector('.items').children].map(el=>el.classList.contains('deptHead')?`[${el.textContent}]`:el.querySelector('.info b')?.textContent).join('|');

   const input=document.createElement('ah-shopping-card');input.setConfig({show_scan:false});document.body.append(input);
   input.hass=states(items);
   const inputOrderUnchanged=layout(input)==='Yoghurt|Appels|Iets lekkers|Melk|Peren'&&!input.shadowRoot.querySelector('.deptHead');
   input.remove();

   const card=document.createElement('ah-shopping-card');card.setConfig({show_scan:false,sort:'department'});document.body.append(card);
   card.hass=states(items);
   const grouped=layout(card)==='[Fruit, verse sappen]|Appels|Peren|[Zuivel, eieren]|Yoghurt|Melk|[Overig]|Iets lekkers';
   const heading=card.shadowRoot.querySelector('.deptHead');
   const retainedRow=card.shadowRoot.querySelector('[data-row-key="p:3"]');
   card.hass=states([...items,{product_id:5,title:'Bosui',quantity:1,category:'Aardappel, groente'}]);
   const newDepartmentFirst=layout(card).startsWith('[Aardappel, groente]|Bosui|[Fruit, verse sappen]');
   const nodesRetained=retainedRow===card.shadowRoot.querySelector('[data-row-key="p:3"]')&&heading.isConnected&&heading.textContent==='Fruit, verse sappen';
   const headingsNotScrollAnchors=[...card.shadowRoot.querySelectorAll('.items [data-row-key]')].every(el=>!el.classList.contains('deptHead'));
   const controlsStillWork=card.shadowRoot.querySelector('[data-plus][data-pid="3"]')!==null;
   card.remove();

   const order=document.createElement('ah-shopping-card');order.setConfig({show_scan:false,sort:'department',product_source:'next_order'});document.body.append(order);
   order.hass={states:{order:{last_updated:'1',attributes:{ah_next_order:true,items:[{product_id:8,title:'Kaas',quantity:1,taxonomy:'Kaas, vleeswaren'},{product_id:9,title:'Brood',quantity:1,taxonomy:'Bakkerij'}]}}}};
   const orderUsesTaxonomy=layout(order)==='[Bakkerij]|Brood|[Kaas, vleeswaren]|Kaas';
   order.remove();
   return {inputOrderUnchanged,grouped,newDepartmentFirst,nodesRetained,headingsNotScrollAnchors,controlsStillWork,orderUsesTaxonomy};
  });
  for(const [key,value] of Object.entries(result))assert.equal(value,true,key);
  console.log('PASS: input order by default, department headings with Overig last, retained nodes and order taxonomy');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
