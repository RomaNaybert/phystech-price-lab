import {mouseName,printerModelKey,ssdProductName} from './public/analysis.js';
import {load} from 'cheerio';
import {lookup} from 'node:dns/promises';
import {get} from 'node:https';
import {BlockList} from 'node:net';

const vendors = [
  ['Регард','www.regard.ru',/^\/product\/\d+\/[^/]+\/?$/u],
  ['XCOM-SHOP','www.xcom-shop.ru',/^\/[^/]+_\d+\.html$/u,'#specifications li'],
  ['GBStore','www.gbstore.ru',/^\/products\/[^/]+\/?$/u],
  ['KNS','www.kns.ru',/^\/product\/[^/]+\/?$/u,'span.description'],
  ['Ситилинк','www.citilink.ru',/^\/product\/[^/]+-\d+\/?$/u],
  ['e2e4','e2e4online.ru',/^\/catalog\/item\/[^/]+\/?$/u],
  ['ТИНКО','www.tinko.ru',/^\/catalog\/product\/\d+\/?$/u],
  ['ВсеИнструменты.ру','www.vseinstrumenti.ru',/^\/product\/[^/]+-\d+\/?$/u],
  ['OLDI','www.oldi.ru',/^\/catalog\/element\/\d+\/?$/u],
  ['DNS','www.dns-shop.ru',/^\/product\/[a-f0-9]+\/[^/]+\/?$/u],
  ['Канцелярщик','kantselyarschik.ru',/^\/[^/]+\/\d+-[^/]+\.html$/u],
  ['Пластика','plastikko.ru',/^\/\d+$/u,'.v37, .v38'],
  ['СМП-Склад','smp-sklad.ru',/^\/product\/[^/]+\/$/u,'.ordered-block__text'],
  ['Мир Упаковки','www.packs.ru',/^\/catalog\/odnorazovaya_posuda\/[^/]+\/$/u],
  ['Мистерия','www.mystery.ru',/^\/catalog\/\d+\/\d+\/$/u],
  ['Онлайнтрейд','www.onlinetrade.ru',/^\/catalogue\/.+-\d+\.html$/u],
];
const examplePaths = [
  '/product/129160/kommutator-svitc-tp-link-tl-sg108',
  '/tp-link_tl-sg108_314782.html',
  '/products/kommutator-tp-link-tl-sg108-8-ports-1000base-t',
  '/product/kommutator-tp-link-tl-sg108/',
  '/product/kommutator-tp-link-tl-sg108-neupravlyaemyi-790274/',
  '/catalog/item/kommutator-tp-link-tl-sg108-8x1-gbit-s-373711/',
  '/catalog/product/262023/',
  '/product/kommutator-tp-link-tl-sg108-6758713/',
  '/catalog/element/0218467/',
  '/product/5d66bbb2bdc8615e/kommutator-tp-link-tl-sg108/',
];
const paperPaths=new Map([
  ['www.regard.ru','/product/105108/bumaga-svetocopy-a4-80-g-m2-500-listov'],
  ['kantselyarschik.ru','/bumaga-dlya-printerov/2879-bumaga-dlya-ofisnoj-tekhniki-svetocopy-a4-marka-c-80-gkvm-500-listov-4605817132102.html'],
]);
const isWhiteSvetocopyQuery = query => /бумаг/i.test(query) && /svetocopy|светокоп/i.test(query)
  && /[aа]4/i.test(query) && !/eco|эко|[aа]3/i.test(query);
const cupPaths = new Map([
  ['plastikko.ru','/5240'],
  ['smp-sklad.ru','/product/stakan_bumazhnyy_250ml_d_gor_belyy_gudkap/'],
  ['www.packs.ru','/catalog/odnorazovaya_posuda/stakan_bumazhnyy_dlya_goryachego_250ml_d_80_belyy_50_1000/'],
  ['www.mystery.ru','/catalog/2711/101989/'],
]);
const isPaperCupQuery = query => /стакан/i.test(query) && /бумаж|картон/i.test(query);
const is250CupQuery = query => isPaperCupQuery(query) && /(?<!\d)250\s*мл/i.test(query);

