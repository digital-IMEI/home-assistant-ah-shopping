const {chromium}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path');
const script=path.resolve(__dirname,'../custom_components/ah_shopping/frontend/ah-shopping-card.js');

async function header(browser,width){
 const page=await browser.newPage({viewport:{width,height:700}});
 await page.setContent('<style>body{margin:0}ah-shopping-card{display:block;height:400px}</style>');
 await page.addScriptTag({path:script});
 const result=await page.evaluate(()=>{
  const card=document.createElement('ah-shopping-card');
  card.setConfig({show_scan:false,product_source:'next_order',title:'Volgende bestelling'});
  document.body.append(card);
  card.hass={states:{order:{last_updated:'1',attributes:{ah_next_order:true,items:[{product_id:1,title:'Melk',quantity:1}],
   total_price:104.83,estimated_product_total:107.61,bonus_savings:22.36,unique_items:38,
   delivery_date_display:'zondag 8 november',delivery_time_display:'16:55 - 17:55'}}}};
  const head=card.shadowRoot.querySelector('.head');
  const box=el=>el.getBoundingClientRect();
  const title=head.querySelector('.title'),sub=head.querySelector('.headerSub'),meta=head.querySelector('.headerMeta'),total=head.querySelector('.total');
  return {
   titleOneLine:title.scrollWidth<=title.clientWidth&&box(title).height<30,
   deliveryComplete:sub.textContent.includes('16:55 - 17:55')&&sub.scrollWidth<=sub.clientWidth,
   savingsBelowDelivery:box(meta).top>=box(sub).bottom-1,
   savingsNextToDelivery:Math.abs(box(meta).top-box(sub).top)<2,
   totalNextToTitle:Math.abs(box(total).top-box(title).top)<6,
  };
 });
 await page.close();
 return result;
}

(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const phone=await header(browser,375);
  const desktop=await header(browser,800);
  const checks={
   phoneTitleOneLine:phone.titleOneLine,
   phoneDeliveryComplete:phone.deliveryComplete,
   phoneSavingsOwnLine:phone.savingsBelowDelivery,
   phoneTotalNextToTitle:phone.totalNextToTitle,
   desktopUnchanged:desktop.savingsNextToDelivery&&desktop.totalNextToTitle&&desktop.deliveryComplete,
  };
  for(const [key,value] of Object.entries(checks))assert.equal(value,true,key);
  console.log('PASS: phone header keeps the title on one line, shows the full delivery line and puts savings below; desktop header unchanged');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
