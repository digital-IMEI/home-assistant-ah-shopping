const {chromium}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path');
const script=path.resolve(__dirname,'../custom_components/ah_shopping/frontend/ah-shopping-card.js');

async function run(context,body){
 const page=await context.newPage();
 await page.setContent('<style>body{margin:0}ah-shopping-card{display:block;width:375px;height:600px}</style>');
 await page.addScriptTag({path:script});
 return page.evaluate(body);
}

(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const touch=await browser.newContext({hasTouch:true,isMobile:true,viewport:{width:375,height:700}});
  const result=await run(touch,async()=>{
   const wait=ms=>new Promise(r=>setTimeout(r,ms));
   const card=document.createElement('ah-shopping-card');card.setConfig({show_scan:false});document.body.append(card);
   card.hass={states:{list:{last_updated:'1',attributes:{ah_shopping_list:true,items:[1,2,3].map(id=>({product_id:id,title:`Product ${id}`,quantity:1,price_now:1}))}}}};
   const calls=[];card._service=async(name,data)=>{calls.push([name,data]);return {};};
   const row=pid=>card.shadowRoot.querySelector(`[data-row-key="p:${pid}"]`);
   const fire=(el,type,x,y)=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,composed:true,pointerId:7,pointerType:'touch',clientX:x,clientY:y,isPrimary:true}));
   const swipe=async(el,dx,dy=0)=>{const r=el.querySelector('.info').getBoundingClientRect();const x=r.left+10,y=r.top+10;fire(el,'pointerdown',x,y);for(let i=1;i<=6;i++){fire(el,'pointermove',x+dx*i/6,y+dy*i/6);}fire(el,'pointerup',x+dx,y+dy);await wait(260);};
   const trashHidden=getComputedStyle(card.shadowRoot.querySelector('[data-remove]')).display==='none';

   await swipe(row(1),-40);
   const shortSnapsBack=!row(1).classList.contains('rowUndo')&&row(1).style.transform===''&&!card._pendingQty.size;
   await swipe(row(2),5,80);
   const verticalIgnored=row(2).style.transform===''&&!card._pendingQty.size;
   await swipe(row(3),-220);
   const longRemoves=card._pendingQty.get('shopping_list:3')===0&&row(3).classList.contains('rowUndo')&&row(3).style.transform==='';
   const undoWindowFirst=!calls.some(([name])=>name==='set_quantity');
   await swipe(row(1),200);
   const rightAlsoRemoves=card._pendingQty.get('shopping_list:1')===0;
   card.remove();

   const order=document.createElement('ah-shopping-card');order.setConfig({show_scan:false,product_source:'next_order'});document.body.append(order);
   order.hass={states:{order:{last_updated:'1',attributes:{ah_next_order:true,items:[{product_id:9,title:'Besteld',quantity:1}]}}}};
   const orderRow=order.shadowRoot.querySelector('[data-row-key="p:9"]');
   await swipe(orderRow,-220);
   const readOnlyNotSwiped=orderRow.style.transform===''&&!order._pendingQty.size;
   order.remove();
   return {trashHidden,shortSnapsBack,verticalIgnored,longRemoves,undoWindowFirst,rightAlsoRemoves,readOnlyNotSwiped};
  });
  const desktop=await browser.newContext({viewport:{width:800,height:700}});
  const trashOnDesktop=await run(desktop,()=>{
   const card=document.createElement('ah-shopping-card');card.setConfig({show_scan:false});document.body.append(card);
   card.hass={states:{list:{last_updated:'1',attributes:{ah_shopping_list:true,items:[{product_id:1,title:'Melk',quantity:1}]}}}};
   return getComputedStyle(card.shadowRoot.querySelector('[data-remove]')).display!=='none';
  });
  for(const [key,value] of Object.entries({...result,trashOnDesktop}))assert.equal(value,true,key);
  console.log('PASS: swipe left or right removes with undo, short and vertical swipes are ignored, read-only rows stay, x only with a mouse');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
