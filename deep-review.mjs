import { evaluate, printerModelKey, specs } from './public/analysis.js';
import { expandCards, readManufacturerEvidence } from './product-cards.mjs';

export async function enrichDeepOffers(rows, request, attempted) {
  const ranked=evaluate(rows,{...request,pricingMode:'strict'}).rows;
  const candidates=ranked.filter(row=>row.web && !row.manual && !row.unavailable && row.state!=='excluded' &&
    (row.checks.some(check=>check.status==='unknown') || !row.unitPrice || !row.shippingQuotes?.length))
    .filter(row=>!attempted.has(row.url)).slice(0,12);
  candidates.forEach(row=>attempted.add(row.url));
  if(!candidates.length) return [];
  const reread=await expandCards(candidates,12,6500,true);
  const evidence=new Map();
  return Promise.all(reread.map(async row=>{
    const key=/\bbambu\s+lab\s+a1\s+mini\b/i.test(row.title)?'bambu-a1-mini':printerModelKey(row.title);
    if(!key || !ranked.find(candidate=>candidate.id===row.id)?.checks.some(check=>check.status==='unknown')) return row;
    if(!evidence.has(key)) evidence.set(key,readManufacturerEvidence(row.title));
    const proof=await evidence.get(key);
    return proof?{...row,specEvidence:proof}:row;
  }));
}

export function deepQueriesForGap(query, request, rows) {
  const candidates=evaluate(rows,{...request,pricingMode:'strict'}).rows;
  const missingPrice=candidates.find(row=>row.state==='review' && !row.analog && !row.price && !row.unverifiedTitle);
  const model=printerModelKey(missingPrice?.title??'') || printerModelKey(query);
  const title=missingPrice?.title.split(/[\n;,.]/)[0];
  const alternative=request.analogQuery;
  const requirements=specs(request.description);
  const category=query.split(/[,;]/)[0];
  return [...new Set([
    title ? title+' поставщик' : model ? query+' цена в наличии' : query+' поставщик',
    alternative || [category,...Object.values(requirements).slice(0,3)].join(' '),
    model ? query+' официальный дилер' : query+' оптом'
  ].map(phrase=>phrase.trim().slice(0,130)).filter(phrase=>phrase!==query && !/https?:|@|\+\d[\d ()-]{9,}/i.test(phrase)))];
}
