import { deepQueriesForGap, enrichDeepOffers } from './deep-review.mjs';
import {evaluate} from './public/analysis.js';
import { agentConfigured, agentRoundWaitMs, agentRoundDeadlineMs, maxSearchRounds, searchAgentRound, searchExaRound, searchVariants, searchWeb, sellerDomain, reviewOffers, verifierConfigured, verifyDisputedOffers } from './web-search.mjs';
import {catalogAdapters,expandCards,hasReserveCatalog,searchReserveCatalog} from './product-cards.mjs';
import { load } from 'cheerio';

const cap = 12;
const headers = {'User-Agent':'Mozilla/5.0 (compatible; PhystechPriceLab/1.0)', 'Accept-Language':'ru-RU,ru;q=0.9'};
const compact = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const rub = s => Number(compact(s).replace(/\s/g,'').replace(',','.').match(/\d+(?:\.\d+)?/)?.[0]) || null;
const link = (value, root) => {
  if (!value) return null;
  try { const u = new URL(value,root); return u.protocol==='https:' ? u.href.split('#')[0] : null; } catch { return null; }
};

async function page(url, options) {
  const response = await fetch(url,{...options,headers,signal:AbortSignal.timeout(7500)});
  if (!response.ok) throw new Error('HTTP '+response.status);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 3_500_000) throw new Error('Ответ слишком большой');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
const asHtml = async (url, options) => load(await page(url,options));
const make = (seller,url,title,price,extra={}) => ({seller,url,title:compact(title).slice(0,500),price,currency:'RUB',unit:'шт.',date:new Date().toISOString(),...extra});

const specialistCards = [
  {name:'3DSYSTEM',url:'https://3dsystem.ru/catalog/3d_printery/3d_printery_fdm/3d_printery_creatbot/3d_printer_creatbot_d600_pro/'},
  {name:'3D-FORMAT',url:'https://3d-format.ru/product/catalog/3dprinters/creatbot-d600-pro/',
    revision:'https://3d-format.ru/product/catalog/3dprinters/3d-printer-creatbot-d600-pro-2/'},
  {name:'LIDER-3D',url:'https://lider-3d.ru/catalog/3d_printery/3d_printer_creatbot_d600_pro/',
    revision:'https://lider-3d.ru/catalog/3d_printery/3d_printer_creatbot_d600_pro_2_hs/'}
].map(source=>({
  name:source.name,
  applies:query=>/3\s*d[ -]?(?:принтер|printer)|creatbot/i.test(query),
  async query(query){
    const exact=/creatbot\s*d600\s*pro/i.test(query);
    const preset=exact?[{url:source.url,title:'3D-принтер CreatBot D600 Pro'}]:[];
    if(source.revision && /d600|600\s*[xх×]\s*600/i.test(query))
      preset.push({url:source.revision,title:'3D-принтер CreatBot D600 Pro 2 HS'});
    const indexed=await searchIndex({...source,paths:/\/(?:3d[_-]?printer|3dprinters|3d[_-]?принтер|3d_printery)[^/]*\/.+\/?$/iu},query,source.url).catch(()=>[]);
    const candidates=new Map([...preset,...indexed].map(row=>[row.url,row]));
    return expandCards([...candidates.values()].slice(0,6).map(row=>make(source.name,row.url,row.title,null,{
      unit:null,web:true
    })),6,6500,true);
  }
}));
const cytokineSources = [
  {name:'Диаэм',home:'https://www.dia-m.ru/catalog/reactive/rostovye-faktory-i-tsitokiny/'},
  {name:'Хеликон',home:'https://shop.helicon.ru/catalog/reagents/reagents-and-kits/cell-culturing/growth-factors-and-cytokines/'}
].map(source=>({
  name:source.name,
  applies:query=>/tgf|rhil|интерлейкин|\bil-?(?:2|7|15|21)\b/i.test(query),
  async query(query){
    const protein=query.match(/(?:rh)?il[ -]?(2|7|15|21)\b|интерлейкин[ -]?(2|7|15|21)\b/i);
    const slug=protein ? new RegExp('rhil-'+(protein[1]??protein[2])+'(?!\\d)','i') : /tgf|transformiruyush/i;
    const $=await asHtml(source.home);
    const urls=new Set();
    for(const element of $('a[href]').toArray()){
      const url=link($(element).attr('href'),source.home);
      if(url?.startsWith(source.home) && slug.test(new URL(url).pathname)) urls.add(url);
      if(urls.size>=6) break;
    }
    if(source.name==='Диаэм' && (protein?.[1]??protein?.[2])==='15'){
      urls.add(source.home+'interleykin-15-cheloveka-rekombinantnyy-belok-rhil-15/');
    }
    return expandCards([...urls].map(url=>make(source.name,url,'Карточка '+source.name,null,{
      unit:null,web:true,unverifiedTitle:true
    })),6,6500,true);
  }
}));

