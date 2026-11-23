// A just-delivered order stays visible for a while: the header says when it was delivered and the progress bar is full.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();
  await page.setContent('<style>body{margin:0}ah-shopping-card{display:block;width:450px}</style>');
  await page.addScriptTag({path:path.resolve(__dirname,'../custom_components/ah_shopping/frontend/ah-shopping-card.js')});
  const result=await page.evaluate(async()=>{
   const card=document.createElement('ah-shopping-card');
   card.setConfig({product_source:'next_order',show_scan:false});document.body.append(card);
   const order={ah_next_order:true,order_id:300,delivery_date:'2026-11-22',delivery_date_display:'zondag 22 november',expected_time_display:'19:35 - 20:35',
    tracking_type:'DELIVERED',status:'Bezorgd',delivered:true,delivered_at:'2026-11-22T20:15:00+01:00',total_price:71.54,total_quantity:2,unique_items:1,
    items:[{product_id:7,title:'Jonge kaas',quantity:2,price_now:3.25}]};
   card.hass={states:{'sensor.order':{entity_id:'sensor.order',last_updated:'1',attributes:order}}};
   await new Promise(r=>requestAnimationFrame(r));
   const text=card.shadowRoot.textContent;
   const delivered={
    header:text.includes('zondag 22 november · bezorgd om 20:15'),
    label:text.includes('Bezorgde bestelling'),
    fullBar:card.shadowRoot.querySelector('.orderProgress')?.getAttribute('aria-valuenow')==='4',
    items:!!card.shadowRoot.querySelector('[data-row-key]'),
   };
   card.hass={states:{'sensor.order':{entity_id:'sensor.order',last_updated:'2',attributes:{...order,delivered:false,delivered_at:'',tracking_type:'IN_TRANSIT',status:'Onderweg'}}}};
   await new Promise(r=>requestAnimationFrame(r));
   const open=card.shadowRoot.textContent;
   return {...delivered,openShowsWindow:open.includes('· 19:35 - 20:35')&&open.includes('Volgende bestelling')};
  });
  for(const [key,value] of Object.entries(result))assert.equal(value,true,key);
  console.log('PASS: a delivered order shows when it was delivered, with a full progress bar');
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exit(1);});
