// Replays a delivery day through the next-order card, with synthetic sensor attributes
// in the shape the integration publishes (see tests/test_next_order_timeline.py).
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:800,height:700}});
  await page.setContent('<style>body{margin:0}ah-shopping-card{display:block;height:500px}</style>');
  await page.addScriptTag({path:path.resolve(__dirname,'../custom_components/ah_shopping/frontend/ah-shopping-card.js')});
  const seen=await page.evaluate(()=>{
   const base={ah_next_order:true,order_id:5001,delivery_date_display:'zondag 8 november',delivery_time_display:'16:00 - 18:00',
    unique_items:38,bonus_savings:22.36,bonus_savings_estimated:false,price_source:'ah',estimated_product_total:null,
    items:[{product_id:11,title:'Halfvolle melk',quantity:2,price_now:1.29}]};
   const phases=[
    {order_state:'CONFIRMED',is_after_cut_off:false,total_price:98.10,expected_time_display:''},
    {order_state:'PLANNED_FOR_DELIVERY',is_after_cut_off:true,tracking_type:'PLANNED',total_price:104.83,expected_time_display:'16:55 - 17:55',tracking_message:'Onze bezorger verwacht vandaag tussen 16:55 en 17:55 uur bij je te zijn.'},
    {order_state:'OUT_FOR_DELIVERY',is_after_cut_off:true,tracking_type:'UNDERWAY',total_price:120.58,expected_time_display:'16:55 - 17:55',tracking_message:'Er zijn nog 5 klanten voor je.',customers_ahead:5},
    {order_state:'OUT_FOR_DELIVERY',is_after_cut_off:true,tracking_type:'UNDERWAY',total_price:120.58,expected_time_display:'16:40 - 17:10',tracking_message:'Er is nog 1 klant voor je.',customers_ahead:1},
    {order_state:'OUT_FOR_DELIVERY',is_after_cut_off:true,tracking_type:'UNDERWAY',total_price:120.58,expected_time_display:'16:40 - 17:10',tracking_message:'Je bent de eerstvolgende.',customers_ahead:0},
   ];
   const card=document.createElement('ah-shopping-card');card.setConfig({show_scan:false,product_source:'next_order',title:'Volgende bestelling'});document.body.append(card);
   const read=()=>{const s=card.shadowRoot;return [s.querySelector('.headerSub')?.textContent,s.querySelector('.total')?.textContent.replace(/\s/g,' '),
     s.querySelector('.orderProgress')?.getAttribute('aria-valuetext'),s.querySelector('.orderNote')?.textContent||''].join(' | ');};
   const out=phases.map((p,i)=>{card.hass={states:{order:{last_updated:String(i),attributes:{...base,...p}}}};return read();});
   card.hass={states:{order:{last_updated:'9',attributes:{ah_next_order:true,order_id:0,items:[]}}}};
   out.push(card.shadowRoot.querySelector('.orderProgress')?'bar still shown':'delivered: no bar');
   return out;
  });
  assert.deepEqual(seen,[
   'zondag 8 november · 16:00 - 18:00 | € 98,10 | Besteld | ',
   'zondag 8 november · 16:55 - 17:55 | € 104,83 | Inpakken | ',
   'zondag 8 november · 16:55 - 17:55 | € 120,58 | Onderweg | Nog 5 klanten voor je',
   'zondag 8 november · 16:40 - 17:10 | € 120,58 | Onderweg | Nog 1 klant voor je',
   'zondag 8 november · 16:40 - 17:10 | € 120,58 | Onderweg | Je bent de eerstvolgende',
   'delivered: no bar',
  ]);
  console.log('PASS: delivery-day replay: expected window, AH total, Besteld > Inpakken > Onderweg with customers ahead, gone after delivery');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