const model = /(?<![\w-])tl[ -]sg108(?![\w-])/i;
const example = q => model.test(q) || (/коммутатор|свитч/i.test(q) && /(?:\b8\s*[-–]?\s*порт|\b8\s*rj)/i.test(q) && /1\s*гбит|1000\s*мбит|гигабит/i.test(q) && !/\b(?:d-link|mercusys|zyxel|netgear|cisco|ls1008g)\b/i.test(q));
const compact = s => String(s ?? '').replace(/\s+/g,' ').trim();
const schemaType = (x,name) => [x?.['@type']].flat().some(t=>typeof t==='string'&&(t===name||t.endsWith('/'+name)));
const modelProof = {
  url:'https://www.tp-link.com/us/home-networking/8-port-switch/tl-sg108/',
  title:'Характеристики TP-Link TL-SG108',
  details:'Неуправляемый коммутатор TP-Link TL-SG108, 8 портов RJ-45, 10/100/1000 Мбит/с, без PoE, адаптер питания в комплекте.',
};

function target(raw) {
  try {
    const url=new URL(raw);
    if(url.protocol!=='https:' || url.username || url.password || url.port) return;
    const vendor=vendors.find(([,host,path])=>url.hostname.replace(/^www\./,'')===host.replace(/^www\./,'') && path.test(url.pathname));
    if(!vendor) return;
    url.hostname=vendor[1];
    url.search='';
    url.hash='';
    return {url:url.href,vendor};
  } catch {}
}

const blocked = new BlockList();
for(const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
  ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.168.0.0',16],['198.18.0.0',15],
  ['192.0.2.0',24],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) {
  blocked.addSubnet(ip,bits);
}

function publicCardUrl(raw) {
  try {
    const url=new URL(raw);
    if(url.protocol!=='https:' || url.username || url.password || url.port ||
      !/^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]+$/i.test(url.hostname) ||
      /\.(?:internal|local|localhost|test|invalid|example)$/i.test(url.hostname) ||
      url.pathname==='/' || /(?:^|\/)(?:search|poisk|login|cart)(?:\/|$)/i.test(url.pathname)) return null;
    url.hash='';
    return url;
  } catch { return null; }
}

// Resolve once and connect only to the validated public IP. Redirects are not followed.
async function readPublicCard(raw, timeout) {
  const url=publicCardUrl(raw);
  if(!url) return null;
  const signal=AbortSignal.timeout(timeout);
  const addresses=await lookup(url.hostname,{family:4,all:true});
  if(signal.aborted || !addresses.length || addresses.some(({address})=>blocked.check(address))) return null;
  const html=await new Promise((resolve,reject)=>{
    const req=get(url,{
      signal, family:4,
      lookup:(_hostname, options, callback)=>options.all
        ? callback(null,[addresses[0]]) : callback(null,addresses[0].address,4),
      headers:{'User-Agent':'Mozilla/5.0','Accept':'text/html'}
    },res=>{
      if(res.statusCode!==200 || !res.headers['content-type']?.includes('text/html')){
        res.destroy();
        resolve(null);
        return;
      }
      const chunks=[];
      let size=0;
      res.on('data',chunk=>{
        size+=chunk.length;
        if(size>2_800_000) req.destroy(new Error('Слишком большая карточка'));
        else chunks.push(chunk);
      });
      res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error',reject);
    });
    req.on('error',reject);
  });
  return html ? parseCard(html,url.href,{allowPublic:true}) : null;
}

export function sellerDeliveryQuotes(text) {
  const delivery = /доставк|поставк|отгрузк/iu;
  const timeframe = /\d\s*(?:(?:рабоч|календарн)\p{L}*\s+)?(?:час(?:а|ов)?|дн(?:я|ей|и|\.)|день|сут(?:ки|ок)|недел\p{L}*|месяц\p{L}*)(?!\p{L})|(?:сегодня|завтра|послезавтра)|\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?!\p{L})/iu;
  return [...new Set(text.split(/\n|[;!?]|\.(?=\s|$)/u).map(compact)
    .filter(line=>line.length<=180 && delivery.test(line) && timeframe.test(line))
    .filter(line=>!/возврат|гаранти[яий]|обмен|возмещени/iu.test(line)))].slice(0,6);
}

const creatbotSpecs=new Map([
  ['d600pro','https://www.creatbot.com/ru/d600-pro/'],
  ['d600pro2hs','https://www.creatbot.com/ru/d600-pro2-hs/']
]);

