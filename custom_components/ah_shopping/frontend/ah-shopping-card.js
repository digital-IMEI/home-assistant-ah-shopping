const SCAN_COOLDOWN_MS=1200;
const REMOVAL_UNDO_MS=4000;
const REMOVAL_ANIMATION_MS=320;
const SCAN_FEED_TOP_MS=10000;
const SCAN_FEED_DIMMED_MS=5000;
// A visible list asks the integration for fresh AH data, so edits made in the
// AH app appear without waiting for the full polling interval.
const LIST_REFRESH_MIN_MS=30000;
const LIST_REFRESH_VISIBLE_MS=60000;
const PHOTO_MAX_SIDE=1600;
const EAN_L=["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
const EAN_G=["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
const EAN_R=EAN_L.map(p=>[...p].map(c=>c==="1"?"0":"1").join(""));
const EAN_PARITY=["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];

function checksumOk(code){
  if(!/^\d+$/.test(code)||![8,12,13,14].includes(code.length))return false;
  const digits=[...code].map(Number),check=digits.pop(); let sum=0,weight=3;
  for(let i=digits.length-1;i>=0;i--){sum+=digits[i]*weight;weight=weight===3?1:3;}
  return (10-(sum%10))%10===check;
}
function eanHamming(a,b){let d=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])d++;return d;}
function eanMatchDigit(pattern,sets){let best=null;for(const [type,arr] of sets){for(let d=0;d<10;d++){const dist=eanHamming(pattern,arr[d]);if(best===null||dist<best.dist)best={digit:d,type,dist};}}return best&&best.dist<=1?best:null;}
function eanGuardOk(s,expected){return s.length===expected.length&&eanHamming(s,expected)<=1;}
function eanDecodeModules(modules){
  const value=modules.join("");
  if(value.length===95&&eanGuardOk(value.slice(0,3),"101")&&eanGuardOk(value.slice(45,50),"01010")&&eanGuardOk(value.slice(92),"101")){
    let left="",parity="",right="";
    for(let i=0;i<6;i++){const m=eanMatchDigit(value.slice(3+i*7,10+i*7),[["L",EAN_L],["G",EAN_G]]);if(!m)return null;left+=m.digit;parity+=m.type;}
    const first=EAN_PARITY.indexOf(parity);if(first<0)return null;
    for(let i=0;i<6;i++){const m=eanMatchDigit(value.slice(50+i*7,57+i*7),[["R",EAN_R]]);if(!m)return null;right+=m.digit;}
    const code=`${first}${left}${right}`;return checksumOk(code)?code:null;
  }
  if(value.length===67&&eanGuardOk(value.slice(0,3),"101")&&eanGuardOk(value.slice(31,36),"01010")&&eanGuardOk(value.slice(64),"101")){
    let code="";
    for(let i=0;i<4;i++){const m=eanMatchDigit(value.slice(3+i*7,10+i*7),[["L",EAN_L]]);if(!m)return null;code+=m.digit;}
    for(let i=0;i<4;i++){const m=eanMatchDigit(value.slice(36+i*7,43+i*7),[["R",EAN_R]]);if(!m)return null;code+=m.digit;}
    return checksumOk(code)?code:null;
  }
  return null;
}
function eanPercentiles(values){const sorted=[...values].sort((a,b)=>a-b);return [sorted[Math.floor(sorted.length*.1)],sorted[Math.floor(sorted.length*.9)]];}
function eanBinarize(values){const [lo,hi]=eanPercentiles(values);if(hi-lo<35)return null;const t=(lo+hi)/2;return values.map(v=>v<t?1:0);}
function eanRuns(bits){const out=[];let value=bits[0],start=0;for(let i=1;i<=bits.length;i++){if(i===bits.length||bits[i]!==value){out.push({value,start,len:i-start});if(i<bits.length){value=bits[i];start=i;}}}return out;}
function eanSample(bits,start,moduleWidth,count){const result=[];for(let i=0;i<count;i++){const a=Math.max(0,Math.floor(start+i*moduleWidth)),b=Math.min(bits.length,Math.ceil(start+(i+1)*moduleWidth));if(b<=a)return null;let ones=0;for(let x=a;x<b;x++)ones+=bits[x];result.push(ones/(b-a)>.5?"1":"0");}return result;}
function eanTryRuns(bits,count){const rs=eanRuns(bits);for(let i=0;i<rs.length-2;i++){if(rs[i].value!==1||rs[i+1].value!==0||rs[i+2].value!==1)continue;const lens=[rs[i].len,rs[i+1].len,rs[i+2].len],min=Math.min(...lens),max=Math.max(...lens);if(min<1||max/min>2)continue;const base=(lens[0]+lens[1]+lens[2])/3;for(const scale of [.90,.94,.97,1,1.03,1.06,1.10]){const w=base*scale;if(rs[i].start+w*count>bits.length)continue;const modules=eanSample(bits,rs[i].start,w,count);if(!modules)continue;const code=eanDecodeModules(modules);if(code)return code;}}return null;}
function eanDecodeRow(values){const bits=eanBinarize(values);if(!bits)return null;return eanTryRuns(bits,95)||eanTryRuns(bits,67)||eanTryRuns([...bits].reverse(),95)||eanTryRuns([...bits].reverse(),67);}
function decodeEANFromImageData(imageData){
  const {data,width,height}=imageData,rows=[.30,.38,.46,.50,.54,.62,.70].map(v=>Math.max(0,Math.min(height-1,Math.floor(height*v))));
  for(const y of rows){const values=[];for(let x=0;x<width;x++){const p=(y*width+x)*4;values.push(.299*data[p]+.587*data[p+1]+.114*data[p+2]);}const code=eanDecodeRow(values);if(code)return code;}
  return null;
}

class AhShoppingCard extends HTMLElement {
  constructor(){super(); this.attachShadow({mode:'open'}); this._config={}; this._hass=null; this._listScrollTop=0; this._scanner=null; this._scanLoop=null; this._scanVideoFrame=null; this._scanAnimationFrame=null; this._decodeWorker=null; this._workerPending=null; this._scanGeneration=0; this._scanCooldownUntil=0; this._facing='user'; this._message=''; this._lastEntitySig=null; this._barcodeDetector=null; this._zxingReader=null; this._decoderMode='local'; this._cameraInfo=''; this._scanCount=0; this._scanBusy=false; this._scanProcessing=false; this._scanQueue=[]; this._heldBarcode=''; this._heldBarcodeLastSeen=0; this._barcodeAbsentSince=0; this._audioContext=null; this._scanProduct=null; this._scanPendingQty=new Map(); this._scanQtyWorkers=new Map(); this._pendingQty=new Map(); this._rowRemovals=new Map(); this._qtyWorkers=new Map(); this._stableItemOrder=new Map(); this._stableItemSeq=0; this._scanInlineActive=false; this._scanRecent=[]; this._scanRecentTimer=null; this._intersecting=false; this._visibilityObserver=null; this._visibilitySetup=false; this._cameraStarting=false; this._digitalZoom=1; this._nativeZoom=1; this._decoderMisses=0; this._scannerRoute=''; this._autoScannerRoute=''; this._autoVisitArmed=true; this._scanTimer=null; this._scanTimerTick=null; this._scanDeadline=0; this._listScrollAnchor=null; this._scanBandCanvas=null; this._scanStatusTimer=null; this._isAndroid=/Android/i.test(navigator.userAgent||''); window.__ahShoppingScanOrder=window.__ahShoppingScanOrder||{seq:0,products:new Map()}; this._scanOrderState=window.__ahShoppingScanOrder; window.__ahShoppingListRefresh=window.__ahShoppingListRefresh||{last:0}; this._listRefreshState=window.__ahShoppingListRefresh; this._listRefreshTimer=null; this._photoInput=null; this._visibilityHandler=()=>{this._syncScannerVisibility();this._syncListRefresh();}; this._locationHandler=()=>requestAnimationFrame(()=>this._handleLocationChange());}
  static getStubConfig(){return {show_header:true,show_scan:true,show_products:true,product_source:'shopping_list',scanner_mode:'button',scan_camera:'front',scan_zoom:2,scan_decoder:'auto'};}
  static getConfigForm(){return {schema:[
    {name:'title',selector:{text:{}}},
    {name:'show_header',selector:{boolean:{}}},
    {name:'show_scan',selector:{boolean:{}}},
    {name:'show_products',selector:{boolean:{}}},
    {name:'scanner_mode',selector:{select:{options:[
      {value:'button',label:'Via scan button'},
      {value:'button_auto',label:'Via scan button — start active'},
      {value:'permanent',label:'Permanent camera feed'}
    ]}}},
    {name:'scan_camera',selector:{select:{options:[
      {value:'front',label:'Front camera'},
      {value:'rear',label:'Rear camera'}
    ]}}},
    {name:'scan_zoom',selector:{number:{min:1,max:4,step:0.25,mode:'slider'}}},
    {name:'scan_decoder',selector:{select:{options:[
      {value:'auto',label:'Auto (recommended)'},
      {value:'wasm',label:'ZXing-C++ (WebAssembly)'},
      {value:'zxing',label:'ZXing (legacy)'},
      {value:'native',label:'Native BarcodeDetector'},
      {value:'local',label:'Local EAN'}
    ]}}},
    {name:'product_source',selector:{select:{options:[
      {value:'shopping_list',label:'Winkelmandje'},
      {value:'next_order',label:'Volgende bestelling'},
      {value:'shopping_list_and_order',label:'Winkelmandje + volgende bestelling'}
    ]}}},
    {name:'scan_label',selector:{text:{}}}
  ]};}
  setConfig(config){
    const legacyScanOnly=config.mode==='scan_only';
    const legacySource=config.product_source==='cart'
      ? 'shopping_list'
      : config.product_source==='cart_and_order'
        ? 'shopping_list_and_order'
        : config.product_source;
    const previousCamera=this._config.scan_camera;
    const previousZoom=this._config.scan_zoom;
    const previousDecoder=this._config.scan_decoder;
    const previousMode=this._config.scanner_mode;
    const {height:_legacyHeight,...cleanConfig}=config;
    this._config={
      show_header:legacyScanOnly?false:true,
      show_scan:true,
      show_products:legacyScanOnly?false:true,
      product_source:'shopping_list',
      scan_label:'Scan product',
      scanner_mode:'button',
      scan_camera:'front',
      scan_zoom:2,
      scan_decoder:'auto',
      ...cleanConfig,
      ...(legacySource?{product_source:legacySource}:{})
    };
    if(previousMode!==this._config.scanner_mode){
      this._autoScannerRoute='';
      this._autoVisitArmed=true;
    }
    this._config.scan_zoom=Math.min(4,Math.max(1,Number(this._config.scan_zoom||2)));
    this._facing=this._config.scan_camera==='rear'?'environment':'user';

    if(this._config.scanner_mode==='permanent'){
      this._clearScannerTimer();
      this._scanInlineActive=true;
    }else if(this._config.scanner_mode==='button_auto'&&previousMode!=='button_auto'){
      this._clearScannerTimer();
      this._scanInlineActive=true;
    }else if(previousMode==='permanent'||previousMode==='button_auto'&&this._config.scanner_mode!=='button_auto'){
      this._scanInlineActive=false;
      this._scannerRoute='';
      this._clearScanSession();
    }

    if(this._stream&&(
      previousCamera!==this._config.scan_camera||
      Number(previousZoom)!==this._config.scan_zoom||
      previousDecoder!==this._config.scan_decoder
    )){
      this._stopCamera();
    }
    this._render();
  }
  set hass(hass){
    this._hass=hass;
    const entities=[this._entity(),this._orderEntity()].filter(Boolean);
    const sig=entities.map(e=>`${e.entity_id}|${e.last_updated}`).join(';')||'none';

    // A permanent scanner can be rendered before HA entities are available.
    // Keep its header bound to live entity data on every hass update so it
    // cannot remain stuck at the initial zero/empty placeholder values.
    if(this._scanner){
      this._lastEntitySig=sig;
      this._updateHeaderOnly();
      return;
    }

    if(sig!==this._lastEntitySig){
      this._lastEntitySig=sig;
      this._render();
    }
  }
  getCardSize(){
    if(this._config.show_products===false&&this._config.show_header===false)return 1;
    return 7;
  }
  getGridOptions(){
    const permanent=this._config.scanner_mode==='permanent';
    const compact=this._config.show_products===false&&!permanent;
    return {
      columns:12,
      rows:compact?2:6,
      min_columns:6,
      min_rows:compact?1:2
    };
  }
  _entity(){
    if(!this._hass)return null;
    if(this._config.entity){
      const selected=this._hass.states[this._config.entity];
      if(selected?.attributes?.ah_shopping_list===true)return selected;
    }
    return Object.values(this._hass.states).find(s=>s.attributes?.ah_shopping_list===true)||null;
  }
  _orderEntity(){if(!this._hass)return null;return Object.values(this._hass.states).find(s=>s.attributes?.ah_next_order===true)||null;}
  _stableItemKey(item,scope){
    const productId=Number(item?.product_id||0);
    const rawId=item?.list_item_id??item?.id??'';
    const fallback=String(item?.title||item?.description||'').trim().toLowerCase();
    const key=productId>0?`p:${productId}`:rawId?`i:${rawId}`:`t:${fallback}`;
    return `${scope}:${key}`;
  }
  _stableItems(items,scope){
    const rows=Array.isArray(items)?items.filter(i=>i&&typeof i==='object'):[];
    for(const item of rows){
      const key=this._stableItemKey(item,scope);
      if(!this._stableItemOrder.has(key)){
        this._stableItemOrder.set(key,this._stableItemSeq++);
      }
    }
    return rows.sort((a,b)=>
      this._stableItemOrder.get(this._stableItemKey(a,scope))-
      this._stableItemOrder.get(this._stableItemKey(b,scope))
    );
  }

  _promoteScannedProduct(productId){
    const pid=Number(productId||0);
    if(pid<=0)return;
    this._scanOrderState.products.set(pid,++this._scanOrderState.seq);
  }

  _chronologicalShoppingItems(items,scope='shopping_list'){
    return this._stableItems(items,scope).sort((a,b)=>{
      const aSeq=this._scanOrderState.products.get(Number(a?.product_id||a?.id||0))||0;
      const bSeq=this._scanOrderState.products.get(Number(b?.product_id||b?.id||0))||0;
      return bSeq-aSeq;
    });
  }

  _combinedItems(listItems,orderItems){
    const map=new Map();

    const add=(raw,source)=>{
      const key=raw.product_id>0?`p:${raw.product_id}`:`t:${String(raw.title||'').toLowerCase()}`;
      let item=map.get(key);
      if(!item){
        item={
          ...raw,
          quantity:0,
          shopping_quantity:0,
          order_quantity:0,
          combined:true
        };
        map.set(key,item);
      }else{
        if(!item.image_url&&raw.image_url)item.image_url=raw.image_url;
        if(!item.price_now&&raw.price_now)item.price_now=raw.price_now;
        if(!item.unit_size&&raw.unit_size)item.unit_size=raw.unit_size;
        if(!item.is_bonus&&raw.is_bonus){
          item.is_bonus=raw.is_bonus;
          item.bonus_mechanism=raw.bonus_mechanism||'';
        }
      }

      const qty=Number(raw.quantity||0);
      if(source==='shopping')item.shopping_quantity+=qty;
      else item.order_quantity+=qty;
      item.quantity=item.shopping_quantity+item.order_quantity;
    };

    for(const raw of Array.isArray(listItems)?listItems.filter(Boolean):[])add(raw,'shopping');
    for(const raw of Array.isArray(orderItems)?orderItems.filter(Boolean):[])add(raw,'order');
    return [...map.values()];
  }
  _viewData(){
    const source=this._config.product_source||'shopping_list';
    const list=this._entity()?.attributes||{};
    const order=this._orderEntity()?.attributes||{};

    if(source==='next_order'){
      return {
        items:this._stableItems(order.items||[],'next_order'),
        total_quantity:order.total_quantity||0,
        total_price:order.estimated_product_total??order.total_price??0,
        total_estimated:order.estimated_product_total!=null,
        bonus_savings:order.bonus_savings||0,
        bonus_savings_estimated:order.bonus_savings_estimated===true,
        unique_items:order.unique_items||0,
        label:'Volgende bestelling',
        edit_source:null,
        entity:this._orderEntity(),
        delivery:order.delivery_date_display||order.delivery_date||'',
        time:order.delivery_time_display||''
      };
    }

    if(source==='shopping_list_and_order'){
      const includeOrder=order.is_after_cut_off!==true;
      const orderItems=includeOrder?(order.items||[]):[];
      const items=this._chronologicalShoppingItems(this._combinedItems(list.items||[],orderItems),'combined');
      return {
        items,
        total_quantity:items.reduce((sum,i)=>sum+Number(i.quantity||0),0),
        total_price:Number(list.estimated_total||0)+(includeOrder?Number(order.estimated_product_total??order.total_price??0):0),
        total_estimated:includeOrder&&order.estimated_product_total!=null,
        unique_items:items.length,
        label:'Winkelmandje + bestelling',
        edit_source:'shopping_list',
        combined:true,
        entity:this._entity()||(includeOrder?this._orderEntity():null),
        delivery:includeOrder?(order.delivery_date_display||order.delivery_date||''):'',
        time:includeOrder?(order.delivery_time_display||''):'',
        bonus_savings:Number(list.bonus_savings||0)+(includeOrder?Number(order.bonus_savings||0):0),
        bonus_savings_estimated:includeOrder&&order.bonus_savings_estimated===true,
        order_included:includeOrder,
        order_after_cut_off:order.is_after_cut_off===true,
        order_closing_date_time:order.closing_date_time||''
      };
    }

    return {
      items:this._chronologicalShoppingItems(list.items||[]),
      total_quantity:list.total_quantity||0,
      total_price:list.estimated_total||0,
      unique_items:list.unique_items||0,
      label:'Winkelmandje',
      edit_source:'shopping_list',
      entity:this._entity(),
      bonus_savings:list.bonus_savings||0,
      pending_changes:list.pending_changes||0
    };
  }
  _esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  _money(n){return new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR'}).format(Number(n||0));}
  async _service(service,data={}){if(!this._hass)throw new Error('Home Assistant is niet beschikbaar'); const result=await this._hass.callWS({type:'call_service',domain:'ah_shopping',service,service_data:data,return_response:true}); return result?.response||{};}
  _quantityKey(source,pid){return `${source}:${pid}`;}
  _cancelRowRemoval(key){
    const removal=this._rowRemovals.get(key);
    if(removal)clearTimeout(removal.timer);
    this._rowRemovals.delete(key);
  }

  _setQuantity(source,pid,target){
    const key=this._quantityKey(source,pid);
    const view=this._viewData();
    const item=(view.items||[]).find(i=>Number(i.product_id)===pid);
    this._pendingQty.set(key,target);
    if(target===0&&item&&!(view.combined&&Number(item.order_quantity||0)>0)){
      if(!this._rowRemovals.has(key)){
        const removal={source,pid,item:{...item},index:view.items.indexOf(item),phase:'waiting',height:0,timer:null};
        this._rowRemovals.set(key,removal);
        removal.timer=setTimeout(()=>this._beginRowRemoval(key),REMOVAL_UNDO_MS);
      }
      this._render();
      return;
    }
    this._cancelRowRemoval(key);
    this._render();
    this._queueQuantityWrite(source,pid);
  }

  _adjustQuantity(source,pid,current,delta){
    const key=this._quantityKey(source,pid);
    const base=this._pendingQty.has(key)?this._pendingQty.get(key):Number(current||0);
    this._setQuantity(source,pid,Math.max(0,base+delta));
  }

  _remove(source,pid){this._setQuantity(source,pid,0);}

  _beginRowRemoval(key){
    const removal=this._rowRemovals.get(key);
    if(!removal||this._pendingQty.get(key)!==0)return;
    clearTimeout(removal.timer);
    const row=[...this.shadowRoot.querySelectorAll('[data-row-key]')].find(el=>el.dataset.rowKey===this._rowDomKey(removal.item));
    if(row){
      removal.height=row.getBoundingClientRect().height;
      row.style.height=`${removal.height}px`;
      void row.offsetHeight; // Give the transition a numeric starting height.
    }
    removal.phase='closing';
    this._render();
    const duration=window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:REMOVAL_ANIMATION_MS;
    removal.timer=setTimeout(()=>{
      if(this._rowRemovals.get(key)!==removal)return;
      removal.phase='committing';
      this._render();
      this._queueQuantityWrite(removal.source,removal.pid);
    },duration);
  }

  _itemsForRender(view){
    const items=[...(view.items||[])];
    for(const [key,removal] of this._rowRemovals){
      if(removal.source!==view.edit_source)continue;
      const index=items.findIndex(i=>Number(i.product_id)===removal.pid);
      if(removal.phase==='committing'){
        if(index>=0)items.splice(index,1);
        else if(!this._pendingQty.has(key))this._cancelRowRemoval(key);
      }else if(index<0){
        // Keep the undo row even when a refresh temporarily omits the item.
        items.splice(Math.min(removal.index,items.length),0,{...removal.item,quantity:0,shopping_quantity:0});
      }
    }
    return items;
  }

  _queueQuantityWrite(source,pid){
    const key=this._quantityKey(source,pid);
    if(this._rowRemovals.has(key)&&this._rowRemovals.get(key).phase!=='committing')return;
    if(this._qtyWorkers.has(key))return;
    const worker=(async()=>{
      while(this._pendingQty.has(key)){
        if(this._rowRemovals.has(key)&&this._rowRemovals.get(key).phase!=='committing')break;
        const target=this._pendingQty.get(key);
        try{
          await this._service('set_quantity',{product_id:pid,quantity:target});
        }catch(e){
          this._pendingQty.delete(key);
          this._cancelRowRemoval(key);
          this._toast(e.message||String(e),true);
          break;
        }
        if(this._pendingQty.get(key)===target){
          this._pendingQty.delete(key);
          this._render();
          break;
        }
      }
    })().finally(()=>this._qtyWorkers.delete(key));
    this._qtyWorkers.set(key,worker);
  }

  _toast(msg,error=false){this._message=msg;this._messageError=error;this._render();clearTimeout(this._msgTimer);this._msgTimer=setTimeout(()=>{this._message='';this._render();},2800);}

  _rowDomKey(item){
    const productId=Number(item?.product_id||item?.id||0);
    if(productId>0)return `p:${productId}`;
    const rawId=item?.item_id??item?.list_item_id??'';
    if(rawId)return `i:${rawId}`;
    return `t:${String(item?.title||item?.description||'').trim().toLowerCase()}`;
  }

  _captureListScroll(){
    const list=this.shadowRoot?.querySelector('.items');
    if(!list)return;
    this._listScrollTop=list.scrollTop;
    const listRect=list.getBoundingClientRect();
    const rows=[...list.querySelectorAll('[data-row-key]')];
    const anchor=rows.find(row=>row.getBoundingClientRect().bottom>listRect.top+1);
    this._listScrollAnchor=anchor
      ? {key:anchor.dataset.rowKey,offset:anchor.getBoundingClientRect().top-listRect.top,
          fallbacks:rows.filter(row=>row!==anchor).map(row=>({key:row.dataset.rowKey,offset:row.getBoundingClientRect().top-listRect.top}))}
      : null;
  }

  _restoreListScroll(){
    const list=this.shadowRoot?.querySelector('.items');
    if(!list)return;
    const anchorState=this._listScrollAnchor;
    const restore=()=>{
      if(!list.isConnected)return;
      list.scrollTop=this._listScrollTop;
      if(anchorState){
        const rows=[...list.querySelectorAll('[data-row-key]')];
        const anchor=[anchorState,...(anchorState.fallbacks||[])].find(candidate=>rows.some(el=>el.dataset.rowKey===candidate.key));
        const row=anchor&&rows.find(el=>el.dataset.rowKey===anchor.key);
        if(row){
          const delta=(row.getBoundingClientRect().top-list.getBoundingClientRect().top)-anchor.offset;
          if(Math.abs(delta)>.5)list.scrollTop+=delta;
        }
      }
      this._listScrollTop=list.scrollTop;
    };
    restore();
    // Restore synchronously: delayed frames can override a user's next scroll.
    if(!list._ahScrollBound){
      list._ahScrollBound=true;
      list.addEventListener('scroll',()=>{this._listScrollTop=list.scrollTop;},{passive:true});
    }
  }

  _headerValues(){
    const view=this._viewData();
    const items=view.items||[];
    const title=this._config.title||view.label;
    const sourceAvailable=Boolean(view.entity);
    const syncText=view.pending_changes? ` · ${view.pending_changes} wijziging${view.pending_changes===1?'':'en'} bezig` : '';

    if(!sourceAvailable){
      return {view,title,leftNote:'',totalMeta:'',total:'—'};
    }

    const articleCount=Number(view.unique_items??items.length);
    const articleText=`${articleCount} ${articleCount===1?'artikel':'artikelen'}`;
    const leftNote=view.delivery
      ? `${view.delivery}${view.time?` · ${view.time}`:''}${syncText}`
      : `${view.total_quantity??0} stuks${syncText}`;
    const totalMeta=[view.bonus_savings? `Bonus −${this._money(view.bonus_savings)}`:'',articleText].filter(Boolean).join(' · ');
    return {view,title,leftNote,totalMeta,total:this._money(view.total_price||0)};
  }

  _updateHeaderOnly(){
    if(this._config.show_header===false||!this.shadowRoot)return;
    const {title,leftNote,totalMeta,total}=this._headerValues();
    const titleEl=this.shadowRoot.querySelector('.head .title');
    const totalEl=this.shadowRoot.querySelector('.head .total');
    const subEl=this.shadowRoot.querySelector('.head .headerSub');
    const metaEl=this.shadowRoot.querySelector('.head .headerMeta');
    if(titleEl)titleEl.textContent=title;
    if(totalEl)totalEl.textContent=total;
    if(subEl)subEl.textContent=leftNote;
    if(metaEl)metaEl.textContent=totalMeta;
  }

  _render(){
    if(!this.shadowRoot)return;

    if(this._stream)this._stopCamera();

    this._captureListScroll();

    const {view,title,leftNote,totalMeta,total}=this._headerValues();
    const entity=view.entity;
    const items=this._itemsForRender(view);
    const showHeader=this._config.show_header!==false;
    const showScan=this._config.show_scan!==false;
    const showProducts=this._config.show_products!==false;
    const permanent=this._config.scanner_mode==='permanent';
    const scannerActive=permanent||this._scanInlineActive;
    const scanLabel=this._config.scan_label||'Scan product';
    const cardClass='fullCard';

    const header=showHeader
      ? `<div class="head"><div class="title">${this._esc(title)}</div><div class="total">${this._esc(total)}</div><div class="sub headerSub">${this._esc(leftNote)}</div><div class="headerMeta">${this._esc(totalMeta)}</div></div>`
      : '';
    const scan=showScan&&!scannerActive
      ? `<div class="scanArea"><ha-button id="scan" class="scanWide" appearance="filled"><ha-icon icon="mdi:barcode-scan" slot="start"></ha-icon>${this._esc(scanLabel)}</ha-button></div>`
      : '';
    const products=showProducts
      ? `<div class="items">${items.length?items.map(i=>this._item(i,view.edit_source||null,view.combined===true)).join(''):`<div class="empty">Geen producten in ${this._esc(view.label.toLowerCase())}.</div>`}</div>`
      : '';
    const body=scannerActive?this._scannerView(permanent):products;

    const markup=`<style>${this._css()}</style><ha-card class="${cardClass}">${header}${!entity&&showProducts&&!scannerActive?'<div class="empty">Deze gegevensbron is nog niet beschikbaar.</div>':''}${scan}${body}${this._message?`<div class="toast ${this._messageError?'error':''}">${this._esc(this._message)}</div>`:''}</ha-card>`;
    // Keep the scroll container, focused buttons and existing product nodes alive.
    // HA publishes optimistic, confirmed and polling updates for the same edit.
    if(!scannerActive&&!this._scanner&&this.shadowRoot.querySelector('ha-card')){
      const template=document.createElement('template');
      template.innerHTML=markup;
      this._patchChildren(this.shadowRoot,template.content);
    }else{
      this.shadowRoot.innerHTML=markup;
    }

    const scanButton=this.shadowRoot.querySelector('#scan');
    if(scanButton)scanButton.onclick=()=>this._openScanner();
    this.shadowRoot.querySelectorAll('[data-minus]').forEach(el=>el.onclick=()=>this._adjustQuantity(el.dataset.source,Number(el.dataset.pid),Number(el.dataset.qty),-1));
    this.shadowRoot.querySelectorAll('[data-plus]').forEach(el=>el.onclick=()=>this._adjustQuantity(el.dataset.source,Number(el.dataset.pid),Number(el.dataset.qty),1));
    this.shadowRoot.querySelectorAll('[data-remove]').forEach(el=>el.onclick=()=>this._remove(el.dataset.source,Number(el.dataset.pid)));


    this._restoreListScroll();

    if(scannerActive){
      this._scanner=this.shadowRoot.querySelector('#inlineScanner');
      this.shadowRoot.querySelector('#scanClose')?.addEventListener('click',()=>this._closeScanner());
      this.shadowRoot.querySelector('#scanAudio')?.addEventListener('click',()=>this._playScanBeep());
      this._updateScanAudio();
      this._renderScanResult();
      requestAnimationFrame(()=>this._syncScannerVisibility());
    }else{
      this._scanner=null;
    }
  }

  _patchChildren(parent,fresh){
    const key=node=>{
      if(node.nodeType!==1)return '';
      for(const action of ['data-plus','data-minus','data-remove','data-scan-plus','data-scan-minus'])if(node.hasAttribute(action))return action;
      return node.getAttribute('data-row-key')||node.id||node.getAttribute('class')||'';
    };
    const existing=[...parent.childNodes];
    const keyed=new Map(existing.filter(key).map(node=>[key(node),node]));
    const used=new Set();
    let cursor=parent.firstChild;
    for(const next of [...fresh.childNodes]){
      const id=key(next);
      let current=id?keyed.get(id):existing.find(node=>!used.has(node)&&!key(node)&&node.nodeType===next.nodeType&&node.nodeName===next.nodeName);
      if(!current||current.nodeName!==next.nodeName){
        current=next.cloneNode(true);
        parent.insertBefore(current,cursor);
      }else{
        if(current!==cursor)parent.insertBefore(current,cursor);
        if(current.nodeType===1){
          for(const attr of [...current.attributes])if(!next.hasAttribute(attr.name))current.removeAttribute(attr.name);
          for(const attr of [...next.attributes])if(current.getAttribute(attr.name)!==attr.value)current.setAttribute(attr.name,attr.value);
          this._patchChildren(current,next);
        }else if(current.textContent!==next.textContent){
          current.textContent=next.textContent;
        }
      }
      used.add(current);
      cursor=current.nextSibling;
    }
    for(const node of existing)if(!used.has(node))node.remove();
  }

  _scannerView(permanent){
    return `<div id="inlineScanner" class="inlineScanner">
      <video playsinline muted autoplay></video>
      <div class="scanGuide"></div>
      <div id="scanRecent" class="scanRecent ${permanent?'':'withClose'}"></div>
      ${permanent?'':`<button id="scanClose" class="scanClose" aria-label="Sluit scanner">×</button>`}
      <div class="scanHud">
        <span id="scanstatus" class="scanPill scanStatus" hidden></span>
        <button id="scanAudio" class="scanPill" style="pointer-events:auto" title="Schakel de scanpiep in en speel een testpiep">Geluid aan</button>
        ${permanent?'':`<span id="scanTimer" class="scanPill scanTimer">Auto sluiten · 1:00</span>`}
      </div>
    </div>`;
  }

  _productRow(i,{controls='',compact=false,rowClass='',style='',metaHtml=null,rowKey=''}={}){
    const image=i.image_url
      ? `<img src="${this._esc(i.image_url)}" alt="">`
      : '<div class="ph">🛒</div>';
    const old=i.is_bonus&&i.price_was>i.price_now?`<s>${this._money(i.price_was)}</s> `:'';
    const price=i.price_now?`<span class="price">${old}${this._money(i.price_now)}</span>`:'';
    const bonus=i.is_bonus?`<span class="bonus">BONUS · ${this._esc(i.bonus_mechanism||'Aanbieding')}</span>`:'';
    const details=metaHtml!==null
      ? `<div class="compactMeta">${metaHtml}</div>`
      : `<small>${this._esc(i.unit_size||'')}</small>${price}${bonus}`;
    const classes=['item',compact?'compactItem':'',rowClass].filter(Boolean).join(' ');
    const styleAttr=style?` style="${style}"`:'';
    const keyAttr=rowKey?` data-row-key="${this._esc(rowKey)}"`:'';
    return `<div class="${classes}"${styleAttr}${keyAttr}>${image}<div class="info"><b>${this._esc(i.title||i.description||'Product')}</b>${details}</div>${controls}</div>`;
  }

  _item(i,editSource=null,combined=false){
    const editableQty=combined?Number(i.shopping_quantity||0):Number(i.quantity||0);
    const key=editSource&&i.product_id>0?this._quantityKey(editSource,i.product_id):'';
    const pendingQty=key&&this._pendingQty.has(key)?this._pendingQty.get(key):editableQty;
    const displayQty=combined?pendingQty+Number(i.order_quantity||0):(key&&this._pendingQty.has(key)?pendingQty:Number(i.quantity||0));
    const removal=this._rowRemovals.get(key);
    const rowClass=removal?.phase==='closing'?'rowRemoving':removal?'rowUndo':'';
    const rowStyle=removal?.height?`height:${removal.height}px`:'';

    if(combined){
      const orderQty=Number(i.order_quantity||0);
      const shoppingQty=pendingQty;
      const totalQty=orderQty+shoppingQty;
      const old=i.is_bonus&&i.price_was>i.price_now?`<s>${this._money(i.price_was)}</s> `:'';
      const price=i.price_now?`<span class="price">${old}${this._money(i.price_now)}</span>`:'';
      const bonus=i.is_bonus?`<span class="bonus">BONUS · ${this._esc(i.bonus_mechanism||'Aanbieding')}</span>`:'';
      const breakdown=orderQty>0
        ? `${orderQty} besteld${shoppingQty>0?` · ${shoppingQty} extra`:''}`
        : `${shoppingQty} in winkelmandje`;
      const unit=i.unit_size?`<span class="unitSize">${this._esc(i.unit_size)}</span>`:'';
      const meta=[unit,price,`<span class="combinedBreakdown">${this._esc(breakdown)}</span>`,bonus].filter(Boolean).join('');
      const controls=i.product_id>0
        ? `<div class="qty compactQty combinedQty">${shoppingQty>0?`<button data-minus data-source="${editSource}" data-pid="${i.product_id}" data-qty="${shoppingQty}" aria-label="Verlaag totaal">−</button>`:''}<span title="${orderQty} besteld + ${shoppingQty} winkelmandje">${totalQty}</span><button data-plus data-source="${editSource}" data-pid="${i.product_id}" data-qty="${shoppingQty}" aria-label="Voeg toe aan winkelmandje">+</button></div>`
        : `<div class="qty readonlyQty"><span>${totalQty}×</span></div>`;
      return this._productRow(i,{controls,compact:true,metaHtml:meta,rowKey:this._rowDomKey(i),rowClass,style:rowStyle});
    }

    const old=i.is_bonus&&i.price_was>i.price_now?`<s>${this._money(i.price_was)}</s> `:'';
    const price=i.price_now?`<span class="price">${old}${this._money(i.price_now)}</span>`:'';
    const unit=i.unit_size?`<span class="unitSize">${this._esc(i.unit_size)}</span>`:'';
    const bonus=i.is_bonus?`<span class="bonus">BONUS · ${this._esc(i.bonus_mechanism||'Aanbieding')}</span>`:'';
    const meta=[unit,price,bonus].filter(Boolean).join('');
    const controls=editSource&&i.product_id>0
      ? `<div class="qty compactQty"><button data-minus data-source="${editSource}" data-pid="${i.product_id}" data-qty="${displayQty}" ${displayQty<=0?'disabled':''}>−</button><span>${displayQty}</span><button data-plus data-source="${editSource}" data-pid="${i.product_id}" data-qty="${displayQty}">+</button><button class="trash" data-remove data-source="${editSource}" data-pid="${i.product_id}">×</button></div>`
      : `<div class="qty compactQty readonlyQty"><span>${displayQty}×</span></div>`;
    return this._productRow(i,{controls,compact:true,metaHtml:meta,rowKey:this._rowDomKey(i),rowClass,style:rowStyle});
  }

  _openScanner(){
    if(!navigator.mediaDevices?.getUserMedia){
      // Live camera streams need HTTPS. A photo from the device camera does not,
      // so plain-HTTP dashboards (e.g. the local URL at home) can still scan.
      this._scanFromPhoto();
      return;
    }
    this._armScanAudio();
    this._scanQueue=[];
    this._scanProcessing=false;
    this._heldBarcode='';
    this._heldBarcodeLastSeen=0; this._barcodeAbsentSince=0;
    this._scanProduct=null;
    this._scanRecent=[];
    clearTimeout(this._scanRecentTimer);this._scanRecentTimer=null;
    this._scannerRoute=this._routeKey();
    this._scanInlineActive=true;
    this._render();
    this._armScannerTimer(60000);
  }

  _armScannerTimer(ms){
    if(this._config.scanner_mode==='permanent')return;
    this._clearScannerTimer();
    this._scanDeadline=Date.now()+ms;
    this._updateScannerTimer();
    this._scanTimerTick=setInterval(()=>this._updateScannerTimer(),250);
    this._scanTimer=setTimeout(()=>{
      if(this._scanProcessing||this._scanQueue.length){
        this._armScannerTimer(1000);
        return;
      }
      this._closeScanner();
    },ms);
  }

  _updateScannerTimer(){
    const el=this._scanner?.querySelector('#scanTimer');
    if(!el||!this._scanDeadline)return;
    const seconds=Math.max(0,Math.ceil((this._scanDeadline-Date.now())/1000));
    const minutes=Math.floor(seconds/60);
    el.textContent=`Auto sluiten · ${minutes}:${String(seconds%60).padStart(2,'0')}`;
  }

  _clearScannerTimer(){
    clearTimeout(this._scanTimer);
    clearInterval(this._scanTimerTick);
    this._scanTimer=null;
    this._scanTimerTick=null;
    this._scanDeadline=0;
  }

  _armScanAudio(){
    try{
      const AudioCtx=window.AudioContext||window.webkitAudioContext;
      if(!AudioCtx)return Promise.resolve(false);
      if(!this._audioContext||this._audioContext.state==='closed'){
        this._audioContext=new AudioCtx();
        this._audioContext.onstatechange=()=>this._updateScanAudio();
      }
      this._updateScanAudio();
      const ctx=this._audioContext;
      const ready=ctx.state==='running'?Promise.resolve():ctx.resume();
      return Promise.resolve(ready).then(()=>{this._updateScanAudio();return ctx.state==='running';}).catch(()=>false);
    }catch(e){return Promise.resolve(false);}
  }

  _updateScanAudio(){
    const button=this._scanner?.querySelector('#scanAudio');
    if(button)button.hidden=this._audioContext?.state==='running';
  }

  _playScanBeep(){
    const requested=Date.now();
    return this._armScanAudio().then(ready=>{
    // A blocked resume can resolve on a later gesture. Do not play an old scan.
    if(!ready||Date.now()-requested>500)return;
    try{
      const ctx=this._audioContext;
      if(!ctx)return;
      const now=ctx.currentTime;
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();
      osc.type='square';
      // Synthesized checkout-scanner beep; not an official AH recording.
      osc.frequency.setValueAtTime(2400,now);
      gain.gain.setValueAtTime(0.0001,now);
      gain.gain.exponentialRampToValueAtTime(0.16,now+0.003);
      gain.gain.setValueAtTime(0.16,now+0.095);
      gain.gain.exponentialRampToValueAtTime(0.0001,now+0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.onended=()=>{osc.disconnect();gain.disconnect();};
      osc.stop(now+0.125);
    }catch(e){}
    });
  }

  async _startCamera(){
    if(!this._scanner||!this._shouldScannerRun())return;
    this._stopCamera();
    this._armScanAudio();
    const generation=this._scanGeneration;
    this._scanCount=0;
    this._scanBusy=false;
    const video=this._scanner.querySelector('video');
    try{
      const stream=await navigator.mediaDevices.getUserMedia({
        video:{
          facingMode:{ideal:this._facing},
          width:{ideal:1920},
          height:{ideal:1080},
          frameRate:{ideal:30,max:30}
        },
        audio:false
      });

      if(!this._shouldScannerRun()){
        stream.getTracks().forEach(track=>track.stop());
        return;
      }

      this._stream=stream;
      const track=stream.getVideoTracks()[0];
      await this._tuneCameraTrack(track);
      if(generation!==this._scanGeneration)return;

      video.srcObject=stream;
      this._cameraMirrored=(track.getSettings?.().facingMode||this._facing)==='user';
      video.style.transform=`scale(${this._digitalZoom}) scaleX(${this._cameraMirrored?-1:1})`;
      await video.play();

      this._scanCanvas=document.createElement('canvas');
      this._scanBandCanvas=document.createElement('canvas');
      await this._initScannerEngine();
      if(generation!==this._scanGeneration){this._stopWasmWorker();return;}
      this._setScanStatus('');
      this._scheduleScan();
    }catch(e){
      this._setScanStatus(`Camera: ${e.message||e}`,true);
    }
  }

  async _tuneCameraTrack(track){
    const desired=Math.min(4,Math.max(1,Number(this._config.scan_zoom||2)));
    this._nativeZoom=1;
    this._digitalZoom=desired;
    if(!track?.getCapabilities||!track?.applyConstraints)return;

    try{
      const caps=track.getCapabilities()||{};
      const advanced={};

      if(Array.isArray(caps.focusMode)&&caps.focusMode.includes('continuous')){
        advanced.focusMode='continuous';
      }
      if(Array.isArray(caps.exposureMode)&&caps.exposureMode.includes('continuous')){
        advanced.exposureMode='continuous';
      }
      if(Array.isArray(caps.whiteBalanceMode)&&caps.whiteBalanceMode.includes('continuous')){
        advanced.whiteBalanceMode='continuous';
      }
      if(caps.zoom&&Number.isFinite(Number(caps.zoom.min))&&Number.isFinite(Number(caps.zoom.max))){
        advanced.zoom=Math.min(Number(caps.zoom.max),Math.max(Number(caps.zoom.min),desired));
      }

      if(Object.keys(advanced).length){
        await track.applyConstraints({advanced:[advanced]});
      }

      const settings=track.getSettings?.()||{};
      const appliedZoom=Number(settings.zoom||1);
      this._nativeZoom=Number.isFinite(appliedZoom)&&appliedZoom>0?appliedZoom:1;
      this._digitalZoom=Math.max(1,desired/this._nativeZoom);
    }catch(e){
      this._nativeZoom=1;
      this._digitalZoom=desired;
      console.debug('AH Shopping: camera tuning not supported',e);
    }
  }

  _setScanStatus(text,error=false,timeout=0){
    clearTimeout(this._scanStatusTimer);
    this._scanStatusTimer=null;
    const status=this._scanner?.querySelector('#scanstatus');
    if(!status)return;
    status.textContent=text;
    status.hidden=!text;
    status.classList.toggle('error',Boolean(error));
    if(error&&timeout>0){
      this._scanStatusTimer=setTimeout(()=>{
        if(status.isConnected){
          status.textContent='';
          status.hidden=true;
          status.classList.remove('error');
        }
      },timeout);
    }
  }

  async _initScannerEngine(){
    this._barcodeDetector=null;
    this._zxingReader=null;
    this._decoderMode='local';
    const selected=this._config.scan_decoder||'auto';

    const tryZXing=async()=>{
      try{
        await this._loadZXing();
        if(window.ZXing?.BrowserMultiFormatReader){
          const hints=new Map();
          if(window.ZXing.DecodeHintType&&window.ZXing.BarcodeFormat){
            hints.set(window.ZXing.DecodeHintType.POSSIBLE_FORMATS,[
              window.ZXing.BarcodeFormat.EAN_13,
              window.ZXing.BarcodeFormat.EAN_8,
              window.ZXing.BarcodeFormat.UPC_A,
              window.ZXing.BarcodeFormat.UPC_E
            ]);
            hints.set(window.ZXing.DecodeHintType.TRY_HARDER,true);
          }
          this._zxingReader=new window.ZXing.BrowserMultiFormatReader(hints,80);
          this._decoderMode='zxing';
          return true;
        }
      }catch(e){
        console.warn('AH Shopping: ZXing could not be loaded',e);
      }
      return false;
    };

    const tryNative=async()=>{
      if(!('BarcodeDetector' in window))return false;
      try{
        const wanted=['ean_13','ean_8','upc_a','upc_e'];
        let formats=wanted;
        if(typeof window.BarcodeDetector.getSupportedFormats==='function'){
          const supported=await window.BarcodeDetector.getSupportedFormats();
          formats=wanted.filter(f=>supported.includes(f));
        }
        if(formats.length){
          this._barcodeDetector=new window.BarcodeDetector({formats});
          this._decoderMode='native';
          return true;
        }
      }catch(e){}
      return false;
    };

    if(selected==='auto'||selected==='wasm'){
      try{
        await this._initWasmWorker();
        this._decoderMode='wasm';
        return;
      }catch(error){
        this._stopWasmWorker();
        if(selected==='wasm')throw error;
        console.warn('AH Shopping: WASM unavailable, trying other decoders',error);
      }
    }

    if(selected==='local'){
      this._decoderMode='local';
      return;
    }

    if(selected==='native'){
      if(await tryNative())return;
      throw new Error('Native BarcodeDetector wordt niet ondersteund door deze browser. Kies Auto, ZXing of Local EAN.');
    }

    if(selected==='zxing'){
      if(await tryZXing())return;
      throw new Error('ZXing kon niet worden geladen. Kies Auto, Native BarcodeDetector of Local EAN.');
    }

    // Auto: ZXing first, Native ready as sampled fallback, Local EAN last.
    if(await tryZXing()){
      const primary=this._decoderMode;
      await tryNative();
      this._decoderMode=primary;
      return;
    }
    if(await tryNative())return;
    this._decoderMode='local';
  }

  async _loadZXing(){
    if(window.ZXing?.BrowserMultiFormatReader)return;
    if(window.__ahShoppingZXingPromise){await window.__ahShoppingZXingPromise;return;}
    window.__ahShoppingZXingPromise=new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-ah-shopping-zxing]');
      if(existing){
        existing.addEventListener('load',resolve,{once:true});
        existing.addEventListener('error',()=>reject(new Error('ZXing kon niet worden geladen')),{once:true});
        if(window.ZXing?.BrowserMultiFormatReader)resolve();
        return;
      }
      const script=document.createElement('script');
      script.src='https://cdn.jsdelivr.net/npm/@zxing/library@0.23.0/umd/index.min.js';
      script.async=true;
      script.dataset.ahShoppingZxing='true';
      script.onload=()=>resolve();
      script.onerror=()=>reject(new Error('ZXing CDN kon niet worden geladen'));
      document.head.appendChild(script);
    });
    await window.__ahShoppingZXingPromise;
  }

  _scheduleScan(){
    this._cancelScheduledScan();
    const remaining=this._scanCooldownUntil-Date.now();
    this._scanner?.classList?.toggle('scanCooldown',remaining>0);
    if(!this._scanner||!this._stream)return;
    if(remaining>0){
      this._scanLoop=setTimeout(()=>this._scheduleScan(),remaining);
    }else{
      // Keep decoding even when a browser exposes frame callbacks but never
      // delivers them. RAF starts the next attempt without an artificial delay.
      this._scanAnimationFrame=requestAnimationFrame(()=>{this._scanAnimationFrame=null;this._scanFrame();});
    }
  }

  _cancelScheduledScan(){
    clearTimeout(this._scanLoop);this._scanLoop=null;
    if(this._scanVideoFrame!=null)this._scanner?.querySelector('video')?.cancelVideoFrameCallback?.(this._scanVideoFrame);
    this._scanVideoFrame=null;
    if(this._scanAnimationFrame!=null)cancelAnimationFrame(this._scanAnimationFrame);
    this._scanAnimationFrame=null;
  }

  _stopWasmWorker(){
    this._decodeWorker?.terminate();this._decodeWorker=null;
    if(this._workerPending){this._workerPending.reject(new Error('Scanner stopped'));this._workerPending=null;}
  }

  async _initWasmWorker(){
    this._stopWasmWorker();
    const worker=new Worker('/ah_shopping/barcode-worker.js?v=0.2.28');
    this._decodeWorker=worker;
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Barcode decoder could not be loaded')),10000);
      worker.onmessage=event=>{
        clearTimeout(timeout);
        if(event.data.ready)resolve();else reject(new Error(event.data.error||'Barcode decoder startup failed'));
      };
      worker.onerror=event=>{clearTimeout(timeout);reject(new Error(event.message||'Barcode worker failed'));};
    });
    worker.onmessage=event=>{
      const pending=this._workerPending;
      if(!pending||event.data.id!==pending.id)return;
      this._workerPending=null;
      if(event.data.error)pending.reject(new Error(event.data.error));else pending.resolve(event.data.code||'');
    };
    worker.onerror=event=>{
      const pending=this._workerPending;this._workerPending=null;
      pending?.reject(new Error(event.message||'Barcode worker failed'));
    };
  }

  _scanFromPhoto(){
    this._armScanAudio();
    if(!this._photoInput){
      const input=document.createElement('input');
      input.type='file';input.accept='image/*';input.setAttribute('capture','environment');
      input.style.display='none';
      input.addEventListener('change',()=>{
        const file=input.files?.[0];input.value='';
        if(file)this._addBarcodeFromPhoto(file);
      });
      document.body.append(input);
      this._photoInput=input;
    }
    this._photoInput.click();
  }

  async _photoImageData(file){
    const bitmap=await createImageBitmap(file);
    try{
      const scale=Math.min(1,PHOTO_MAX_SIDE/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));
      canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      return ctx.getImageData(0,0,canvas.width,canvas.height);
    }finally{bitmap.close?.();}
  }

  _decodePhoto(image){
    // A short-lived worker of its own: the live scanner stops and restarts its
    // worker with the camera lifecycle, which must not cancel a photo decode.
    return new Promise((resolve,reject)=>{
      const worker=new Worker('/ah_shopping/barcode-worker.js?v=0.2.28');
      const done=(fn,value)=>{clearTimeout(timeout);worker.terminate();fn(value);};
      const timeout=setTimeout(()=>done(reject,new Error('Barcode decoder antwoordt niet')),15000);
      worker.onerror=event=>done(reject,new Error(event.message||'Barcode worker failed'));
      worker.onmessage=({data})=>{
        if(data.ready){
          worker.postMessage({id:1,width:image.width,height:image.height,pixels:image.data.buffer,harder:true,mode:'full'},[image.data.buffer]);
        }else if(data.id===1){
          if(data.error)done(reject,new Error(data.error));else done(resolve,data.code||'');
        }else if(data.error){
          done(reject,new Error(data.error));
        }
      };
    });
  }

  async _addBarcodeFromPhoto(file){
    this._toast('Foto wordt gelezen…');
    let code='';
    try{
      code=await this._decodePhoto(await this._photoImageData(file));
    }catch(error){
      console.warn('AH Shopping: photo decoding failed',error);
    }
    if(!code){
      this._toast('Geen barcode gevonden. Fotografeer de streepjescode recht en scherp.',true);
      return;
    }
    try{
      const r=await this._service('add_barcode',{barcode:code,quantity:1});
      const p=r.product||{};
      this._playScanBeep();
      if(navigator.vibrate)navigator.vibrate(70);
      this._toast(`${p.title||code} toegevoegd (${Math.max(1,Number(p.quantity_on_list||1))}×)`);
    }catch(error){
      this._toast(String(error?.message||error||'Toevoegen mislukt'),true);
    }
  }

  _decodeWasm(image,harder,mode='auto'){
    return new Promise((resolve,reject)=>{
      if(!this._decodeWorker){reject(new Error('Barcode worker unavailable'));return;}
      const id=this._scanCount;
      const timeout=setTimeout(()=>{
        if(this._workerPending?.id===id)this._workerPending=null;
        reject(new Error('Barcode decoder antwoordt niet'));
      },2000);
      const pending={id,
        resolve:code=>{clearTimeout(timeout);resolve(code);},
        reject:error=>{clearTimeout(timeout);reject(error);}
      };
      this._workerPending=pending;
      try{
        this._decodeWorker.postMessage({id,width:image.width,height:image.height,pixels:image.data.buffer,harder,mode},[image.data.buffer]);
      }catch(error){this._workerPending=null;pending.reject(error);}
    });
  }

  _detectNative(canvas){
    const detector=this._barcodeDetector;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{
        if(this._barcodeDetector===detector)this._barcodeDetector=null;
        reject(new Error('Browserdecoder antwoordt niet'));
      },1000);
      Promise.resolve().then(()=>detector.detect(canvas)).then(
        value=>{clearTimeout(timeout);resolve(value);},
        error=>{clearTimeout(timeout);reject(error);}
      );
    });
  }

  _scanSourceRect(video){
    const vw=video.videoWidth,vh=video.videoHeight;
    const stage=this._scanner;
    const guide=stage?.querySelector('.scanGuide');
    if(!stage||!guide||!vw||!vh){
      const sw=Math.floor(vw*.62/Math.max(1,Number(this._digitalZoom||1)));
      const sh=Math.floor(vh*.24/Math.max(1,Number(this._digitalZoom||1)));
      return {sx:Math.max(0,Math.floor((vw-sw)/2)),sy:Math.max(0,Math.floor((vh-sh)/2)),sw,sh};
    }

    const stageRect=stage.getBoundingClientRect();
    const guideRect=guide.getBoundingClientRect();
    const cw=stageRect.width,ch=stageRect.height;
    if(cw<=0||ch<=0)return {sx:0,sy:0,sw:vw,sh:vh};

    const zoom=Math.max(1,Number(this._digitalZoom||1));
    const inverseZoom=(value,center)=>(value-center)/zoom+center;

    const gx1=guideRect.left-stageRect.left;
    const gy1=guideRect.top-stageRect.top;
    const gx2=guideRect.right-stageRect.left;
    const gy2=guideRect.bottom-stageRect.top;

    let ux1=inverseZoom(gx1,cw/2);
    const uy1=inverseZoom(gy1,ch/2);
    let ux2=inverseZoom(gx2,cw/2);
    const uy2=inverseZoom(gy2,ch/2);
    // The decoder reads the original camera pixels. Map the mirrored preview
    // guide back to those pixels; overlays and barcode data remain unmirrored.
    if(this._cameraMirrored)[ux1,ux2]=[cw-ux2,cw-ux1];

    const coverScale=Math.max(cw/vw,ch/vh);
    const displayedW=vw*coverScale;
    const displayedH=vh*coverScale;
    const offsetX=(cw-displayedW)/2;
    const offsetY=(ch-displayedH)/2;

    let sx=(ux1-offsetX)/coverScale;
    let sy=(uy1-offsetY)/coverScale;
    let ex=(ux2-offsetX)/coverScale;
    let ey=(uy2-offsetY)/coverScale;

    sx=Math.max(0,Math.min(vw-1,sx));
    sy=Math.max(0,Math.min(vh-1,sy));
    ex=Math.max(sx+1,Math.min(vw,ex));
    ey=Math.max(sy+1,Math.min(vh,ey));

    // Include the quiet zones outside the drawn guide; clipping these makes
    // an otherwise sharp EAN unreadable, especially on portrait tablets.
    const padX=(ex-sx)*.15,padY=(ey-sy)*.15;
    const left=Math.floor(Math.max(0,sx-padX)),top=Math.floor(Math.max(0,sy-padY));
    return {sx:left,sy:top,
      sw:Math.max(1,Math.floor(Math.min(vw,ex+padX))-left),
      sh:Math.max(1,Math.floor(Math.min(vh,ey+padY))-top)};
  }

  async _scanFrame(){
    if(!this._scanner||!this._stream||this._scanBusy)return;
    if(Date.now()<this._scanCooldownUntil){this._scheduleScan();return;}
    if(!this._shouldScannerRun()){
      if(this._scannerRoute&&this._routeKey()!==this._scannerRoute)this._clearScanSession();
      this._stopCamera();
      return;
    }
    const video=this._scanner.querySelector('video');
    if(video.readyState<2||!video.videoWidth){this._scheduleScan();return;}
    // RAF can run twice as fast as the camera. Decode each captured frame once,
    // rather than spending tablet CPU on a repeated image. No retry delay.
    const captured=video.getVideoPlaybackQuality?.().totalVideoFrames;
    const frameTime=captured>0?captured:video.currentTime;
    const frameNow=performance.now();
    // Some WebViews round timestamps or stop advancing the frame counter.
    // Retry them within 80 ms rather than letting this optimisation stall.
    if(Number.isFinite(frameTime)&&frameTime===this._lastScanFrameTime&&frameNow-this._lastScanFrameAt<80){this._scheduleScan();return;}
    this._lastScanFrameTime=frameTime;
    this._lastScanFrameAt=frameNow;

    const generation=this._scanGeneration;
    this._scanBusy=true;
    this._scanCount++;
    let code=null;

    try{
      const c=this._scanCanvas,ctx=c.getContext('2d',{willReadFrequently:true});
      const expand=this._decoderMisses>=2&&this._scanCount%4===0;
      const {sx,sy,sw,sh}=expand
        ? {sx:0,sy:0,sw:video.videoWidth,sh:video.videoHeight}
        : this._scanSourceRect(video);
      const targetWidth=Math.min(this._decoderMode==='wasm'?1600:(expand?1280:1200),sw);
      const width=Math.max(1,targetWidth),height=Math.max(1,Math.floor(sh*width/sw));
      const drawFull=()=>{
        if(c.width!==width)c.width=width;
        if(c.height!==height)c.height=height;
        ctx.drawImage(video,sx,sy,sw,sh,0,0,width,height);
      };
      if(this._decoderMode!=='wasm')drawFull();

      if(this._decoderMode==='wasm'){
        // C++ runs independently of browser BarcodeDetector promises, which can
        // hang indefinitely on some camera/browser combinations.
        // Read and transfer only the strip first, rather than reading the
        // whole crop just to discard most of it inside the worker.
        const band=this._scanBandCanvas ||= document.createElement('canvas');
        const bandHeight=Math.min(96,height),sourceHeight=bandHeight*sw/width;
        if(band.width!==width)band.width=width;
        if(band.height!==bandHeight)band.height=bandHeight;
        const bandCtx=band.getContext('2d',{willReadFrequently:true});
        bandCtx.drawImage(video,sx,sy+(sh-sourceHeight)/2,sw,sourceHeight,0,0,width,bandHeight);
        const harder=this._decoderMisses>=2&&this._scanCount%3===0;
        code=await this._decodeWasm(bandCtx.getImageData(0,0,width,bandHeight),harder,'strip');
        if(generation!==this._scanGeneration)return;
        if(!code){
          drawFull();
          code=await this._decodeWasm(ctx.getImageData(0,0,width,height),harder,'full');
        }
        code=String(code||'').replace(/\D/g,'');
      }else if(this._decoderMode==='zxing'&&this._zxingReader?.decodeFromCanvas){
        try{
          const result=this._zxingReader.decodeFromCanvas(c);
          const raw=typeof result?.getText==='function'?result.getText():result?.text;
          if(raw)code=String(raw).replace(/\D/g,'');
        }catch(e){
          const expected=
            (window.ZXing?.NotFoundException&&e instanceof window.ZXing.NotFoundException)||
            (window.ZXing?.ChecksumException&&e instanceof window.ZXing.ChecksumException)||
            (window.ZXing?.FormatException&&e instanceof window.ZXing.FormatException);
          if(!expected)console.debug('AH Shopping ZXing crop error',e);
        }
      }else if(this._decoderMode==='native'&&this._barcodeDetector){
        try{
          const found=await this._detectNative(c);
          const hit=(found||[]).find(x=>x?.rawValue);
          if(hit)code=String(hit.rawValue).replace(/\D/g,'');
        }catch(e){throw e;}
      }else if(this._decoderMode==='local'){
        try{code=decodeEANFromImageData(ctx.getImageData(0,0,c.width,c.height));}catch(e){}
      }

      if(code){
        this._decoderMisses=0;
      }else{
        this._decoderMisses++;

        // A narrow central band is especially effective for barcodes shown on
        // glossy phone screens and slightly skewed desktop webcam images.
        if(this._decoderMode==='zxing'&&this._zxingReader?.decodeFromCanvas&&this._scanBandCanvas){
          try{
            const band=this._scanBandCanvas;
            const bandCtx=band.getContext('2d',{willReadFrequently:true});
            const bandHeight=Math.max(80,Math.floor(c.height*.55));
            const bandY=Math.max(0,Math.floor((c.height-bandHeight)/2));
            band.width=c.width;
            band.height=bandHeight;
            bandCtx.drawImage(c,0,bandY,c.width,bandHeight,0,0,band.width,band.height);
            const bandResult=this._zxingReader.decodeFromCanvas(band);
            const raw=typeof bandResult?.getText==='function'?bandResult.getText():bandResult?.text;
            if(raw)code=String(raw).replace(/\D/g,'');
          }catch(e){}
        }

        // In Auto mode we sample alternate decoders after misses. Explicit
        // decoder selections stay on the selected engine so users can compare
        // reliability/performance on their own browser/camera.
        const autoDecoder=(this._config.scan_decoder||'auto')==='auto';
        if(autoDecoder&&!code&&this._decoderMode==='zxing'&&this._decoderMisses%4===0){
          try{code=decodeEANFromImageData(ctx.getImageData(0,0,c.width,c.height));}catch(e){}
        }
        const nativeEvery=this._isAndroid?12:4;
        if(autoDecoder&&!code&&this._decoderMode==='zxing'&&this._barcodeDetector&&this._decoderMisses>=4&&this._decoderMisses%nativeEvery===0){
          try{
            const found=await this._detectNative(c);
            const hit=(found||[]).find(x=>x?.rawValue);
            if(hit)code=String(hit.rawValue).replace(/\D/g,'');
          }catch(e){}
        }
        if(autoDecoder&&!code&&this._decoderMode==='native'&&this._decoderMisses%4===0){
          try{code=decodeEANFromImageData(ctx.getImageData(0,0,c.width,c.height));}catch(e){}
        }
        if(code)this._decoderMisses=0;
      }
    }catch(e){
      if(generation!==this._scanGeneration)return;
      console.warn('AH Shopping scan frame error',e);
      this._decoderMisses++;
      if(this._decoderMode==='wasm'||this._decoderMode==='native'){
        this._stopWasmWorker();
        this._barcodeDetector=null;
        this._decoderMode='local';
        this._setScanStatus(`Decoder-fout: ${e.message||e} · Local EAN actief`,true);
        try{
          const c=this._scanCanvas;
          c.width=Math.min(1600,video.videoWidth);c.height=Math.max(1,Math.floor(video.videoHeight*c.width/video.videoWidth));
          const fallbackCtx=c.getContext('2d',{willReadFrequently:true});
          fallbackCtx.drawImage(video,0,0,c.width,c.height);
          code=decodeEANFromImageData(fallbackCtx.getImageData(0,0,c.width,c.height));
        }catch(fallbackError){}
      }else{
        this._setScanStatus(`Scanner-fout: ${e.message||e}`,true);
      }
    }

    if(generation!==this._scanGeneration)return;
    try{
      if(code&&(/^\d{8}$/.test(code)||/^\d{12,14}$/.test(code))&&checksumOk(code)){
        this._barcodeDetected(code);
      }else{
        this._noteBarcodeAbsent();
      }
    }finally{
      this._scanBusy=false;
      this._scheduleScan();
    }
  }

  _noteBarcodeAbsent(){
    if(!this._heldBarcode||Date.now()<this._scanCooldownUntil)return;
    const now=Date.now();
    // The pause contains no decoded frames, so it must not count as the
    // barcode having left the camera. Start absence timing on the first miss.
    if(!this._barcodeAbsentSince)this._barcodeAbsentSince=now;
    if(now-this._barcodeAbsentSince>700){
      this._heldBarcode='';
      this._heldBarcodeLastSeen=0;
      this._barcodeAbsentSince=0;
    }
  }

  _barcodeDetected(code){
    const now=Date.now();
    this._barcodeAbsentSince=0;
    // A frame may already be decoding when an AH response starts cooldown.
    // Also avoid queueing a second addition while the first is in flight.
    if(now<this._scanCooldownUntil||this._scanProcessing)return;
    if(this._heldBarcode===code){
      this._heldBarcodeLastSeen=now;
      return;
    }
    this._heldBarcode=code;
    this._heldBarcodeLastSeen=now;
    this._scanQueue.push(code);
    this._processScanQueue();
  }

  _startScanCooldown(code){
    this._heldBarcode=code;
    this._heldBarcodeLastSeen=Date.now();
    this._barcodeAbsentSince=0;
    this._scanCooldownUntil=Date.now()+SCAN_COOLDOWN_MS;
    this._scheduleScan();
  }

  async _processScanQueue(){
    if(this._scanProcessing)return;
    this._scanProcessing=true;
    while(this._scanner&&this._scanQueue.length){
      const code=this._scanQueue.shift();
      const status=this._scanner.querySelector('#scanstatus');
      try{
        const r=await this._service('add_barcode',{barcode:code,quantity:1});
        const p={...(r.product||{})};
        p.barcode=code;
        p.quantity_on_list=Math.max(1,Number(p.quantity_on_list||1));
        this._promoteScannedProduct(p.id);
        this._scanProduct=p;
        this._pushRecentProduct(p);
        this._startScanCooldown(code);
        this._playScanBeep();
        if(navigator.vibrate)navigator.vibrate(70);
        this._renderScanResult();
        this._setScanStatus('');
        if(this._config.scanner_mode!=='permanent')this._armScannerTimer(10000);
      }catch(e){
        const message=String(e?.message||e||'');
        const notFound=/not found|niet gevonden|geen product|resource not found|404/i.test(message);
        this._setScanStatus(
          notFound
            ? `Barcode ${code} gelezen, maar product niet gevonden bij AH`
            : `AH-fout bij barcode ${code}: ${message||'onbekende fout'}`,
          true,
          notFound?5000:7000
        );
      }
    }
    this._scanProcessing=false;
  }

  _pushRecentProduct(product){
    const pid=Number(product?.id||0);
    const barcode=String(product?.barcode||'');
    const previousTop=this._scanRecent[0];
    if(previousTop&&!previousTop._feedLeaving)previousTop._feedExpiresAt=Date.now()+SCAN_FEED_DIMMED_MS;
    this._scanRecent=[
      {...product,_feedExpiresAt:Date.now()+SCAN_FEED_TOP_MS,_feedLeaving:0,_feedHeight:0},
      ...this._scanRecent.filter(item=>{
        const sameId=pid>0&&Number(item?.id||0)===pid;
        const sameBarcode=barcode&&String(item?.barcode||'')===barcode;
        return !sameId&&!sameBarcode;
      })
    ].slice(0,5);
    this._scheduleRecentExpiry();
  }

  _feedRowKey(product){return `scan:${product.id||product.barcode||product.title}`;}

  _scheduleRecentExpiry(){
    clearTimeout(this._scanRecentTimer);
    this._scanRecentTimer=null;
    if(!this._scanRecent.length)return;
    const deadlines=this._scanRecent.map(p=>p._feedLeaving?p._feedLeaving+REMOVAL_ANIMATION_MS:p._feedExpiresAt);
    this._scanRecentTimer=setTimeout(()=>this._expireRecentProducts(),Math.max(0,Math.min(...deadlines)-Date.now()));
  }

  _expireRecentProducts(){
    const now=Date.now();
    this._scanRecent=this._scanRecent.filter(p=>!p._feedLeaving||now<p._feedLeaving+REMOVAL_ANIMATION_MS);
    for(const p of this._scanRecent){
      if(!p._feedLeaving&&now>=p._feedExpiresAt){
        const row=[...this._scanner?.querySelectorAll?.('[data-row-key]')||[]].find(el=>el.dataset.rowKey===this._feedRowKey(p));
        if(row){p._feedHeight=row.getBoundingClientRect().height;row.style.height=`${p._feedHeight}px`;void row.offsetHeight;}
        p._feedLeaving=now;
      }
    }
    this._renderScanResult();
    this._scheduleRecentExpiry();
  }

  _renderScanResult(){
    const result=this._scanner?.querySelector('#scanRecent');
    if(!result)return;
    const template=document.createElement('template');
    template.innerHTML=this._scanRecent.map((p,index)=>this._scanOverlayRow(p,index)).join('');
    this._patchChildren(result,template.content);
    result.querySelectorAll('[data-scan-minus]').forEach(el=>
      el.onclick=()=>this._adjustScanQuantity(Number(el.dataset.pid),-1)
    );
    result.querySelectorAll('[data-scan-plus]').forEach(el=>
      el.onclick=()=>this._adjustScanQuantity(Number(el.dataset.pid),1)
    );
  }

  _scanOverlayRow(p,index){
    const qty=Math.max(0,Number(p.quantity_on_list??0));
    const opacity=Math.max(.2,1-index*.2);
    const old=p.is_bonus&&p.price_was>p.price_now?`<s>${this._money(p.price_was)}</s> `:'';
    const price=p.price_now?`<span class="price">${old}${this._money(p.price_now)}</span>`:'';
    const bonus=p.is_bonus?`<span class="bonus">BONUS · ${this._esc(p.bonus_mechanism||'Aanbieding')}</span>`:'';
    const unit=p.unit_size?`<span class="unitSize">${this._esc(p.unit_size)}</span>`:'';
    const meta=[unit,price,bonus].filter(Boolean).join('');
    const controls=Number(p.id||0)>0
      ? `<div class="qty compactQty">${qty>0?`<button data-scan-minus data-pid="${p.id}" aria-label="Verlaag aantal">−</button>`:''}<span>${qty}</span><button data-scan-plus data-pid="${p.id}" aria-label="Voeg toe">+</button></div>`
      : `<div class="qty readonlyQty"><span>${qty}×</span></div>`;
    return this._productRow(p,{controls,compact:true,rowClass:`scanOverlayItem${p._feedLeaving?' rowRemoving':''}`,style:`opacity:${opacity}${p._feedHeight?`;height:${p._feedHeight}px`:''}`,metaHtml:meta,rowKey:this._feedRowKey(p)});
  }

  _adjustScanQuantity(pid,delta){
    const p=this._scanRecent.find(item=>Number(item?.id||0)===Number(pid));
    if(!p)return;
    const pending=this._scanPendingQty.has(pid)?this._scanPendingQty.get(pid):Number(p.quantity_on_list??0);
    const next=Math.max(0,pending+delta);
    p.quantity_on_list=next;
    p._feedExpiresAt=Date.now()+(this._scanRecent[0]===p?SCAN_FEED_TOP_MS:SCAN_FEED_DIMMED_MS);p._feedLeaving=0;p._feedHeight=0;
    this._scheduleRecentExpiry();
    if(Number(this._scanProduct?.id||0)===Number(pid))this._scanProduct.quantity_on_list=next;
    this._scanPendingQty.set(Number(pid),next);
    this._renderScanResult();
    this._queueScanQuantity(Number(pid));
  }

  _queueScanQuantity(pid){
    if(this._scanQtyWorkers.has(pid))return;
    const worker=(async()=>{
      while(this._scanPendingQty.has(pid)){
        const target=this._scanPendingQty.get(pid);
        try{
          await this._service('set_quantity',{product_id:pid,quantity:target});
        }catch(e){
          this._scanPendingQty.delete(pid);
          this._setScanStatus(e.message||String(e),true);
          break;
        }
        if(this._scanPendingQty.get(pid)===target)this._scanPendingQty.delete(pid);
      }
    })().finally(()=>this._scanQtyWorkers.delete(pid));
    this._scanQtyWorkers.set(pid,worker);
  }

  _stopCamera(clear=true){
    this._scanGeneration++;
    this._scanCooldownUntil=0;
    this._barcodeAbsentSince=0;
    this._scanner?.classList?.remove('scanCooldown');
    this._cancelScheduledScan();
    this._stopWasmWorker();
    clearTimeout(this._scanLoop);
    this._scanLoop=null;
    this._scanBusy=false;
    this._decoderMisses=0;
    this._lastScanFrameTime=null;
    try{this._zxingReader?.reset?.();}catch(e){}
    this._zxingReader=null;
    if(this._stream){
      this._stream.getTracks().forEach(t=>t.stop());
      this._stream=null;
    }
    if(clear){
      this._scanCanvas=null;
      this._scanBandCanvas=null;
      this._barcodeDetector=null;
    }
  }

  _closeScanner(){
    if(this._config.scanner_mode==='permanent')return;
    this._clearScannerTimer();
    this._scanQueue=[];
    this._stopCamera();
    this._scanner=null;
    this._scanProduct=null;
    this._scanRecent=[];
    clearTimeout(this._scanRecentTimer);this._scanRecentTimer=null;
    this._scanProcessing=false;
    this._heldBarcode='';
    this._scanInlineActive=false;
    this._scannerRoute='';
    this._render();
  }

  _routeKey(){
    return `${window.location.pathname}${window.location.search}`;
  }

  _clearScanSession(){
    this._scanRecent=[];
    clearTimeout(this._scanRecentTimer);this._scanRecentTimer=null;
    this._scanProduct=null;
    this._scanQueue=[];
    this._scanProcessing=false;
    this._heldBarcode='';
    this._heldBarcodeLastSeen=0; this._barcodeAbsentSince=0;
    this._decoderMisses=0;
    this._renderScanResult();
  }

  _handleLocationChange(){
    const current=this._routeKey();
    if(this._config.scanner_mode==='button_auto'&&this._autoScannerRoute&&current!==this._autoScannerRoute){
      this._autoVisitArmed=true;
      if(this._scanInlineActive)this._closeScanner();
    }
    if(this._scannerRoute&&current!==this._scannerRoute){
      if(this._stream)this._stopCamera();
      this._clearScanSession();
      this._setScanStatus('');
    }
    this._syncScannerVisibility();
  }

  _shouldScannerRun(){
    if(!this._scanner||!this.isConnected)return false;
    if(!(this._config.scanner_mode==='permanent'||this._scanInlineActive))return false;
    if(document.visibilityState!=='visible')return false;
    if(this._visibilityObserver&&!this._intersecting)return false;
    if(this._scannerRoute&&this._routeKey()!==this._scannerRoute)return false;
    const rect=this.getBoundingClientRect();
    if(rect.width<2||rect.height<2)return false;
    const style=getComputedStyle(this);
    return style.display!=='none'&&style.visibility!=='hidden'&&style.opacity!=='0';
  }

  async _syncScannerVisibility(){
    // Re-arm on dashboard navigation/reconnection, not on polling or scrolling.
    if(this._config.scanner_mode==='button_auto'&&this.isConnected&&
      document.visibilityState==='visible'&&(!this._visibilityObserver||this._intersecting)){
      const rect=this.getBoundingClientRect();
      const style=getComputedStyle(this);
      if(rect.width>=2&&rect.height>=2&&style.display!=='none'&&style.visibility!=='hidden'&&style.opacity!=='0'){
        const route=this._routeKey();
        if(!this._autoScannerRoute)this._autoScannerRoute=route;
        if(this._autoScannerRoute===route&&this._autoVisitArmed){
          this._autoVisitArmed=false;
          this._scanInlineActive=true;
          this._scannerRoute=route;
          this._clearScannerTimer();
          this._clearScanSession();
          this._render();
        }
      }
    }
    if(!this._scanner){
      this._scanner=this.shadowRoot?.querySelector('#inlineScanner')||null;
    }

    // Permanent cards bind to the dashboard route only when they are genuinely visible.
    if(!this._scannerRoute&&this._scanner&&document.visibilityState==='visible'&&
      (!this._visibilityObserver||this._intersecting)){
      const rect=this.getBoundingClientRect();
      if(rect.width>=2&&rect.height>=2)this._scannerRoute=this._routeKey();
    }

    const shouldRun=this._shouldScannerRun();
    if(!shouldRun){
      if(this._stream)this._stopCamera();
      if(this._scanner)this._setScanStatus('');
      return;
    }
    if(this._config.scanner_mode!=='permanent'&&!this._scanDeadline)this._armScannerTimer(60000);
    if(this._stream||this._cameraStarting)return;
    this._cameraStarting=true;
    try{
      await this._startCamera();
    }finally{
      this._cameraStarting=false;
    }
  }

  connectedCallback(){
    if(!this._visibilitySetup){
      this._visibilitySetup=true;
      document.addEventListener('visibilitychange',this._visibilityHandler);
      this._audioGestureHandler ||= ()=>{if(this._scanner||this._audioContext)this._armScanAudio();};
      document.addEventListener('pointerup',this._audioGestureHandler,true);
      document.addEventListener('keydown',this._audioGestureHandler,true);
      window.addEventListener('location-changed',this._locationHandler);
      if('IntersectionObserver' in window){
        this._visibilityObserver=new IntersectionObserver(entries=>{
          const entry=entries[entries.length-1];
          this._intersecting=Boolean(entry?.isIntersecting&&entry.intersectionRatio>0);
          this._syncScannerVisibility();
          this._syncListRefresh();
        },{threshold:[0,.01,.1]});
        this._visibilityObserver.observe(this);
      }else{
        this._intersecting=true;
      }
    }
    if(this._config.scanner_mode==='permanent'&&!this._scanInlineActive){
      this._scanInlineActive=true;
      this._render();
    }
    this._scanner=this.shadowRoot?.querySelector('#inlineScanner')||null;
    requestAnimationFrame(()=>{this._syncScannerVisibility();this._syncListRefresh();});
  }

  _listVisible(){
    if(!this.isConnected||!this._hass||document.visibilityState!=='visible')return false;
    if(this._visibilityObserver&&!this._intersecting)return false;
    const rect=this.getBoundingClientRect();
    return rect.width>=2&&rect.height>=2;
  }

  _syncListRefresh(){
    const source=String(this._config.product_source||'shopping_list');
    if(source==='next_order'||!this._listVisible()){
      clearInterval(this._listRefreshTimer);this._listRefreshTimer=null;
      return;
    }
    this._requestListRefresh();
    if(!this._listRefreshTimer)this._listRefreshTimer=setInterval(()=>{
      if(this._listVisible())this._requestListRefresh();else this._syncListRefresh();
    },LIST_REFRESH_VISIBLE_MS);
  }

  _requestListRefresh(){
    // Shared by every card on the page: one integration, one AH account.
    const now=Date.now();
    if(now-this._listRefreshState.last<LIST_REFRESH_MIN_MS)return;
    this._listRefreshState.last=now;
    this._service('refresh').catch(error=>console.debug('AH Shopping: refresh skipped',error));
  }

  disconnectedCallback(){
    // Leaving the dashboard commits an outstanding removal rather than losing it.
    for(const removal of this._rowRemovals.values()){
      clearTimeout(removal.timer);
      removal.phase='committing';
      this._queueQuantityWrite(removal.source,removal.pid);
    }
    this._autoVisitArmed=true;
    this._clearScannerTimer();
    document.removeEventListener('visibilitychange',this._visibilityHandler);
    document.removeEventListener('pointerup',this._audioGestureHandler,true);
    document.removeEventListener('keydown',this._audioGestureHandler,true);
    window.removeEventListener('location-changed',this._locationHandler);
    this._visibilityObserver?.disconnect();
    this._visibilityObserver=null;
    this._visibilitySetup=false;
    clearInterval(this._listRefreshTimer);this._listRefreshTimer=null;
    this._photoInput?.remove();this._photoInput=null;
    this._intersecting=false;
    this._stopCamera();
    this._scanner=null;
    this._scannerRoute='';
    this._clearScanSession();
  }

  _css(){return `:host{display:block;height:100%;min-height:0;overflow:hidden}ha-card{height:100%;min-height:0;overflow:hidden;box-sizing:border-box}.fullCard{height:100%;min-height:0;display:flex;flex-direction:column}.fullCard .head,.fullCard .scanArea{flex:0 0 auto}.fullCard .items{overflow-anchor:none;flex:1 1 0;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-y;-webkit-overflow-scrolling:touch}.scanArea{padding:12px 14px}.head+.scanArea{padding-top:0}.scanWide{display:block;width:100%;margin:0;--ha-button-height:48px;font-size:16px}.scanWide::part(base){width:100%;justify-content:center}.head{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:minmax(24px,auto) 18px;column-gap:16px;row-gap:5px;align-items:center;padding:18px 18px 12px}.title{grid-column:1;grid-row:1;align-self:center;min-width:0;font-size:20px;font-weight:700;line-height:24px;margin:0}.total{grid-column:2;grid-row:1;align-self:center;text-align:right;font-size:21px;font-weight:700;line-height:24px;margin:0}.sub,small{display:block;color:var(--secondary-text-color);font-size:12px}.headerSub,.headerMeta{display:block;align-self:baseline;min-width:0;margin:0;font-size:12px;font-weight:400;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.headerSub{grid-column:1;grid-row:2}.headerMeta{grid-column:2;grid-row:2;text-align:right;color:var(--secondary-text-color)}button{border:0;border-radius:10px;padding:9px 12px;background:var(--secondary-background-color);color:var(--primary-text-color);font-size:14px}.primary{background:var(--primary-color);color:var(--text-primary-color,#fff);font-weight:600}.items{padding:0 10px 12px}.item{box-sizing:border-box;display:grid;grid-template-columns:54px 1fr auto;gap:10px;align-items:center;padding:10px 8px;border-top:1px solid var(--divider-color)}.item.rowUndo{opacity:.6}.item.rowRemoving{height:0!important;opacity:0!important;padding-top:0!important;padding-bottom:0!important;border-top-width:0;overflow:hidden;pointer-events:none;transition:height .32s ease,padding .32s ease,opacity .25s ease,border-top-width .32s ease;box-sizing:border-box}.qty button:disabled{opacity:.35}.item img,.ph{width:50px;height:50px;object-fit:contain;border-radius:8px}.compactItem{grid-template-columns:42px 1fr auto;gap:8px;padding:6px 8px}.compactItem img,.compactItem .ph{width:38px;height:38px}.compactItem .info b{font-size:13px}.compactMeta{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:2px}.compactMeta .price{font-size:12px;font-weight:650}.unitSize{font-size:11px;color:var(--secondary-text-color);white-space:nowrap}.combinedBreakdown{font-size:10px;color:var(--secondary-text-color);white-space:nowrap}.compactQty button{width:28px;height:28px;font-size:17px}.compactQty span,.readonlyQty span{font-size:12px;min-width:16px}.combinedQty span{font-size:13px;font-weight:700;min-width:22px}.ph{display:grid;place-items:center;background:var(--secondary-background-color)}.info{min-width:0}.info b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.price{font-weight:650;margin-top:3px}.price s{font-weight:400;color:var(--secondary-text-color);font-size:12px}.bonus{display:inline-block;margin-top:4px;padding:2px 5px;border-radius:5px;background:#00a03c;color:white;font-size:10px;font-weight:800}.qty{display:flex;align-items:center;gap:5px}.qty button{width:34px;height:34px;padding:0;font-size:20px}.qty span{min-width:20px;text-align:center;font-weight:700}.qty .trash{margin-left:3px;color:var(--error-color);font-size:17px}.empty{padding:22px;text-align:center;color:var(--secondary-text-color)}.toast{position:fixed;z-index:10001;left:50%;bottom:26px;transform:translateX(-50%);background:#2e7d32;color:white;padding:10px 16px;border-radius:20px;box-shadow:0 4px 16px #0005}.toast.error{background:var(--error-color,#c62828)}.inlineScanner{position:relative;flex:1 1 0;min-height:0;width:100%;overflow:hidden;background:#000}.inlineScanner video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;transform-origin:center center;will-change:transform}.scanGuide{position:absolute;z-index:2;left:5%;right:5%;top:40%;height:20%;border:2px solid #fff;border-radius:10px;box-shadow:0 0 0 9999px #0003;pointer-events:none}.scanGuide:after{content:'';position:absolute;left:7%;right:7%;top:50%;height:2px;background:#f33}.scanRecent{position:absolute;z-index:4;top:10px;left:10px;right:10px;display:flex;flex-direction:column;gap:5px;max-height:78%;overflow:hidden;pointer-events:none}.scanRecent.withClose{right:58px}.scanOverlayItem{pointer-events:auto;background:var(--card-background-color);border:0!important;border-radius:10px;box-shadow:0 2px 10px #0005;animation:scanRowIn .18s ease-out}.scanOverlayItem .compactMeta{min-height:14px}.scanOverlayItem .qty button{background:var(--secondary-background-color)}.scanClose{position:absolute;z-index:6;top:10px;right:10px;width:38px;height:38px;padding:0;border-radius:50%;background:#0009;color:#fff;font-size:24px;line-height:38px;backdrop-filter:blur(4px)}.scanHud{position:absolute;z-index:5;left:10px;right:10px;bottom:10px;display:flex;justify-content:flex-end;align-items:flex-end;gap:8px;pointer-events:none}.scanPill{display:inline-block;max-width:70%;padding:5px 8px;border-radius:999px;background:#0009;color:#fff;font-size:11px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;backdrop-filter:blur(4px)}.scanPill[hidden]{display:none!important}.scanStatus.error{margin-right:auto;max-width:min(72%,560px);padding:9px 12px;border-radius:10px;background:var(--error-color,#c62828);font-size:13px;font-weight:650;white-space:normal;line-height:1.3;box-shadow:0 3px 12px #0007}.scanTimer{max-width:none}.inlineScanner.scanCooldown .scanGuide:after{background:#00a03c}@keyframes scanRowIn{from{transform:translateY(-8px);opacity:0}to{transform:translateY(0)}}@media(prefers-reduced-motion:reduce){.item.rowRemoving{transition:none}}@media(max-width:520px){.item{grid-template-columns:46px 1fr}.scanOverlayItem{grid-template-columns:42px minmax(0,1fr) auto}.scanOverlayItem .qty{grid-column:auto;justify-content:flex-end}.scanOverlayItem img,.scanOverlayItem .ph{width:38px;height:38px}.item{grid-template-columns:46px 1fr}.item img,.ph{width:42px;height:42px}.qty{grid-column:2;justify-content:flex-end}.head{padding:14px}.scanArea{padding-left:14px;padding-right:14px}}`;}
}
if(!customElements.get('ah-shopping-card'))customElements.define('ah-shopping-card',AhShoppingCard);
window.customCards=window.customCards||[];
if(!window.customCards.some(c=>c.type==='ah-shopping-card'))window.customCards.push({type:'ah-shopping-card',name:'Albert Heijn Shopping',description:'Beheer je AH-boodschappenlijst en scan EAN-barcodes.'});
