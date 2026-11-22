// Real touch gestures (through the browser's input pipeline, so touch-action and overscroll-behavior apply):
// a swipe over the product list must scroll the page, and a sideways swipe must still remove a row.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path');
const script=path.resolve(__dirname,'../custom_components/ah_shopping/frontend/ah-shopping-card.js');

async function open(browser,viewport,config={}){
 const context=await browser.newContext({hasTouch:true,isMobile:true,viewport});
 const page=await context.newPage();
 // Like Home Assistant, the page sets a device-width viewport; without it a mobile browser lays out at 980px.
 await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:8px}ah-shopping-card{display:block}</style><div id="wrap"></div><div style="height:600px"></div>');
 await page.addScriptTag({path:script});
 await page.evaluate(config=>{
  const card=document.createElement('ah-shopping-card');
  card.setConfig({show_scan:false,fill_screen:true,...config});
  document.getElementById('wrap').append(card);
  card.hass={states:{list:{last_updated:'1',attributes:{ah_shopping_list:true,items:Array.from({length:40},(_,i)=>({product_id:i+1,title:`Product ${i+1}`,quantity:1,price_now:1}))}}}};
  card._calls=[];card._service=async(name,data)=>{card._calls.push([name,data]);return {};};
 },config);
 await page.waitForTimeout(200);
 return {page,cdp:await context.newCDPSession(page),context};
}

// A finger drag from (x0,y0) to (x1,y1); `arc` moves sideways in the first third, like a thumb.
async function drag(page,cdp,[x0,y0],[x1,y1],arc=false){
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x0,y:y0}]});
 for(let i=1;i<=12;i++){
  const t=i/12,fx=arc?Math.min(1,t*3):t;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x0+(x1-x0)*fx,y:y0+(y1-y0)*t}]});
  await page.waitForTimeout(16);
 }
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForTimeout(400);
}

const listState=page=>page.evaluate(()=>{
 const items=document.querySelector('ah-shopping-card').shadowRoot.querySelector('.items');
 return {overflowY:getComputedStyle(items).overflowY,top:Math.round(items.scrollTop),max:items.scrollHeight-items.clientHeight};
});