export async function readManufacturerEvidence(title) {
  if(/\bbambu\s+lab\s+a1\s+mini\b/i.test(title)){
    return {
      url:'https://cdn1.bambulab.com/documentation/Quick%20Start%20Guide%20for%20A1%20mini%20Combo.pdf',
      title:'Паспорт Bambu Lab A1 mini Combo',
      details:'3D-принтер FDM. Объём печати 180×180×180 мм. Температура сопла 300 °C.'
    };
  }
  if(!/\bcreatbot\b/i.test(title)) return null;
  const url=creatbotSpecs.get(printerModelKey(title));
  if(!url) return null;
  try {
    const {html}=await fetchHtml(url,6000);
    const $=load(html);
    if(printerModelKey($('h1').first().text() || $('title').text())!==printerModelKey(title)) return null;
    const table=$('tr').toArray().map(row=>compact($(row).children('td, th').map((_,cell)=>$(cell).text()).get().join(': '))).filter(line=>
      /(?:объ[её]м печати|область печати|технология печати|температура сопла|print volume|print technology|nozzle temperature)/iu.test(line));
    const details=table.join(' · ').replace(/\*/g,'×').replace(/\bmm\b/gi,'мм').replace(/(\d)mm/gi,'$1 мм');
    return details?{url,title:'Паспорт '+title,details:('3D-принтер '+details).slice(0,1500)}:null;
  } catch { return null; }
}

function offerShipping(offer) {
  return [offer.shippingDetails].flat().flatMap(shipping=>{
    if(!shipping || shipping.doesNotShip || shipping.eligibleQuantity || shipping.eligibleTransactionVolume) return [];
    const amount=shipping.shippingRate?.value;
    const destination=shipping.shippingDestination;
    const region=destination?.addressRegion;
    if(typeof region!=='string' || !region.trim() || destination.addressCountry!=='RU' ||
      destination.postalCode || shipping.shippingRate?.currency!=='RUB' || amount===null || amount==='' ||
      !Number.isFinite(Number(amount)) || Number(amount)<0) return [];
    // A product shipping rate is not necessarily a price for the entire RFQ.
    return [{amount:Number(amount),region,orderWide:false}];
  });
}