const adapters = [
  ...specialistCards,...cytokineSources,
  {name:'ИИ-поиск в интернете',query:searchWeb},
  {name:'Сима-ленд', async query(q){
    const root='https://www.sima-land.ru';
    const result=JSON.parse(await page(root+'/api/v3/item/?q='+encodeURIComponent(q)+'&per-page=12'));
    if (!Array.isArray(result.items)) throw new Error('Структура ответа изменилась');
    return result.items.map(x=>make('Сима-ленд',link('/'+x.sid+'/'+x.slug+'/',root),x.name,Number(x.price)||null,{
      currency:x.currency, minQty:x.minimum_order_quantity, details:compact(x.page_description).slice(0,600),
      unavailable:x.is_disabled ? 'Товар недоступен' : undefined, conditions:'Розничная цена каталога'
    }));
  }},
  {name:'МЕТРО', async query(q){
    const root='https://online.metro-cc.ru';
    const $=await asHtml(root+'/search?q='+encodeURIComponent(q));
    if (!$('.page-search__main').length) throw new Error('Каталог не вернул выдачу');
    const offers = $('.product-card__content').toArray().slice(0,cap).map(el=>{
      const card=$(el), a=card.find('a[href^="/products/"]').filter((_,e)=>$(e).text().trim()).first();
      const online=card.find('.product-unit-prices__actual-wrapper').first();
      const value=online.find('.product-price__sum-rubles').first().text();
      const kopecks=online.find('.product-price__sum-pennies, .product-price__sum-kopecks').first().text().match(/\d{1,2}/)?.[0];
      const price = rub(value);
      const unit = /\/кг/i.test(online.text()) ? 'кг' : 'шт.';
      return make('МЕТРО',link(a.attr('href'),root),a.text(),price && (price+(kopecks?Number(kopecks)/100:0)),{unit,conditions:'Онлайн-цена, регион каталога по умолчанию'});
    });
    await Promise.all(offers.slice(0,5).filter(x=>x.url).map(async row=>{
      try { const detail=await asHtml(row.url);
        row.details=compact(detail('[class*="characteristic"],[class*="attributes"],[class*="product-attribute"]').toArray().map(e=>detail(e).text()).join(' ')).slice(0,1250);
        if (/svetocopy/i.test(row.title) && /Количество листов\s*500/i.test(detail('body').text())) row.details += ' 500 листов';
      } catch { row.conditions += ' · характеристики карточки недоступны'; }
    }));
    return offers;
  }},
  {name:'Дава', async query(q){
    const root='https://nov.dava.ru', $=await asHtml(root+'/search/?q='+encodeURIComponent(q));
    if (!$('title').text().includes('Поиск')) throw new Error('Каталог не вернул выдачу');
    return $('.product_card').toArray().slice(0,cap).map(el=>{
      const c=$(el), a=c.find('a[href^="/catalog/"]').filter((_,e)=>$(e).text().trim()).first();
      return make('Дава',link(a.attr('href'),root),a.text(),rub(c.find('.sprice').first().text()),{conditions:'Каталог поставщика, Великий Новгород'});
    });
  }},
  {name:'LionPack', async query(q){
    const root='https://lionpack.ru', $=await asHtml(root+'/search/?search='+encodeURIComponent(q));
    if (!/поиск/i.test($('title').text()+' '+$('h1').text())) throw new Error('Каталог не вернул выдачу');
    return $('.product-thumb').toArray().slice(0,cap).map(el=>{
      const c=$(el), a=c.find('.caption a[href], a.product-name[href]').filter((_,e)=>$(e).text().trim()).first();
      const href=a.attr('href');
      const price = c.find('.price-new').first().text() || c.find('.price').first().text();
      const details = compact(c.text()).slice(0,800);
      return make('LionPack',link(href,root),a.text(),rub(price),{details,conditions:/под заказ/i.test(details)?'Под заказ, срок и объём уточняются':'Каталог поставщика, Санкт-Петербург'});
    });
  }},
  {name:'Читай-город', async query(q){
    const root='https://www.chitai-gorod.ru', $=await asHtml(root+'/search?phrase='+encodeURIComponent(q));
    if (!$('title').text().includes('Читай-город') && !$('.app-products-list').length) throw new Error('Каталог не вернул выдачу');
    const rows=$('.app-products-list__item').toArray().slice(0,cap).map(el=>{
      const c=$(el), a=c.find('a.product-card-base__title').first();
      return make('Читай-город',link(a.attr('href'),root),a.text(),rub(c.find('.product-card-base__current-price').first().text()),{conditions:'Онлайн-цена каталога'});
    }).filter(r=>r.url&&r.title);
    await Promise.all(rows.slice(0,4).map(async row=>{
      try {
        const detail=await asHtml(row.url);
        const description=detail('meta[name="description"]').attr('content') ?? '';
        const attributes=detail('[class*="description"],[class*="characteristic"],[class*="attribute"]').toArray().map(e=>detail(e).text()).join(' ');
        row.details=compact(description+' '+attributes).slice(0,2500);
      } catch { row.conditions += ' · характеристики карточки недоступны'; }
    }));
    return rows;
  }},
  ...catalogAdapters,
];