(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  // Phone: the list is no scroll container, so a swipe anywhere over it scrolls the page.
  const phone=await open(browser,{width:375,height:812});
  const phoneList=await listState(phone.page);
  assert.equal(phoneList.overflowY,'visible','phone: the list must not be a scroll container');
  for(const [name,arc] of [['straight',false],['thumb arc',true]]){
   await phone.page.evaluate(()=>scrollTo(0,300));
   const before=await phone.page.evaluate(()=>scrollY);
   await drag(phone.page,phone.cdp,[190,600],[arc?215:190,300],arc);
   const after=await phone.page.evaluate(()=>scrollY);
   assert.ok(after>before,`phone: a ${name} swipe over the list scrolls the page (${before} -> ${after})`);
  }
  // While swiping, a red strip with a bin shows behind the row; it turns solid past the removal threshold.
  await phone.page.evaluate(()=>scrollTo(0,0));
  const start=await phone.page.evaluate(()=>{
   const r=document.querySelector('ah-shopping-card').shadowRoot.querySelector('[data-row-key="p:3"] .info').getBoundingClientRect();
   return [Math.round(r.left+40),Math.round(r.top+10)];
  });
  const backdrop=()=>phone.page.evaluate(()=>{
   const card=document.querySelector('ah-shopping-card');
   const bg=card.shadowRoot.querySelector('.swipeBg'),row=card.shadowRoot.querySelector('[data-row-key="p:3"]');
   if(!bg)return null;
   const b=bg.getBoundingClientRect(),r=row.getBoundingClientRect();
   return {fromRight:bg.classList.contains('fromRight'),armed:bg.classList.contains('armed'),icon:!!bg.querySelector('ha-icon'),
    behindRow:Math.abs(b.top-r.top)<1&&Math.abs(b.height-r.height)<1,red:getComputedStyle(bg).backgroundColor!=='rgba(0, 0, 0, 0)',rowOnTop:getComputedStyle(row).zIndex==='1'};
  });
  await phone.cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start[0],y:start[1]}]});
  for(const dx of [-10,-20,-40,-60])await phone.cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start[0]+dx,y:start[1]}]});
  const small=await backdrop();
  for(const dx of [-100,-140,-170])await phone.cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start[0]+dx,y:start[1]}]});
  const far=await backdrop();
  for(const dx of [-120,-60,-20,0])await phone.cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start[0]+dx,y:start[1]}]});
  await phone.cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await phone.page.waitForTimeout(300);
  const released=await backdrop();
  assert.ok(small&&small.icon&&small.red&&small.behindRow&&small.rowOnTop&&small.fromRight&&!small.armed,`phone: swiping shows the bin strip behind the row (${JSON.stringify(small)})`);
  assert.ok(far&&far.armed,'phone: past the threshold the strip turns solid');
  assert.equal(released,null,'phone: the strip disappears when the row snaps back');
  const kept=await phone.page.evaluate(()=>{
   const card=document.querySelector('ah-shopping-card'),row=card.shadowRoot.querySelector('[data-row-key="p:3"]');
   // The card's own list refresh on start is no edit.
   return card._calls.every(([name])=>name==='refresh')&&!card._pendingQty?.size&&row&&!row.classList.contains('rowUndo')&&row.style.transform==='';
  });
  assert.ok(kept,'phone: swiping back before letting go keeps the product');

  // A sideways swipe still removes the row.
  await phone.page.evaluate(()=>scrollTo(0,0));
  const row=await phone.page.evaluate(()=>{
   const r=document.querySelector('ah-shopping-card').shadowRoot.querySelector('[data-row-key="p:2"] .info').getBoundingClientRect();
   return [Math.round(r.left+20),Math.round(r.top+10)];
  });
  await drag(phone.page,phone.cdp,row,[row[0]-220,row[1]]);
  const removed=await phone.page.evaluate(()=>{
   const card=document.querySelector('ah-shopping-card');
   return card._calls.length>0||!!card.shadowRoot.querySelector('[data-row-key="p:2"].rowUndo')||card._pendingQty?.size>0;
  });
  assert.ok(removed,'phone: a sideways swipe still removes the row');
  await phone.context.close();

  // Phone: search results are no scroll container either, so a swipe over them scrolls the page.
  const search=await open(browser,{width:375,height:812},{show_search:true});
  const results=await search.page.evaluate(async()=>{
   const card=document.querySelector('ah-shopping-card');
   card._service=async name=>name==='search_products'?{products:Array.from({length:8},(_,i)=>({id:i+1,title:`Ui ${i+1}`,price_now:1}))}:{};
   const input=card.shadowRoot.querySelector('#searchInput');
   input.value='ui';input.dispatchEvent(new Event('input'));
   card.shadowRoot.querySelector('#searchForm').requestSubmit();
   for(let i=0;i<10;i++)await Promise.resolve();
   const box=card.shadowRoot.querySelector('.searchResults');
   scrollTo(0,0);
   const r=box.getBoundingClientRect();
   return {overflowY:getComputedStyle(box).overflowY,y:Math.round((Math.max(r.top,0)+Math.min(r.bottom,innerHeight))/2)};
  });
  assert.notEqual(results.overflowY,'auto','phone: search results must not be a scroll container');
  await drag(search.page,search.cdp,[190,results.y],[190,Math.max(20,results.y-300)]);
  assert.ok(await search.page.evaluate(()=>scrollY)>0,'phone: a swipe over the search results scrolls the page');
  await search.context.close();

  // Wider screen: the list scrolls inside the card, and at its end the page takes over.
  const wide=await open(browser,{width:800,height:800});
  const wideList=await listState(wide.page);
  assert.equal(wideList.overflowY,'auto','wide: the list scrolls inside the card');
  assert.ok(wideList.max>0,'wide: the list is longer than the card');
  await wide.page.evaluate(()=>{scrollTo(0,0);const items=document.querySelector('ah-shopping-card').shadowRoot.querySelector('.items');items.scrollTop=items.scrollHeight;});
  const before=await wide.page.evaluate(()=>scrollY);
  await drag(wide.page,wide.cdp,[400,600],[400,200]);
  const after=await wide.page.evaluate(()=>scrollY);
  assert.ok(after>before,`wide: at the end of the list the page scrolls on (${before} -> ${after})`);
  await wide.context.close();
  console.log('frontend touch scroll tests passed');
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exit(1);});
