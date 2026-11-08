const {chromium}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:400,height:800}});
  await page.setContent('<style>body{margin:0}</style>');
  await page.addScriptTag({path:path.resolve(__dirname,'../custom_components/ah_shopping/frontend/ah-shopping-card.js')});
  const result=await page.evaluate(async()=>{
   const max=800-56-32;
   const list=n=>({states:{list:{last_updated:String(n),attributes:{ah_shopping_list:true,items:Array.from({length:n},(_,i)=>({product_id:i+1,title:`Product ${i+1}`,quantity:1}))}}}});
   const make=(config,n)=>{const card=document.createElement('ah-shopping-card');card.setConfig(config);document.body.append(card);card.hass=list(n);return card;};
   const height=card=>Math.round(card.getBoundingClientRect().height);
   const fixed=make({show_scan:false},1);
   const defaultRows=fixed.getGridOptions().rows===6;
   fixed.remove();

   // Few products: only the room the content needs.
   const few=make({show_scan:false,fill_screen:true},2);
   const autoRows=few.getGridOptions().rows==='auto';
   const fewHeight=height(few);
   const shrinksToContent=fewHeight>0&&fewHeight<max-200;
   // Many products: grows up to the screen height, then the list scrolls.
   few.hass=list(40);await new Promise(r=>requestAnimationFrame(r));
   const growsToScreen=height(few)===max;
   const items=few.shadowRoot.querySelector('.items');
   const listScrolls=getComputedStyle(items).overflowY==='auto'&&items.scrollHeight>items.clientHeight;
   // Phones drawing behind the status bar and navigation buttons report safe-area insets.
   document.documentElement.style.setProperty('--safe-area-inset-top','24px');
   document.documentElement.style.setProperty('--safe-area-inset-bottom','48px');
   few.setConfig({show_scan:false,fill_screen:true});
   const insetRespected=height(few)===max-24-48;
   document.documentElement.style.removeProperty('--safe-area-inset-top');
   document.documentElement.style.removeProperty('--safe-area-inset-bottom');
   few.remove();

   // The camera needs a fixed height, also with a short list.
   const scanner=make({show_scan:false,fill_screen:true,scanner_mode:'permanent'},1);
   const scannerFullHeight=height(scanner)===max;
   scanner.remove();
   const scanOnly=make({show_products:false,show_header:false,fill_screen:true},1);
   const compactStaysSmall=scanOnly.getGridOptions().rows===2;
   return {defaultRows,autoRows,shrinksToContent,growsToScreen,listScrolls,insetRespected,scannerFullHeight,compactStaysSmall};
  });
  for(const [key,value] of Object.entries(result))assert.equal(value,true,key);
  console.log('PASS: fill_screen takes only the room it needs, grows to the screen minus safe-area insets, keeps the list scrolling and the camera full height');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
