const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../custom_components/ah_shopping/frontend');
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><body style="margin:0"></body>');return;}
 const file=path.resolve(root,pathname.replace(/^\/ah_shopping\//,''));
 if(!file.startsWith(root+path.sep)){res.writeHead(404);res.end();return;}
 try{res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':'application/javascript; charset=utf-8');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:500,height:700}});
  // Behave like a plain-HTTP dashboard: no live camera API.
  await page.addInitScript(()=>Object.defineProperty(navigator,'mediaDevices',{value:undefined,configurable:true}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.addScriptTag({url:'/ah_shopping/ah-shopping-card.js'});

  // 1. A visible shopping-list card requests one refresh, throttled, and again after the minimum interval.
  const refresh=await page.evaluate(async()=>{
   const calls=[];
   const card=document.createElement('ah-shopping-card');card.setConfig({});
   card._service=async(name,data)=>{calls.push(name);return {};};
   card.hass={states:{'sensor.ah':{last_updated:'1',state:'0',attributes:{ah_shopping_list:true,items:[]}}}};
   card.style.cssText='display:block;width:400px;height:300px';
   document.body.append(card);
   await new Promise(r=>setTimeout(r,300));
   const first=calls.filter(n=>n==='refresh').length;
   document.dispatchEvent(new Event('visibilitychange'));card._syncListRefresh();
   const throttled=calls.filter(n=>n==='refresh').length;
   window.__ahShoppingListRefresh.last=Date.now()-LIST_REFRESH_MIN_MS-1;
   document.dispatchEvent(new Event('visibilitychange'));
   const again=calls.filter(n=>n==='refresh').length;
   const timerWhileVisible=!!card._listRefreshTimer;
   card.style.display='none';window.__ahShoppingListRefresh.last=0;card._syncListRefresh();
   const hiddenCalls=calls.filter(n=>n==='refresh').length;const timerWhenHidden=!!card._listRefreshTimer;
   // A second list card on the same page shares the throttle.
   card.style.display='block';card._syncListRefresh();const beforeTwin=calls.filter(n=>n==='refresh').length;
   const twin=document.createElement('ah-shopping-card');twin.setConfig({});const twinCalls=[];twin._service=async n=>{twinCalls.push(n);return {};};
   twin.hass=card._hass;twin.style.cssText='display:block;width:400px;height:200px';document.body.append(twin);
   await new Promise(r=>setTimeout(r,300));const twinShared=twinCalls.length===0&&beforeTwin===3;twin.remove();
   const order=document.createElement('ah-shopping-card');order.setConfig({product_source:'next_order'});
   const orderCalls=[];order._service=async n=>{orderCalls.push(n);return {};};
   order.hass=card._hass;order.style.cssText='display:block;width:400px;height:200px';document.body.append(order);
   await new Promise(r=>setTimeout(r,300));
   card.remove();order.remove();
   return {first,throttled,again,timerWhileVisible,hiddenCalls,timerWhenHidden,twinShared,orderCalls:orderCalls.length,timerAfterRemove:!!card._listRefreshTimer};
  });
  assert.deepEqual(refresh,{first:1,throttled:1,again:2,timerWhileVisible:true,hiddenCalls:2,timerWhenHidden:false,twinShared:true,orderCalls:0,timerAfterRemove:false});

  // 2. Without live camera support, Scan opens a photo picker and adds the decoded EAN.
  const photo=await page.evaluate(()=>{
   const ean='4006381333931';
   let bits='101';const parity=EAN_PARITY[Number(ean[0])];
   for(let i=0;i<6;i++)bits+=(parity[i]==='L'?EAN_L:EAN_G)[Number(ean[i+1])];
   bits+='01010';for(let i=7;i<13;i++)bits+=EAN_R[Number(ean[i])];bits+='101';
   // A large, slightly rotated phone-style photo with the code off-center.
   const c=document.createElement('canvas');c.width=3000;c.height=2200;const ctx=c.getContext('2d');
   ctx.fillStyle='#b9b2a6';ctx.fillRect(0,0,c.width,c.height);
   ctx.translate(1900,1300);ctx.rotate(-0.08);ctx.fillStyle='white';ctx.fillRect(-60,-60,bits.length*9+120,420);ctx.fillStyle='black';
   [...bits].forEach((v,i)=>{if(v==='1')ctx.fillRect(i*9,0,9,300);});
   const blank=document.createElement('canvas');blank.width=800;blank.height=600;const b=blank.getContext('2d');b.fillStyle='#ccc';b.fillRect(0,0,800,600);
   return {barcode:c.toDataURL('image/jpeg',0.9).split(',')[1],blank:blank.toDataURL('image/jpeg',0.9).split(',')[1]};
  });
  await page.evaluate(()=>{
   const card=document.createElement('ah-shopping-card');card.setConfig({});
   window.photoCalls=[];
   card._service=async(name,data)=>{window.photoCalls.push([name,data]);return name==='add_barcode'?{product:{title:'Testproduct',quantity_on_list:2}}:{};};
   card.hass={states:{'sensor.ah':{last_updated:'1',state:'0',attributes:{ah_shopping_list:true,items:[]}}}};
   card.style.cssText='display:block;width:400px;height:300px';document.body.append(card);window.photoCard=card;
  });
  const scanWith=async data=>{
   const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.evaluate(()=>window.photoCard.shadowRoot.querySelector('#scan').click())]);
   assert.equal(chooser.isMultiple(),false);
   await chooser.setFiles({name:'photo.jpg',mimeType:'image/jpeg',buffer:Buffer.from(data,'base64')});
   // Dashboard updates can stop the live-scanner lifecycle meanwhile; a photo decode must survive it.
   await page.evaluate(()=>{window.photoCard._stopCamera();window.photoCard.hass={...window.photoCard._hass};});
  };
  const capture=await page.evaluate(()=>document.querySelector('input[type=file]')?.getAttribute('capture')||'');
  await scanWith(photo.barcode).catch(e=>{throw e;});
  const captureAttr=await page.evaluate(()=>document.querySelector('input[type=file]').getAttribute('capture'));
  await page.waitForFunction(()=>window.photoCalls.some(c=>c[0]==='add_barcode'),{timeout:15000});
  const added=await page.evaluate(()=>({calls:window.photoCalls.filter(c=>c[0]==='add_barcode'),toast:window.photoCard._message}));
  assert.equal(captureAttr,'environment');
  assert.deepEqual(added.calls,[['add_barcode',{barcode:'4006381333931',quantity:1}]]);
  assert.match(added.toast,/Testproduct toegevoegd \(2×\)/);
  await scanWith(photo.blank);
  await page.waitForFunction(()=>/Geen barcode gevonden/.test(window.photoCard._message),{timeout:15000});
  const after=await page.evaluate(()=>{const n=window.photoCalls.filter(c=>c[0]==='add_barcode').length;window.photoCard.remove();return {n,input:!!document.querySelector('input[type=file]')};});
  assert.deepEqual(after,{n:1,input:false});
  console.log('PASS: visible-list refresh (page-wide throttle, hidden/next-order skipped) and HTTP photo-scan fallback');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