const searchUrl = (base, key, query) => {
  const url = new URL(base);
  url.searchParams.set(key,query);
  return url.href;
};

const eisUrl = query => searchUrl(
  'https://zakupki.gov.ru/epz/contract/search/results.html?morphology=on&pageNumber=1&recordsPerPage=_10&contractStageList=EC',
  'searchString',query
);

async function searchEis(query) {
  const url = eisUrl(query);
  const $ = await asHtml(url);
  const entries = $('.registry-entry__form');
  const empty = /по вашему запросу ничего не найдено|результат поиска:\s*0\b|найдено\s+0\s+контрактов/i.test(compact($('main, .search-results, .search-results__total').text()));
  if (!entries.length && empty) return {name:'ЕИС',url,state:'ok',records:[],marketplaceAllowed:true};
  const records = entries.toArray().slice(0,7).flatMap(element=>{
    const card = $(element);
    const status = compact(card.find('.registry-entry__header, .registry-entry__header-top').text());
    if (!/исполнение завершено/i.test(status)) return [];
    const url = link(card.find('a[href*="contractInfo"]').first().attr('href'),eisUrl(query));
    const title = compact(card.find('.registry-entry__body-value').first().text());
    if (!url || !title) return [];
    return [make('ЕИС',url,title,null,{
      details:compact(card.find('.registry-entry__body').text()).slice(0,700),
      conditions:'Реестр контрактов · исполнение завершено',
      unavailable:'По выдаче не подтверждены дата исполнения, отсутствие неустоек и цена позиции'
    })];
  });
  return {name:'ЕИС',url,state:'partial',records,note:'Для расчёта нужно проверить дату исполнения, неустойки и цену позиции в карточке контракта'};
}