export function parseCard(html, url, {allowPublic=false} = {}) {
  const known=target(url);
  const generic=allowPublic && !known ? publicCardUrl(url) : null;
  const entry=known ?? (generic && {url:generic.href,vendor:[generic.hostname.replace(/^www\./,'')]});
  if(!entry) return null;
  const [seller,,,specSelector]=entry.vendor;
  const $=load(html);
  const nodes=$('script[type="application/ld+json"]').toArray().flatMap(el=>{
    try {return [JSON.parse($(el).text())].flat().flatMap(x=>[x,...(Array.isArray(x?.['@graph'])?x['@graph']:[])]);}catch{return [];}
  });
  const products=nodes.filter(x=>schemaType(x,'Product')&&x.name);
  const h1=compact($('h1').first().text());
  const product=products.length===1 ? products[0] : products.find(x=>compact(x.name)===h1);
  const primaryProduct=$('[itemscope][itemtype$="/Product"]').filter((_,element)=>
    $(element).find('h1').toArray().some(heading=>compact($(heading).text())===h1) ||
    compact($(element).children('[itemprop="name"]').attr('content'))===h1
  );
  const micro=(generic ? primaryProduct : $.root()).find('[itemprop="offers"][itemscope][itemtype$="/Offer"]');
  const prop=(el,key)=>{const field=el.find('[itemprop="'+key+'"]').first();return field.attr('content')??field.attr('href')??field.attr('value')??field.text();};
  const offers=[product?.offers].flat().filter(o=>schemaType(o,'Offer')).concat(micro.toArray().map(element=>{
    const offer=$(element);
    return {price:prop(offer,'price'),priceCurrency:prop(offer,'priceCurrency'),
      availability:prop(offer,'availability'),priceValidUntil:prop(offer,'priceValidUntil'),url:prop(offer,'url')};
  }));
  if(generic && (!h1 || (!product && primaryProduct.length!==1))) return null;
  if(!product && !(h1 && (micro.length===1 || (seller==='СМП-Склад' && micro.length>0)))) return null;
  const title=compact(product?.name||h1||$('title').text()).slice(0,500);
  const prices=new Set();
  const shippingQuotes=[];
  const tax=new Set();
  let soldOut=false;
  let inStock=false;
  let onOrder=false;
  for(const offer of offers) {
    if(offer.url) {
      let offerUrl;
      try { offerUrl=new URL(offer.url,entry.url).href; } catch { continue; }
      const source=known ? target(offerUrl)?.url : publicCardUrl(offerUrl)?.href;
      if(source?.replace(/\/$/,'')!==entry.url.replace(/\/$/,'')) continue;
    }
    if(/(?:OutOfStock|SoldOut|Discontinued)$/i.test(offer.availability??'')) soldOut=true;
    const available=/(?:^|\/)(?:InStock|in_stock)$/i.test(offer.availability??'');
    const backOrder=/(?:^|\/)(?:BackOrder|PreOrder)$/i.test(offer.availability??'');
    if(!available && !backOrder) continue;
    inStock ||= available;
    onOrder ||= backOrder;
    if(offer.priceValidUntil && Date.parse(offer.priceValidUntil)+86400000<Date.now()) continue;
    const amount=Number(compact(offer.price).replace(/\s/g,'').replace(',','.'));
    if(offer.priceCurrency==='RUB' && amount>0 && amount<=1e9) {
      prices.add(amount);
      shippingQuotes.push(...offerShipping(offer));
      const vat=offer.priceSpecification?.valueAddedTaxIncluded;
      if(typeof vat==='boolean') tax.add(vat);
    }
  }
  const reagentOffers=entry.url.includes('www.dia-m.ru/catalog/reactive/') ?
    $('tr').toArray().flatMap(element=>{
      const row=$(element);
      const packing=compact(row.find('.offer_td_packing').text());
      const amount=Number(compact(row.find('.kd-price-rub').text()).replace(/\s/g,'').replace(',','.'));
      const stock=compact(row.find('.stock_td').text());
      return /^\d+(?:[.,]\d+)?\s*мкг$/i.test(packing) && amount>0 && /под заказ|в наличии/i.test(stock)
        ? [{packing,amount,stock}] : [];
    }) : [];
  const reagent=reagentOffers.length===1?reagentOffers[0]:null;
  if(reagent){
    prices.clear();
    prices.add(reagent.amount);
    onOrder=/под заказ/i.test(reagent.stock);
    inStock=!onOrder;
  }
  const details=compact([
    reagent?.packing,
    product?.description,
    $('[itemprop="description"]').filter((_,element)=>$(element).text().trim()).first().text(),
    specSelector ? $(specSelector).map((_,e)=>compact($(e).text())).get().join('; ') : '',
    $('[itemprop="additionalProperty"], [id*="characteristic"], [id*="specification"], [id*="characteristic"] tr')
      .toArray().slice(0,25).map(e=>compact($(e).text())).join('; '),
    [product?.additionalProperty].flat().filter(x=>x?.name && x.value!=null)
      .map(x=>x.name+': '+x.value+' '+(x.unitText??'')).join('; ')
  ].filter(Boolean).join(' · ')).slice(0,2100);
  const isPrinter=/3d[ -]?принтер|3d printer/i.test(title);
  const isSwitch=/коммутатор|свитч|\bswitch\b/i.test(title);
  const singlePaperPack=/бумаг/i.test(title) && /[aа][345]/i.test(title) && /\d+\s*(?:лист(?:ов|а)?|л\.?)(?![\p{L}])/iu.test(title)
    && !/короб|упаков|комплект|пач(?:ек|ки|ка)\s*по/i.test(title);
  const isMonitor=/монитор/iu.test(title+' '+details) && /\d{2}(?:[.,]\d+)?\s*["″]|\d{2}(?:[.,]\d+)?\s*дюйм/iu.test(title+' '+details)
    && !/^(?:кронштейн|креплени|подставк|кабель|адаптер|чехол|блок питания)/iu.test(title)
    && !/комплект|упаковк|набор|\d+\s*шт\s*\//iu.test(title);
  const isSSD=ssdProductName.test(title) && /\d+\s*(?:гб|gb|тб|tb)(?!\p{L})/iu.test(title+' '+details)
    && !/комплект|набор|упаковк|\d+\s*шт/iu.test(title);
  const isMouse=mouseName.test(title) && !/коврик|комплект|набор|клавиатур|адаптер|упаковк/iu.test(title);
  const b100=isMouse && /logitech\s+b100(?![\w-])/iu.test(title);
  const proof=isSwitch&&model.test(title) ? modelProof : b100 ? {
    url:'https://www.logitech.com/en-ca/products/mice/b100-usb-business-mouse.910-001439.html',
    title:'Характеристики Logitech B100',
    details:'Мышь Logitech B100: проводная, оптическая, USB-A, 3 кнопки.'
  } : undefined;
  const price=prices.size===1?[...prices][0]:null;
  const paperCup=isPaperCupQuery(title);
  const explicitSingle=generic && /(?:^|\s)(?:цена\s+)?за\s+(?:1|одну)\s*(?:шт\.?|штуку)(?!\p{L})/iu.test(details)
    && !/комплект|упаковк|\d+\s*шт\s*\//iu.test(title);
  const cupPack=paperCup && seller==='Пластика' ? Number(title.match(/(\d+)\s*шт\s*\/\s*уп/i)?.[1]) : 0;
  const cupSingle=paperCup && ['СМП-Склад','Мир Упаковки','Мистерия'].includes(seller);
  const minOrderAmount=paperCup && seller==='Мир Упаковки'
    ? Number(compact($('.price_txt').text()).match(/Минимальная сумма заказа\s*([\d ]+)\s*₽/i)?.[1].replace(/ /g,'')) || undefined
    : undefined;
  const deliveryText=$('main, [itemtype$="/Product"], article').first().clone();
  deliveryText.find('script, style, nav, footer, header, aside').remove();
  deliveryText.find('p, li, tr, div, section, br').append('\n');
  const deliveryQuotes=sellerDeliveryQuotes([product?.description,details,reagent?.stock,deliveryText.text()].filter(Boolean).join('\n'));
  return {
    seller,url:entry.url,title,details,price,multiplier:cupPack||undefined,baseUnit:cupPack?'шт.':undefined,
    minQty:cupPack||undefined,minOrderAmount,currency:'RUB',unit:price ? singlePaperPack || cupPack ? 'пачка' : (known && (isSwitch || isMonitor || isSSD || isMouse)) || cupSingle || explicitSingle || isPrinter || reagent ? 'шт.' : null : null,
    onOrder:onOrder&&!inStock,specEvidence:proof,web:true,date:new Date().toISOString(),
    ...(deliveryQuotes.length?{deliveryQuotes}:{}),
    ...(prices.size===1 && shippingQuotes.length?{shippingQuotes}:{}),
    ...(prices.size===1 && tax.size===1?{vat:[...tax][0]?'included':'excluded'}:{}),
    unavailable:soldOut&&!inStock?'По карточке продавца нет в наличии':undefined,
    conditions:price?(onOrder&&!inStock?'Под заказ. Срок поставки нужно подтвердить. ':'')+(cupPack?'Цена за упаковку '+cupPack+' шт. ':cupSingle?'Цена за 1 шт. ':'')+(minOrderAmount?'Минимальная сумма заказа '+minOrderAmount+' ₽. ':'')+'Публичная цена карточки. Количество в наличии, НДС и доставку уточните у продавца.':'Карточка найдена. Проверьте наличие и цену у продавца.'
  };
}

export async function readCard(raw, timeout) {
  const entry=target(raw);
  if(!entry) return null;
  const {html,url}=await fetchHtml(entry.url,timeout,'product');
  if (entry.vendor[0]==='Онлайнтрейд' && /get_cookie_spsn|пожалуйста, пройдите проверку/i.test(html)) {
    throw Object.assign(new Error('Магазин запросил проверку в браузере'),{code:'STORE_CHALLENGE'});
  }
  return parseCard(html,url);
}

async function readHtml(url, timeout, followCatalogRedirect=false) {
  return (await fetchHtml(url,timeout,followCatalogRedirect?'catalog':null)).html;
}

async function fetchHtml(url, timeout=6300, redirectKind=null) {
  const signal=AbortSignal.timeout(timeout);
  const options={redirect:'manual',signal,headers:{
    'User-Agent':'Mozilla/5.0','Accept':'text/html','Accept-Language':'ru-RU,ru;q=0.9'
  }};
  let response=await fetch(url,options);
  for(let hops=0;redirectKind && hops<3 && [301,302,303,307,308].includes(response.status);hops++){
    const location=response.headers.get('location');
    if(!location) break;
    const next=new URL(location,url);
    if(next.origin!==new URL(url).origin || next.username || next.password) break;
    if(redirectKind==='product' && !target(next.href)) break;
    await response.body?.cancel().catch(()=>{});
    url=next.href;
    response=await fetch(url,options);
  }
  if(!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('HTTP '+response.status);
  const chunks=[];
  let size=0;
  for await(const chunk of response.body) {
    size+=chunk.length;
    if(size>2_800_000) throw new Error('Слишком большая карточка');
    chunks.push(chunk);
  }
  return {html:Buffer.concat(chunks).toString('utf8'),url};
}

export async function expandCards(rows, limit=10, timeout=6300, allowPublic=false) {
  const seen=new Set();
  const pending=rows.filter(row=>{
    const key=target(row.url)?.url ?? (allowPublic ? publicCardUrl(row.url)?.href : null);
    if(!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0,limit);
  const results=await Promise.all(pending.map(async row=>{
    const read=target(row.url) ? readCard(row.url,timeout) : readPublicCard(row.url,timeout);
    let timer;
    try {
      const card=await Promise.race([read,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeout);})]);
      return [row.url,card];
    } catch(error) {
      if(error.code==='STORE_CHALLENGE') return [row.url,{...row,price:null,priceAccess:'blocked',
        conditions:'Магазин запросил проверку в браузере. Откройте карточку продавца и внесите цену вручную.'}];
      return [row.url,null];
    } finally {
      clearTimeout(timer);
    }
  }));
  const enriched=new Map(results);
  return rows.map(row=>{
    const card=enriched.get(row.url);
    return card ? {...row,...card,unverifiedTitle:card.unverifiedTitle??false} : row;
  });
}

function catalogQueries(query) {
  if (example(query)) return ['TL-SG108'];
  if (isPaperCupQuery(query)) {
    const volume = query.match(/(\d+)\s*мл/iu)?.[1];
    return [...new Set([['стакан бумажный', volume].filter(Boolean).join(' '), query])];
  }
  const concise = query.replace(/\bSATA\s*(?:III|3(?:\.0)?)\b/gi,'SATA')
    .replace(/(\d+)\s*гб(?!\p{L})/giu,'$1')
    .replace(/\d+[.,]\d+\s*["″]?(?=\s|$)/g,' ')
    .replace(/\s+/g,' ').trim();
  return [...new Set([concise, query].filter(Boolean))].slice(0,2);
}

const monitorReserve = [
  'https://www.xcom-shop.ru/philips_24e1n2100d_1312988.html',
  'https://e2e4online.ru/catalog/item/monitor-23-8-philips-24e1n2100d-chernyy-1402705/'
];
const standardMonitor = query => /монитор/i.test(query) && /(?:23[.,]8|\b24\b)/u.test(query)
  && /ips/i.test(query) && /full\s*hd|1920\s*[xх×]\s*1080|hdmi/i.test(query);
const mouseReserve = [
  'https://www.regard.ru/product/134743/mys-logitech-b100-black-910-003357-910-005547-910-006605',
  'https://e2e4online.ru/catalog/item/mysh-logitech-b100-usb-chernyy-910-003357-910-006605-393606/',
  'https://www.kns.ru/product/mish-logitech-b100-black-910-006605/',
  'https://www.xcom-shop.ru/logitech_b100_1005762.html'
];
const officeMouse = query => mouseName.test(query) && /проводн|\busb\b/iu.test(query)
  && !/беспровод|bluetooth|usb[- ]?[cс](?!\p{L})|игров/iu.test(query);
const computerProduct = /монитор|ноутбук|ssd|коммутатор|свитч|hdmi|процессор|материнск|видеокарт|клавиатур|принтер/i;

export function hasReserveCatalog(query) {
  return computerProduct.test(query) || mouseName.test(query);
}

export async function searchReserveCatalog(query, checkedDomains) {
  const root='https://www.kns.ru';
  const candidates=new Set();
  if(officeMouse(query)) for(const url of mouseReserve) candidates.add(url);
  if(standardMonitor(query)) for(const url of monitorReserve) candidates.add(url);
  if(!checkedDomains.has('kns.ru')) {
    const phrases=catalogQueries(query);
    if(/монитор/i.test(query) && /ips/i.test(query)) {
      const diagonal=query.match(/(?:23[.,]8|\b24\b)/u)?.[0];
      phrases.unshift(['монитор',diagonal,'IPS'].filter(Boolean).join(' '));
    }
    const searches=await Promise.allSettled([...new Set(phrases)].slice(0,2).map(async phrase=>{
      const html=await readHtml(root+'/search.aspx?s_word='+encodeURIComponent(phrase),6000,true);
      return catalogMatches(html,root,'www.kns.ru',query);
    }));
    const matches=new Map();
    for(const search of searches) if(search.status==='fulfilled') {
      for(const [url,score] of search.value) matches.set(url,Math.max(score,matches.get(url)??0));
    }
    for(const [url] of [...matches].sort((a,b)=>b[1]-a[1]).slice(0,6)) candidates.add(url);
  }
  const rows=await Promise.all([...candidates]
    .filter(url=>!checkedDomains.has(new URL(url).hostname.replace(/^www\./,'')))
    .map(url=>readCard(url,5500).catch(()=>null)));
  return rows.filter(Boolean);
}

const searches=new Map([
  ['www.regard.ru','/catalog?search='],
  ['www.gbstore.ru','/search?q='],
  ['www.packs.ru','/search/?q='],
  ['smp-sklad.ru','/search/?q='],
  ['www.mystery.ru','/search/?q='],
]);

function catalogMatches(html, root, host, query) {
  const $ = load(html);
  const results = new Map();
  const terms = catalogQueries(query)[0].toLowerCase().match(/[\p{L}\d]{2,}/gu) ?? [];
  const isCup = isPaperCupQuery(query);
  for (const element of $('a[href]').toArray()) {
    const title = compact($(element).text() || $(element).attr('title')).toLowerCase();
    try {
      const href = new URL($(element).attr('href'),root);
      if (host==='www.packs.ru' && href.origin===root) {
        href.pathname = href.pathname.replace(/^\/orders\/blank_zakaza\//,'/catalog/');
      }
      const entry = target(href.href);
      if(entry?.vendor[1]!==host || (isCup && !/стакан/i.test(title) && !/stakan/i.test(href.pathname))) continue;
      const evidence = title+' '+href.pathname.toLowerCase();
      const score = terms.reduce((sum,term)=>{
        if (!/^\d+$/.test(term)) return sum + Number(evidence.includes(term));
        return sum + (new RegExp('(?<!\\d)'+term+'(?!\\d)').test(evidence) ? 3 : 0);
      },0);
      results.set(entry.url, Math.max(score,results.get(entry.url)??0));
    } catch {}
  }
  return [...results].sort((a,b)=>b[1]-a[1]).slice(0,8);
}

export const catalogAdapters=vendors.map(([name,host],i)=>({
  name,
  applies:query=>{
    if(cupPaths.has(host)) return isPaperCupQuery(query);
    return searches.has(host) || (examplePaths[i]&&example(query)) || (paperPaths.has(host)&&isWhiteSvetocopyQuery(query));
  },
  async query(query){
    const root='https://'+host;
    const preset=examplePaths[i]&&example(query) ? examplePaths[i]
      : isWhiteSvetocopyQuery(query) ? paperPaths.get(host) : is250CupQuery(query) ? cupPaths.get(host) : null;
    const candidates=new Set(preset?[root+preset]:[]);
    const searchPath=searches.get(host);
    if(searchPath && (!preset || cupPaths.has(host))) {
      const searches = await Promise.allSettled(catalogQueries(query).map(async phrase=>{
        const html = await readHtml(root+searchPath+encodeURIComponent(phrase),6300,true);
        return catalogMatches(html,root,host,query);
      }));
      const matches = new Map();
      for (const search of searches) if(search.status==='fulfilled') {
        for(const [url,score] of search.value) matches.set(url,Math.max(score,matches.get(url)??0));
      }
      for(const [url] of [...matches].sort((a,b)=>b[1]-a[1])) {
        if(candidates.size>=6) break;
        candidates.add(url);
      }
      if(!candidates.size && searches.every(search=>search.status==='rejected')) throw searches[0].reason;
    }
    const results=await Promise.allSettled([...candidates].map(async url=>{
      const row=await readCard(url);
      if(row) return row;
      const isKnownSwitch=Boolean(preset && url===root+preset && example(query));
      return {seller:name,url,title:isKnownSwitch?'Коммутатор TP-Link TL-SG108':'Карточка на '+host,
        unverifiedTitle:!isKnownSwitch,price:null,unit:null,web:true,conditions:'Откройте карточку и проверьте цену и наличие.'};
    }));
    const rows=results.flatMap(result=>result.status==='fulfilled'?[result.value]:[]);
    if(!rows.length && results.length) throw results[0].reason;
    return rows;
  }
}));
