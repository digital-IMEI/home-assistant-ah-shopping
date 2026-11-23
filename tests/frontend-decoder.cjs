const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../custom_components/ah_shopping/frontend');
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><body></body>');return;}
 const file=path.resolve(root,pathname.replace(/^\/ah_shopping\//,''));
 if(!file.startsWith(root+path.sep)){res.writeHead(404);res.end();return;}
 try{res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':'application/javascript');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.addScriptTag({url:'/ah_shopping/ah-shopping-card.js'});
  const results=await page.evaluate(async()=>{
   const card=document.createElement('ah-shopping-card');
   let nativeCalls=0;window.BarcodeDetector=class {static getSupportedFormats(){nativeCalls++;return new Promise(()=>{});}};
   await card._initScannerEngine();
   const nativeIndependent=nativeCalls===0&&card._decoderMode==='wasm';
   const ean='4006381333931';
   let bits='101';const parity=EAN_PARITY[Number(ean[0])];
   for(let i=0;i<6;i++)bits+=(parity[i]==='L'?EAN_L:EAN_G)[Number(ean[i+1])];
   bits+='01010';for(let i=7;i<13;i++)bits+=EAN_R[Number(ean[i])];bits+='101';
   const canvas=document.createElement('canvas');canvas.width=500;canvas.height=180;
   const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,500,180);ctx.fillStyle='black';
   [...bits].forEach((v,i)=>{if(v==='1')ctx.fillRect(60+i*4,35,4,110);});
   let id=0;const decode=async c=>{card._scanCount=++id;return card._decodeWasm(c.getContext('2d').getImageData(0,0,c.width,c.height),true);};
   const normal=await decode(canvas);
   card._scanCount=++id;
   const fastBand=await card._decodeWasm(ctx.getImageData(0,0,canvas.width,canvas.height),false);
   const small=document.createElement('canvas');small.width=250;small.height=90;
   const sctx=small.getContext('2d');sctx.drawImage(canvas,0,0,250,90);
   const smallCode=await decode(small);
   const soft=document.createElement('canvas');soft.width=500;soft.height=180;
   const softCtx=soft.getContext('2d');softCtx.filter='blur(0.6px)';softCtx.drawImage(canvas,0,0);
   const softened=softCtx.getImageData(0,0,500,180);
   for(let i=0;i<softened.data.length;i+=4){
    const grey=90+softened.data[i]*.4;
    softened.data[i]=softened.data[i+1]=softened.data[i+2]=grey;
   }
   softCtx.putImageData(softened,0,0);const softCode=await decode(soft);
   const skew=document.createElement('canvas');skew.width=600;skew.height=350;
   const skewCtx=skew.getContext('2d');skewCtx.fillStyle='white';skewCtx.fillRect(0,0,600,350);
   skewCtx.translate(300,175);skewCtx.rotate(.18);skewCtx.drawImage(canvas,-250,-90);
   const skewCode=await decode(skew);
   const cropCard=document.createElement('ah-shopping-card');
   cropCard._scanner={getBoundingClientRect:()=>({left:0,top:0,width:720,height:1280}),querySelector:()=>({getBoundingClientRect:()=>({left:100,top:500,right:620,bottom:780})})};
   const crop=cropCard._scanSourceRect({videoWidth:1920,videoHeight:1080});
   const cropMargins=crop.sw>438&&crop.sx>=0&&crop.sx+crop.sw<=1920&&crop.sy+crop.sh<=1080;
   cropCard._scanner.querySelector=()=>({getBoundingClientRect:()=>({left:60,top:500,right:300,bottom:780})});
   const originalCrop=cropCard._scanSourceRect({videoWidth:1920,videoHeight:1080});
   cropCard._cameraMirrored=true;
   const mirroredCrop=cropCard._scanSourceRect({videoWidth:1920,videoHeight:1080});
   const mirrorProjection=Math.abs(mirroredCrop.sx-(1920-originalCrop.sx-originalCrop.sw))<=2&&Math.abs(mirroredCrop.sw-originalCrop.sw)<=1&&mirroredCrop.sy===originalCrop.sy;
   const rotated=document.createElement('canvas');rotated.width=180;rotated.height=500;
   const rctx=rotated.getContext('2d');rctx.translate(180,0);rctx.rotate(Math.PI/2);rctx.drawImage(canvas,0,0);
   const rotatedCode=await decode(rotated);
   const wide=document.createElement('canvas');wide.width=1280;wide.height=720;
   const wctx=wide.getContext('2d');wctx.fillStyle='white';wctx.fillRect(0,0,1280,720);wctx.drawImage(canvas,700,450);
   const offCenter=await decode(wide);
   const blank=document.createElement('canvas');blank.width=400;blank.height=200;
   const bctx=blank.getContext('2d');bctx.fillStyle='white';bctx.fillRect(0,0,400,200);
   const noFalsePositive=await decode(blank)==='';
   // Exercise the actual crop/full-frame path instead of only the decoder API.
   Object.defineProperties(canvas,{readyState:{value:4},videoWidth:{value:500},videoHeight:{value:180}});
   card._scanner={querySelector:s=>s==='video'?canvas:null};card._stream={};
   card._shouldScannerRun=()=>true;card._scanCanvas=document.createElement('canvas');
   let scanned='';const originalDetected=card._barcodeDetected;const originalSchedule=card._scheduleScan;
   card._barcodeDetected=code=>{scanned=code;};card._scheduleScan=()=>{};
   for(let i=0;i<4;i++)await card._scanFrame();
   const fullPipeline=scanned===ean&&!card._scanBusy;
   const centered=document.createElement('canvas');centered.width=1200;centered.height=600;
   const centerCtx=centered.getContext('2d');centerCtx.fillStyle='white';centerCtx.fillRect(0,0,1200,600);centerCtx.drawImage(canvas,350,210);
   Object.defineProperties(centered,{readyState:{value:4},videoWidth:{value:1200},videoHeight:{value:600}});
   const decodeOriginal=card._decodeWasm;let transfers=[];
   card._decodeWasm=function(image,harder,mode){transfers.push({height:image.height,width:image.width,mode});return decodeOriginal.call(this,image,harder,mode);};
   card._scanner={querySelector:s=>s==='video'?centered:null};card._decoderMisses=0;card._scanCount=0;scanned='';
   await card._scanFrame();
   const stripOnlyTransfer=scanned===ean&&transfers.length===1&&transfers[0].mode==='strip'&&transfers[0].height===96;
   Object.defineProperties(rotated,{readyState:{value:4},videoWidth:{value:180},videoHeight:{value:500}});
   card._scanner={querySelector:s=>s==='video'?rotated:null};card._decoderMisses=2;card._scanCount=3;scanned='';transfers=[];
   await card._scanFrame();
   const rotatedPipeline=scanned===ean&&transfers.some(x=>x.mode==='full');
   card._decodeWasm=decodeOriginal;card._scanner={querySelector:s=>s==='video'?canvas:null};
   const worker=card._decodeWorker;card._decodeWorker={postMessage(){},terminate(){}};
   let timeoutRecovered=false;
   try{await decode(canvas);}catch(error){timeoutRecovered=/antwoordt niet/.test(error.message)&&card._workerPending===null;}
   card._decodeWorker=worker;
   card._barcodeDetector={detect:()=>new Promise(()=>{})};
   let nativeTimeout=false;
   try{await card._detectNative(canvas);}catch(error){nativeTimeout=/antwoordt niet/.test(error.message)&&card._barcodeDetector===null;}
   const originalDecode=card._decodeWasm;card._decodeWasm=async()=>{throw new Error('test worker failure');};
   let visibleError='';card._setScanStatus=text=>{visibleError=text;};
   await card._scanFrame();
   const failureRecovered=card._decoderMode==='local'&&!card._scanBusy&&visibleError.includes('test worker failure');
   card._decodeWasm=originalDecode;card._barcodeDetected=originalDetected;card._scheduleScan=originalSchedule;
   let additions=0;card._setScanStatus=()=>{};card._processScanQueue=()=>{additions++;};
   card._barcodeDetected(ean);const singleFrameWaits=additions===0;
   card._barcodeDetected(ean);const secondFrameConfirms=additions===1;
   card._barcodeDetected(ean);
   const duplicateProtected=additions===1;
   card._heldBarcode='';card._barcodeDetected('8710400015727');card._barcodeDetected(ean);card._barcodeDetected('8710400015727');
   const otherCodeResets=additions===1;
   const confirmNow=Date.now;let confirmClock=500000;Date.now=()=>confirmClock;
   card._candidateBarcode='';card._barcodeDetected('8710400015727');confirmClock+=1001;card._barcodeDetected('8710400015727');
   const staleReadWaits=additions===1;
   let readStatus='';card._setScanStatus=text=>{readStatus=text;};
   confirmClock+=200;card._barcodeDetected('8710400015727');Date.now=confirmNow;
   const readShownAtOnce=additions===2&&readStatus.includes('8710400015727')&&readStatus.includes('gelezen');
   card._setScanStatus=()=>{};
   const feedback=document.createElement('ah-shopping-card');
   feedback._scanner=document.createElement('div');feedback._config={scanner_mode:'permanent'};
   feedback._playScanBeep=()=>{};feedback._renderScanResult=()=>{};feedback._promoteScannedProduct=()=>{};feedback._setScanStatus=()=>{};
   const originalNow=Date.now;let now=100000;Date.now=()=>now;
   let serviceCalls=0;feedback._service=async()=>{serviceCalls++;return {product:{id:1}};};
   feedback._scanQueue.push(ean);await feedback._processScanQueue();
   const successGreen=feedback._scanCooldownUntil===now+1200&&feedback._scanner.classList.contains('scanCooldown');
   feedback._barcodeDetected('8710400015727');
   const cooldownBlocks=serviceCalls===1&&feedback._scanQueue.length===0;
   now+=1201;feedback._scheduleScan();feedback._noteBarcodeAbsent();
   const redAfterCooldown=!feedback._scanner.classList.contains('scanCooldown');
   const pauseNotAbsence=feedback._heldBarcode===ean;
   feedback._barcodeDetected(ean);
   const heldAfterPause=serviceCalls===1;
   now+=20;feedback._noteBarcodeAbsent();now+=701;feedback._noteBarcodeAbsent();
   feedback._barcodeDetected(ean);feedback._barcodeDetected(ean);await Promise.resolve();
   const deliberateRepeat=serviceCalls===2;
   feedback._scanCooldownUntil=0;feedback._heldBarcode='';feedback._scheduleScan();
   let resolveAdd;feedback._service=()=>new Promise(resolve=>{resolveAdd=resolve;});
   feedback._barcodeDetected(ean);feedback._barcodeDetected(ean);feedback._barcodeDetected('8710400015727');feedback._barcodeDetected('8710400015727');
   const pendingBlocks=feedback._scanProcessing&&feedback._scanQueue.length===0;
   resolveAdd({product:{id:1}});await Promise.resolve();
   feedback._scanCooldownUntil=0;feedback._scheduleScan();feedback._service=async()=>{throw new Error('not found');};
   feedback._scanQueue.push('8710400015727');await feedback._processScanQueue();
   const failedNoCooldown=feedback._scanCooldownUntil===0&&!feedback._scanner.classList.contains('scanCooldown');
   const cleanVisuals=!feedback._scannerView(true).includes('scanhealth')&&!feedback._css().includes('scanHit');
   Date.now=originalNow;
   let callback,scheduled=0,videoCallbacks=0;
   const originalRAF=window.requestAnimationFrame,originalCancel=window.cancelAnimationFrame;
   window.requestAnimationFrame=cb=>{callback=cb;scheduled++;return 1;};window.cancelAnimationFrame=()=>{};
   card._scanner={querySelector:()=>({requestVideoFrameCallback:()=>{videoCallbacks++;},cancelVideoFrameCallback(){}})};
   card._stream={};card._scanFrame=()=>{};
   card._scheduleScan();const immediate=scheduled===1&&typeof callback==='function'&&card._scanLoop===null&&videoCallbacks===0;
   card._scanCooldownUntil=Date.now()+1200;card._scheduleScan();
   const cooldown=card._scanLoop!=null&&scheduled===1;
   card._cancelScheduledScan();window.requestAnimationFrame=originalRAF;window.cancelAnimationFrame=originalCancel;
   card._cancelScheduledScan();card._stopWasmWorker();
   return {normal,fastBand,smallCode,softCode,skewCode,cropMargins,mirrorProjection,rotatedCode,offCenter,stripOnlyTransfer,rotatedPipeline,immediate,cooldown,noFalsePositive,duplicateProtected,nativeIndependent,fullPipeline,timeoutRecovered,nativeTimeout,failureRecovered,successGreen,cooldownBlocks,redAfterCooldown,pauseNotAbsence,heldAfterPause,deliberateRepeat,pendingBlocks,failedNoCooldown,cleanVisuals,singleFrameWaits,secondFrameConfirms,otherCodeResets,staleReadWaits,readShownAtOnce};
  });
  for(const key of ['singleFrameWaits','secondFrameConfirms','otherCodeResets','staleReadWaits','readShownAtOnce'])assert.equal(results[key],true,key);
  for(const key of ['normal','fastBand','smallCode','softCode','skewCode','rotatedCode','offCenter'])assert.equal(results[key],'4006381333931',key);
  assert.equal(results.cropMargins,true,'portrait camera crop includes quiet zones');
  assert.equal(results.mirrorProjection,true,'mirrored guide maps to original camera pixels');
  for(const key of ['nativeIndependent','fullPipeline','stripOnlyTransfer','rotatedPipeline','timeoutRecovered','nativeTimeout','failureRecovered'])assert.equal(results[key],true,key);
  for(const key of ['successGreen','cooldownBlocks','redAfterCooldown','pauseNotAbsence','heldAfterPause','deliberateRepeat','pendingBlocks','failedNoCooldown','cleanVisuals'])assert.equal(results[key],true,key);
  assert.equal(results.noFalsePositive,true);assert.equal(results.duplicateProtected,true);
  assert.equal(results.immediate,true);assert.equal(results.cooldown,true);
  const audio=await page.evaluate(async()=>{
   const Original=window.AudioContext;let started=0,resumed=0,peak=0,release;
   class FakeAudio {
    constructor(){this.state='suspended';this.currentTime=10;this.destination={};}
    resume(){resumed++;return new Promise(resolve=>{release=()=>{this.state='running';this.onstatechange?.();resolve();};});}
    createOscillator(){return {frequency:{setValueAtTime(){}},connect(){},disconnect(){},start(){started++;},stop(){}};}
    createGain(){return {gain:{setValueAtTime(v){peak=Math.max(peak,v);},exponentialRampToValueAtTime(v){peak=Math.max(peak,v);}},connect(){},disconnect(){}};}
   }
   window.AudioContext=FakeAudio;
   const c=document.createElement('ah-shopping-card');c._syncScannerVisibility=()=>{};document.body.append(c);
   c._scanner=document.createElement('div');c._scanner.innerHTML=c._scannerView(true);
   const beep=c._playScanBeep();const waitsForResume=started===0&&resumed===1&&!c._scanner.querySelector('#scanAudio').hidden;
   release();await beep;const resumedBeep=started===1&&peak===.16&&c._scanner.querySelector('#scanAudio').hidden;
   c._audioContext.state='suspended';document.dispatchEvent(new Event('pointerup'));const gestureResumes=resumed===2;
   release();await Promise.resolve();await Promise.resolve();
   c._audioContext.state='closed';const old=c._audioContext;const arm=c._armScanAudio();release();await arm;
   const closedRecreated=c._audioContext!==old&&c._audioContext.state==='running';
   c._audioContext.state='suspended';c._audioContext.resume=()=>Promise.reject(new Error('autoplay blocked'));
   const rejectedSafely=await c._armScanAudio()===false;
   const originalNow=Date.now;let now=1000;Date.now=()=>now;
   c._audioContext.resume=FakeAudio.prototype.resume;const late=c._playScanBeep();now+=600;release();await late;
   const noStaleBeep=started===1;Date.now=originalNow;
   c.remove();c._audioContext.state='suspended';document.dispatchEvent(new Event('pointerup'));
   const listenerRemoved=resumed===4;
   window.AudioContext=Original;
   return {waitsForResume,resumedBeep,gestureResumes,closedRecreated,rejectedSafely,noStaleBeep,listenerRemoved};
  });
  for(const [key,value] of Object.entries(audio))assert.equal(value,true,key);
  const frames=await page.evaluate(async()=>{
   const c=document.createElement('ah-shopping-card');
   const canvas=document.createElement('canvas');canvas.width=400;canvas.height=100;
   let frame=1;
   Object.defineProperties(canvas,{readyState:{value:4},videoWidth:{value:400},videoHeight:{value:100},currentTime:{value:1}});
   canvas.getVideoPlaybackQuality=()=>({totalVideoFrames:frame});
   c._scanner={querySelector:selector=>selector==='video'?canvas:null};c._stream={};c._shouldScannerRun=()=>true;c._scheduleScan=()=>{};
   c._scanCanvas=document.createElement('canvas');c._decoderMode='wasm';let attempts=0;
   c._decodeWasm=async()=>{attempts++;return '';};
   const originalClock=performance.now;let clock=100;performance.now=()=>clock;
   await c._scanFrame();await c._scanFrame();const repeatedSkipped=attempts===2;
   frame++;await c._scanFrame();const newFrameImmediate=attempts===4;
   clock+=81;await c._scanFrame();const frozenRecovers=attempts===6;
   performance.now=originalClock;
   return {repeatedSkipped,newFrameImmediate,frozenRecovers};
  });
  for(const [key,value] of Object.entries(frames))assert.equal(value,true,key);
  console.log('PASS: locally bundled WASM, EAN decoding, rotation, off-center full-frame search, frame scheduling and success-only cooldown');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
