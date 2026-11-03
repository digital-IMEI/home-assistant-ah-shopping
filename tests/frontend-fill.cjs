const {chromium}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:400,height:800}});
  await page.setContent('<style>body{margin:0}</style>');
  await page.addScriptTag({path:path.resolve(__dirname,'../custom_components/ah_shopping/frontend/ah-shopping-card.js')});
  const result=await page.evaluate(async()=>{
   const states={states:{list:{last_updated:'1',attributes:{ah_shopping_list:true,items:[{product_id:1,title:'Melk',quantity:1}]}}}};
   const make=config=>{const card=document.createElement('ah-shopping-card');card.setConfig(config);document.body.append(card);card.hass=states;return card;};
   const fixed=make({show_scan:false});
   const defaultRows=fixed.getGridOptions().rows===6;
   fixed.remove();
   const fill=make({show_scan:false,fill_screen:true});
   const autoRows=fill.getGridOptions().rows==='auto';
   const screenHeight=Math.round(fill.getBoundingClientRect().height)===800-56-32;
   const listScrolls=getComputedStyle(fill.shadowRoot.querySelector('.items')).overflowY==='auto';
   fill.remove();
   const scanOnly=make({show_products:false,show_header:false,fill_screen:true});
   const compactStaysSmall=scanOnly.getGridOptions().rows===2;
   return {defaultRows,autoRows,screenHeight,listScrolls,compactStaysSmall};
  });
  for(const [key,value] of Object.entries(result))assert.equal(value,true,key);
  console.log('PASS: fixed grid rows by default, fill_screen sizes the card to the screen and keeps the list scrolling');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