const mandatory = [
  {name:'ГИСП',home:'https://gisp.gov.ru/goods/'},
  {name:'Сбербанк-АСТ',home:'https://www.sberbank-ast.ru/',url:q=>searchUrl('https://world.sberbank-ast.ru/tableForm.aspx?formCode=PurchaseList','PurchaseName',q)},
  {name:'РТС-тендер',home:'https://www.rts-tender.ru/poisk'},
  {name:'Росэлторг',url:q=>searchUrl('https://www.roseltorg.ru/procedures/search','query_field',q),paths:/^\/procedure\//},
  {name:'ЭТП ГПБ',home:'https://gos.etpgpb.ru/tender/list/'},
  {name:'Заказ РФ',home:'https://etp.zakazrf.ru/'},
  {name:'ТЭК-Торг',url:q=>searchUrl('https://www.tektorg.ru/44-fz/procedures','name',q),paths:/^\/44-fz\/procedures\/\d/},
  {name:'Фабрикант',url:q=>searchUrl('https://www.fabrikant.ru/procedure/search','query',q),paths:/^\/(?:44\/procedure|trades)\//},
  {name:'РАД',home:'https://gz.lot-online.ru/'},
  {name:'ЕАТ «Берёзка»',home:'https://agregatoreat.ru/'},
  {name:'Портал поставщиков Москвы',home:'https://zakupki.mos.ru/'},
  {name:'Электронный магазин Московской области',home:'https://market.mosreg.ru/Trade',
    url:()=> 'https://market.mosreg.ru/Home/SearchTrade',options:q=>({method:'POST',body:new URLSearchParams({tradeName:q})})},
  {name:'КОРУС',referenceOnly:true},
  {name:'ЭТМ',url:q=>searchUrl('https://www.etm.ru/catalog','search',q),paths:/^\/cat\/nn\//,retail:true},
  {name:'Чип и Дип',url:q=>searchUrl('https://www.chipdip.ru/search','searchtext',q),paths:/^\/product\//,retail:true}
];

const marketplaces = [
  {name:'Яндекс Маркет',url:q=>searchUrl('https://market.yandex.ru/search','text',q),paths:/^\/product/},
  {name:'Ozon',url:q=>searchUrl('https://www.ozon.ru/search/','text',q),paths:/^\/product\//},
  {name:'ВсеИнструменты.ру',url:q=>searchUrl('https://www.vseinstrumenti.ru/search/','what',q),paths:/^\/product\//},
  {name:'Комус',url:q=>searchUrl('https://www.komus.ru/search/','text',q),paths:/^\/katalog\/.*\/p\//},
].map(source=>({...source,retail:true}));

const marketplaceDomains = new Set(['ozon.ru','vseinstrumenti.ru','komus.ru','wildberries.ru','wb.ru','megamarket.ru']);
const publicMarketplace = url => {
  const host = new URL(url).hostname;
  return marketplaceDomains.has(sellerDomain(url)) || /(?:^|\.)market\.yandex\.ru$/i.test(host);
};

async function searchIndex(source, query, url) {
  const hostname = new URL(url).hostname.replace(/^www\./,'');
  const index = searchUrl('https://www.bing.com/search?format=rss&cc=ru&setlang=ru','q',query+' site:'+hostname);
  const $ = load(await page(index),{xmlMode:true});
  return $('item').toArray().flatMap(element=>{
    const card = $(element);
    const target = link(card.children('link').text(),url);
    const title = compact(card.children('title').text());
    const targetHost = target && new URL(target).hostname.replace(/^www\./,'');
    if (!target || !title || (targetHost!==hostname && !targetHost.endsWith('.'+hostname) &&
        !(source.name==='Фабрикант' && targetHost==='44.fabrikant.ru')) ||
        (source.paths ? !source.paths.test(new URL(target).pathname) : new URL(target).pathname===new URL(url).pathname)) return [];
    return [{url:target,title}];
  }).slice(0,6);
}

async function queryDirectory(source, query) {
  if (source.referenceOnly) return {
    state:'partial',records:[],note:'Для поиска нужен адрес открытого прайс-листа КОРУС'
  };
  const url = source.url?.(query) ?? source.home;
  const direct = source.url ? (async()=>{
    const $ = await asHtml(url,source.options?.(query));
    if (!source.paths) return [];
    return $('a[href]').toArray().flatMap(el=>{
      const anchor = $(el);
      const title = compact(anchor.text());
      const cardUrl = link(anchor.attr('href'),url);
      if (!cardUrl || title.length<12 || !source.paths.test(new URL(cardUrl).pathname) ||
          sellerDomain(cardUrl)!==sellerDomain(url)) return [];
      return [{url:cardUrl,title}];
    });
  })() : Promise.resolve([]);
  const indexed = searchIndex(source,query,url);
  const [catalog,index] = await Promise.allSettled([direct,indexed]);
  const records = new Map();
  for (const candidate of [...(catalog.value??[]),...(index.value??[])]) {
    if (records.has(candidate.url)) continue;
    const indexedOnly = !(catalog.value??[]).some(row=>row.url===candidate.url);
    records.set(candidate.url,make(source.name,candidate.url,candidate.title,null,{
      unit:null,web:source.retail,
      conditions:indexedOnly?'Ссылка из поиска по сайту. Проверьте карточку первоисточника':undefined,
      ...(!source.retail && {unavailable:'Для расчёта нужна подтверждённая цена за единицу'})
    }));
    if (records.size >= (source.retail?4:6)) break;
  }
  if (!records.size) {
    if (catalog.status==='rejected') throw catalog.reason;
    if (index.status==='rejected') throw index.reason;
    return {state:'partial',records:[],note:'Поиск не вернул карточек, которые удалось прочитать'};
  }
  const rows = [...records.values()];
  return {state:'ok',records:source.retail?await expandCards(rows,4,3500,true):rows,
    note:catalog.value?.length?undefined:'Ссылки найдены поиском по сайту'};
}

async function withDeadline(run, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(run),
      new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(new DOMException('Источник не ответил вовремя','TimeoutError')),milliseconds);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function market(query, onSource = () => {}, request, onRound = () => {}) {
  const started=Date.now();
  const hasAgent=agentConfigured();
  const deep=request?.deepSearch===true;
  const targeted=Boolean(request && (hasAgent || deep));
  const publish = group => {
    const {name,state,note,records,url} = group;
    onSource({name,state,note,url,count:records.length});
    return group;
  };
  const reportFailure = (name,url,error) => ({
    name,url,state:'unavailable',records:[],
    note:error.name==='TimeoutError'?'Источник не ответил вовремя':
      /^HTTP \d{3}$/.test(error.message)
        ? error.message : 'Нет ответа или формат источника изменился'
  });
  const eis = publish(await searchEis(query).catch(error=>reportFailure('ЕИС',eisUrl(query),error)));
  const allows = row => Boolean(row.url && (eis.marketplaceAllowed || !publicMarketplace(row.url)));
  const directory = (source) => {
    const url = source.home ?? source.url?.(query);
    return withDeadline(()=>queryDirectory(source,query),12000)
      .then(group=>publish({name:source.name,url,...group}))
      .catch(error=>publish(reportFailure(source.name,url,error)));
  };
  const required = mandatory.map(directory);
  const reserve = marketplaces.map(source=>eis.marketplaceAllowed ? directory(source) : Promise.resolve(publish({
    name:source.name,url:source.url(query),state:'skipped',records:[],
    note:'По ЕИС ещё не подтверждено отсутствие подходящих контрактов'
  })));
  const catalogs = adapters.filter(adapter=>(!targeted || adapter.query!==searchWeb) &&
    adapter.name!=='ВсеИнструменты.ру' &&
    (!adapter.applies || adapter.applies(query))).map(async adapter=>{
    try {
      const network=/коммутатор|свитч/i.test(query);
      const cup=/стакан/i.test(query);
      const wait=adapter.query===searchWeb ? 26500 : 16000;
      const records=(await withDeadline(()=>adapter.query(query,allows),wait)).filter(r=>r.url && r.title && allows(r) &&
        (!network || r.web || /коммутатор|свитч|\bswitch\b/i.test(r.title)) &&
        (!cup || r.web || /стакан/i.test(r.title)));
      return publish({name:adapter.name,state:'ok',records});
    } catch (error) {
      return publish(reportFailure(adapter.name,undefined,error));
    }
  });
  const analogQuery=request?.analogs && request.analogQuery;
  const analogSources=analogQuery && compact(analogQuery).toLowerCase()!==compact(query).toLowerCase()
    ? adapters.filter(adapter=>adapter.query!==searchWeb && (!adapter.applies || adapter.applies(analogQuery)) &&
        (eis.marketplaceAllowed || adapter.name!=='ВсеИнструменты.ру')).map(async adapter=>{
        const name=adapter.name+' · аналоги';
        try{
          const records=await withDeadline(()=>adapter.query(analogQuery),16000);
          return publish({name,state:'ok',records:records.filter(row=>row.title && allows(row)).map(row=>({...row,analogSearch:true}))});
        }catch(error){return publish(reportFailure(name,undefined,error));}
      }) : [];
  const result = [eis,...await Promise.all([...required,...reserve,...catalogs,...analogSources])];
  const unique=new Map();
  const addRows=rows=>{
    for(const row of rows) {
      const previous=unique.get(row.url);
      if(!previous || (!previous.price && row.price>0) || (!previous.unit && row.unit && row.price>0)) {
        unique.set(row.url,{...row,id:row.url,analogSearch:previous?.analogSearch===false?false:row.analogSearch});
      }
    }
  };
  for(const group of result) addRows(group.records);
  const sources=result.map(({name,state,note,records,url})=>({name,state,note,url,count:records.length}));
  if(!targeted) return {records:[...unique.values()],sources};

  const inCalculation=()=>{
    const included=evaluate([...unique.values()],request).included;
    if(request.pricingMode!=='lite') return included;
    return [...new Map(included.map(row=>[sellerDomain(row.url),row])).values()];
  };
  const deepStats=()=>{
    const strict=evaluate([...unique.values()],{...request,pricingMode:'strict'});
    const prices=[...new Map(strict.included.map(row=>[sellerDomain(row.url),row.unitPrice])).values()];
    const count=prices.length;
    if(count<2) return {count,cv:null,reached:false};
    const mean=prices.reduce((sum,price)=>sum+price,0)/count;
    const cv=100*Math.sqrt(prices.reduce((sum,price)=>sum+(price-mean)**2,0)/(count-1))/mean;
    return {count,cv,reached:count>=5 && cv<=20};
  };
  const reviewed=new WeakSet();
  const attempted=new Set();
  const baseline=deep?deepStats():null;
  const baselineReview=deep?evaluate([...unique.values()],{...request,pricingMode:'strict'}).rows.filter(row=>row.state==='review').length:0;
  let secondChecks=0;
  async function enrichCandidates(){
    if(attempted.size>=24) return;
    const enriched=await enrichDeepOffers([...unique.values()],request,attempted);
    for(const row of enriched){
      const existing=unique.get(row.id);
      if(!existing) continue;
      unique.set(row.id,{...existing,...Object.fromEntries(Object.entries(row).filter(([,value])=>value!=null)),id:existing.id});
    }
  }
  let reviewPasses=0;
  async function reviewNewOffers(){
    const ranked=evaluate([...unique.values()],{...request,pricingMode:'strict'}).rows;
    const pending=ranked.filter(row=>row.state!=='excluded' && row.price>0)
      .map(row=>unique.get(row.url)).filter(row=>!reviewed.has(row)).slice(0,40);
    if(!hasAgent || !pending.length || reviewPasses>=2) return;
    reviewPasses++;
    pending.forEach(row=>reviewed.add(row));
    const check=await reviewOffers(query,request,pending,onSource);
    if(!check) return;
    const index=sources.findIndex(source=>source.name===check.name);
    if(index===-1) sources.push(check);
    else sources[index]=check;
  }
  async function searchDeepCatalogs(phrase) {
    const matching=adapters.filter(adapter=>adapter.query!==searchWeb && adapter.name!=='ВсеИнструменты.ру' &&
      (!adapter.applies || adapter.applies(phrase)));
    const groups=await Promise.allSettled(matching.map(adapter=>withDeadline(()=>adapter.query(phrase,allows),16000)));
    return groups.flatMap(group=>group.status==='fulfilled'?group.value:[]);
  }
  const agent={name:'ИИ-поиск в интернете',state:'ok',count:0};
  let rounds=0;
  const checkedDomains=new Set(inCalculation().map(row=>sellerDomain(row.url)));
  const roundHistory=[];
  let tryCatalog=hasReserveCatalog(query);
  let agentAvailable=hasAgent;
  const roundLimit=deep?8:maxSearchRounds;
  let exaRounds=0;
  let exaAvailable=true;
  let nextExa=true;
  let agentRounds=0;
  let variants;
  while(rounds<roundLimit) {
    const confirmed=inCalculation();
    if(deep && deepStats().reached){
      await enrichCandidates();
      await reviewNewOffers();
      if(deepStats().reached) break;
    }
    if(deep ? (!tryCatalog && (!agentAvailable || agentRounds>=4) && exaRounds>=4)
      : ((confirmed.length>=3 && (!analogQuery || agentRounds>0)) || (!tryCatalog && !agentAvailable))) break;
    rounds++;
    const goal=deep?deepStats():null;
    const progress={round:rounds,maxRounds:roundLimit,confirmed:goal?.count??confirmed.length,
      ...(goal?{target:5,cv:goal.cv}:{})};
    const useCatalog=tryCatalog;
    tryCatalog=false;
    const useExa=deep && !useCatalog && exaRounds<4 && (nextExa || !agentAvailable || agentRounds>=4);
    let method=useCatalog?'catalog':useExa?(exaAvailable?'exa':'catalog'):'agent';
    if(!useCatalog) nextExa=!useExa;
    const lookingForAnalogs=Boolean(analogQuery && !useCatalog && (deep
      ? (useExa ? exaRounds>=2 : agentRounds>=2)
      : (agentRounds>0 || confirmed.length>=3 || rounds===maxSearchRounds)));
    const variantIndex=useExa?exaRounds:agentRounds;
    if(deep && !useCatalog && variantIndex>0 && !variants){
      const publicDescription=/https?:|@|\+\d[\d ()-]{9,}/i.test(request.description)?query:request.description;
      variants=await searchVariants(query,publicDescription);
    }
    const searchQuery=lookingForAnalogs?analogQuery+(deep && variantIndex>2?' поставщик':''):
      deep && variantIndex>0?(variantIndex===1?variants?.[0]:deepQueriesForGap(query,request,[...unique.values()])[variantIndex-2])??query:query;
    const excluded=lookingForAnalogs&&!deep?new Set():checkedDomains;
    const roundQuery=deep?{query:searchQuery}:{};
    const onCards=found=>onRound({...progress,method,phase:'cards',found,...roundQuery});
    onRound({...progress,method,phase:'search',...roundQuery});
    if(useExa) exaRounds++;
    try {
      let rows, repeated=0;
      if(useCatalog) rows=await withDeadline(()=>searchReserveCatalog(query,checkedDomains),12500);
      else if(useExa){
        if(exaAvailable){
          try {
            rows=await searchExaRound(searchQuery,excluded,onCards,allows);
          } catch(error) {
            if(/^HTTP (?:401|403|429)$/.test(error.message)) exaAvailable=false;
            const source={name:'Exa · раунд '+rounds,state:'unavailable',count:0,note:'Exa временно недоступен'};
            sources.push(source);
            onSource(source);
            method='catalog';
            onRound({...progress,method,phase:'search',...roundQuery});
          }
        }
        if(!rows?.length){
          method='catalog';
          const phrase=variantIndex===0?searchQuery.replace(/писчая бумага/iu,'офисная бумага'):searchQuery;
          rows=await searchDeepCatalogs(phrase);
        }
      } else ({rows,repeated}=await withDeadline(
        ()=>searchAgentRound(searchQuery,excluded,++agentRounds,onCards,allows),agentRoundDeadlineMs
      ));
      const allowedRows=rows.filter(allows).map(row=>lookingForAnalogs?{...row,analogSearch:true}:row);
      const newRows=allowedRows.filter(row=>!unique.has(row.url));
      const domains=[...new Set(newRows.map(row=>sellerDomain(row.url)))];
      for(const row of allowedRows) if(!deep) checkedDomains.add(sellerDomain(row.url));
      if(method==='catalog') {
        for(const seller of new Set(allowedRows.map(row=>row.seller))) {
          const source={name:seller,state:'ok',count:allowedRows.filter(row=>row.seller===seller).length};
          sources.push(source);
          onSource(source);
        }
      } else if(method==='exa') {
        const source={name:'Exa · раунд '+rounds,state:'ok',count:newRows.length};
        sources.push(source);
        onSource(source);
      } else {
        agent.count+=newRows.length;
        agent.state='ok';
        delete agent.note;
      }
      addRows(allowedRows);
      if(deep) for(const row of inCalculation()) checkedDomains.add(sellerDomain(row.url));
      const summary={round:rounds,method,domains,repeated,
        priced:newRows.filter(row=>row.price>0).length,confirmed:deep?deepStats().count:inCalculation().length,...(deep?{target:5,cv:deepStats().cv}:{})};
      roundHistory.push({...summary,...roundQuery});
      onRound({...summary,maxRounds:roundLimit,finished:true,...roundQuery});
    } catch(error) {
      const reason = useExa ? 'Exa временно недоступен' : useCatalog ? 'Дополнительные каталоги не ответили' : error.name==='TimeoutError' ? 'Агент не ответил за '+agentRoundWaitMs/1000+' с'
        : /^HTTP \d{3}$/.test(error.message)
          ? error.message : 'Агент временно недоступен';
      if(useExa) {
        const source={name:'Exa · раунд '+rounds,state:'unavailable',count:0,note:reason};
        sources.push(source);
        onSource(source);
      } else if(!useCatalog) {
        agentAvailable=false;
        agent.state=agent.count?'ok':'unavailable';
        agent.note=reason;
      }
      const summary={round:rounds,method,domains:[],priced:0,confirmed:deep?deepStats().count:inCalculation().length,note:reason,...(deep?{target:5,cv:deepStats().cv}:{})};
      roundHistory.push({...summary,...roundQuery});
      onRound({...summary,maxRounds:roundLimit,finished:true,...roundQuery});
    }
  }
  if(!roundHistory.some(item=>item.method==='agent')) {
    agent.state='skipped';
    agent.note=deep?'Раунды Timeweb не потребовались или агент недоступен':'Каталоги уже дали три сопоставимых цены';
  }
  sources.unshift(agent);
  onSource(agent);
  if(deep){
    await enrichCandidates();
    await reviewNewOffers();
    const ranked=evaluate([...unique.values()],{...request,pricingMode:'strict'}).rows;
    const disputed=ranked.filter(row=>row.state!=='excluded' && row.price>0 &&
      (row.analog || row.checks.some(check=>check.status==='unknown')))
      .sort((a,b)=>Number(Boolean(b.analog))-Number(Boolean(a.analog)));
    if(verifierConfigured() && disputed.length){
      secondChecks=await verifyDisputedOffers(query,request,disputed);
      for(const row of disputed) if(row.secondaryReview) unique.get(row.id).secondaryReview=row.secondaryReview;
    }
    const goal=deepStats();
    const records=[...unique.values()];
    const finalReview=evaluate(records,{...request,pricingMode:'strict'}).rows.filter(row=>row.state==='review').length;
    return {records,sources,rounds,roundHistory,confirmed:goal.count,deepResult:{...goal,
      baseline:baseline.count,baselineReview,finalReview,reread:attempted.size,secondChecks,verifier:verifierConfigured(),elapsedMs:Date.now()-started}};
  }
  const records=[...unique.values()];
  const review=await reviewOffers(query,request,records,onSource);
  if(review) sources.push(review);
  return {records,sources,rounds,roundHistory,confirmed:inCalculation().length};
}
