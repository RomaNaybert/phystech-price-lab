import {units, evaluate, round, deliveredEstimate} from './analysis.js?v=64';
import {parseSpecification,parsePdfSpecification,positionRequest,suggestedAnalogQuery} from './specification.js?v=64';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const offerReviewSource='Проверка предложений ИИ';
const sourcePlural = new Intl.PluralRules('ru-RU');
const amount = new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',minimumFractionDigits:0,maximumFractionDigits:2});
const num = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
const date = new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Moscow'});
const money = n => Number.isFinite(n) ? amount.format(round(n)) : '—';
const sourceMoney = row => row.currency === 'RUB' ? money(row.price) : Number.isFinite(row.price) ? num.format(row.price)+' '+String(row.currency??'') : '—';
const variation = n => Number.isFinite(n) ? num.format(n)+'%' : '—';
const when = s => s ? date.format(new Date(s))+' МСК' : 'Учебные данные';
const safeLink = value => {try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password ? u.href : null;} catch {return null;}};
const sourceLink = r => safeLink(r.url) ? '<a class="source-link" rel="noopener noreferrer" target="_blank" href="'+esc(safeLink(r.url))+'">'+esc(r.seller)+' <i class="icon external" aria-hidden="true"></i></a>' : esc(r.seller);
const badges = {eligible:'В расчёте',review:'На проверку',excluded:'Исключено'};
const sourceNames = ['ЕИС','ГИСП','Сбербанк-АСТ','РТС-тендер','Росэлторг','ЭТП ГПБ','Заказ РФ',
  'ТЭК-Торг','Фабрикант','РАД','ЕАТ «Берёзка»','Портал поставщиков Москвы','Электронный магазин Московской области',
  'КОРУС','ЭТМ','Чип и Дип','Яндекс Маркет','Ozon','ВсеИнструменты.ру','Комус','МЕТРО','Дава','LionPack','Читай-город','Сима-ленд'];
const examples = {
  paper:{ description:'Бумага А4 SvetoCopy. Белая, плотность 80 г/м², 500 листов в пачке.',query:'бумага А4 SvetoCopy',quantity:25,unit:'пачка',
    data:[
      ['Пример · Поставщик А','Бумага А4 SvetoCopy, 80 г/м², 500 листов',342,'1 пачка, базовая цена'],
      ['Пример · Поставщик Б','Бумага А4 SvetoCopy, 80 г/м², 500 листов',365,'1 пачка, базовая цена'],
      ['Пример · Поставщик В','Бумага А4 SvetoCopy, 80 г/м², 500 листов',389,'1 пачка, базовая цена'],
      ['Пример · Поставщик Г','Бумага А4 SvetoCopy, 80 г/м², 500 листов',790,'1 пачка, базовая цена'],
      ['Пример · Поставщик Д','Бумага А3 SvetoCopy, 80 г/м², 500 листов',540,'1 пачка, базовая цена']
    ]},
  cups:{description:'Стаканы одноразовые бумажные, объём 250 мл.',query:'стаканы бумажные 250 мл',quantity:500,unit:'шт.',
    data:[
      ['Пример · Поставщик А','Стакан одноразовый бумажный, 250 мл',7,'За 1 шт.'],
      ['Пример · Поставщик Б','Стакан одноразовый бумажный, 250 мл',8,'За 1 шт.'],
      ['Пример · Поставщик В','Стакан одноразовый бумажный',9,'За 1 шт.'],
      ['Пример · Поставщик Г','Стакан одноразовый бумажный, 200 мл',6,'За 1 шт.']
    ]}
};
let state;
let result;
let filter='all';
let pending=null;
let liveController=null;
let detailRow=null;
let editingOffer=null;
let pricingMode='strict';
let positions=[];
let activePosition=null;
let manualState=null;
let batchRunning=false;
let batchStopped=false;
let specFileName='';
let importing=false;
let zipLibrary;

function requestFromForm(){
  return {description:$('description').value.trim(),quantity:Number($('quantity').value),unit:$('unit').value,pricingMode,deepSearch:$('deep-search').checked};
}

function emptySearch(request){
  return {request,query:'',mode:'idle',rows:[],overrides:{},sources:[]};
}

function showExample(name){
  liveController?.abort();
  activePosition=null;
  const {description,query,quantity,unit,data}=examples[name];
  $('description').value=description;
  $('quantity').value=quantity;
  $('unit').value=unit;
  state={request:{description,quantity,unit,pricingMode},query,mode:'demo',rows:data.map(([seller,title,price,conditions],i)=>({
    id:'example-'+i,seller,title,price,conditions,unit,currency:'RUB'
  })),overrides:{},sources:[]};
  filter='all';
  render();
}

function estimateGuidance(calculation){
  if(calculation.lite){
    if(!calculation.n) return 'Нужна хотя бы одна доступная цена с релевантностью от 40.';
    const messages=[];
    if(calculation.reviewedIds.size) messages.push('Учтено предложений на проверку: '+calculation.reviewedIds.size+'.');
    if(calculation.n===1) messages.push('Оценка по одной цене. Вариация не рассчитывается.');
    if(calculation.cv>70) messages.push('Вариация выше 70%. Проверьте цены и условия предложений.');
    return messages.join(' ');
  }
  const estimate=calculation.preliminary ?? calculation;
  const messages=[];
  if(calculation.preliminary?.ids.size){
    messages.push('В предварительную оценку вошли цены со статусом «На проверку». Откройте карточку через «Проверить предложение» и сверьте цену и характеристики.');
    if(estimate.n<3) messages.push('Оценка основана на '+estimate.n+' из 3 нужных источников.');
  } else if(calculation.n<3 && calculation.preliminary){
    messages.push('Оценка основана на '+estimate.n+' из 3 нужных источников. Добавьте проверенные предложения.');
    if(estimate.n===1) messages.push('Для одной цены вариация не рассчитывается.');
  }
  if(estimate.cv>30){
    const threshold=estimate.cv>33
      ? 'Вариация '+variation(estimate.cv)+' выше порога 33% для рекомендуемой НМЦД.'
      : 'Вариация '+variation(estimate.cv)+' выше 30%.';
    const prices=calculation.preliminary?.ids.size ? 'У предложений, вошедших в оценку,' : 'В разделе «В расчёте»';
    messages.push(threshold+' '+prices+' сравните цены за единицу, комплектацию и условия поставки.');
  }
  return messages.join(' ');
}

function deliverySummary(request, calculation){
  const ids=calculation.preliminary?.ids;
  const extra=ids?calculation.rows.filter(row=>ids.has(row.id)).map(row=>({...row,unitPrice:row.unitPrice??row.assumedUnitPrice})):[];
  const rows=[...calculation.included,...extra];
  const destination=rows.find(row=>row.manualShipping)?.manualShipping.region;
  const delivery=deliveredEstimate(rows,request.quantity,destination);
  if(!delivery) return '';
  if(delivery.total===null) return 'Полная цена для региона «'+destination+'» требует подтверждения доставки и НДС по всей выборке.';
  return 'С учётом доставки в регион «'+destination+'» — '+money(delivery.total)+' за всю позицию. '+
    (delivery.verified[0].vat==='included'?'НДС включён.':'НДС не начисляется.');
}

function render(){
  const isLoading=state.mode==='loading';
  const isDemo=state.mode==='demo';
  document.body.classList.toggle('searching',isLoading);
  result=evaluate(state.rows,state.request,state.overrides);
  if(activePosition) activePosition.result=state;
  else if(state.mode!=='loading') manualState=state;
  renderPositions();
  $('result-mode').textContent=isDemo?'Демо':isLoading?'Поиск':state.mode==='idle'?'Новый запрос':'Расчёт';
  const estimate=result.preliminary ?? result;
  $('strict-method').hidden=result.lite;
  $('strict-outliers').hidden=result.lite;
  $('lite-method').hidden=!result.lite;
  $('count-label').textContent=result.lite?'Цены':'Источники';
  $('estimate-title').textContent=result.lite?'Оценка · Лайт':result.preliminary?'Предварительная оценка':'Рекомендуемая НМЦД';
  $('total').textContent=money(estimate.total);
  const delivery=deliverySummary(state.request,result);
  $('delivered-note').textContent=delivery;
  $('delivered-note').hidden=!delivery;
  const quantityNote='За '+num.format(state.request.quantity)+' '+state.request.unit+(isDemo?' · условные цены':'');
  const guidance=estimateGuidance(result);
  const assumedNote=estimate.assumedCount ? ' Цены без указанной единицы предварительно считаются ценами за 1 шт.' : '';
  $('estimate-note').textContent=isLoading?'Собираем данные из открытых источников…':estimate.total!==null
    ? quantityNote+'. '+guidance+assumedNote
    : result.lite ? guidance : 'Подтверждено '+result.n+' из 3 нужных продавцов. '+(result.rows.some(row=>row.state==='review')
      ? 'Откройте «На проверку» и сверьте характеристики и цену.'
      : 'Уточните запрос или добавьте проверенное КП.');
  const reviewAction=result.reviewedIds?.size || result.preliminary?.ids.size || (result.n<3 && result.rows.some(row=>row.state==='review'));
  const estimateAction=$('estimate-action');
  estimateAction.hidden=isLoading || !(reviewAction || estimate.cv>(result.lite?70:30));
  estimateAction.dataset.target=reviewAction?'review':'eligible';
  estimateAction.textContent=reviewAction?'Открыть «На проверку»':'Открыть «В расчёте»';
  $('average').textContent=money(estimate.mean);
  $('count').textContent=String(estimate.n);
  $('cv').textContent=variation(estimate.cv);
  syncInputs();
  $('add-offer').disabled=isLoading || batchRunning;
  $('purchase').querySelector('[type=submit]').disabled=batchRunning;
  document.querySelectorAll('[data-example], [name=pricing-mode]').forEach(control=>control.disabled=batchRunning);
  $('offers-subtitle').textContent=isDemo?'Демонстрационный набор. Запустите поиск, чтобы получить открытые цены.':
    isLoading?'Запрос «'+state.query+'»':state.query ? 'Запрос «'+state.query+'»':'Сопоставьте предложения с вашим запросом.';
  $('search-progress').hidden=!isLoading;
  const reviewing=isLoading && state.sources.some(source=>source.name===offerReviewSource && source.state==='loading');
  const round=isLoading && !reviewing ? state.round : null;
  const catalogSources=state.sources.filter(source=>source.name!=='ИИ-поиск в интернете' && source.name!==offerReviewSource);
  const settled=catalogSources.filter(source=>source.state!=='loading').length;
  $('search-progress-title').textContent=reviewing?'ИИ проверяет предложения…':round?'Расширяем поиск':'Собираем предложения…';
  $('progress-bar').hidden=Boolean(round) || reviewing;
  $('progress-count').hidden=Boolean(round) || reviewing;
  $('progress-bar').max=catalogSources.length||1;
  $('progress-bar').value=settled;
  $('progress-count').textContent='Проверено '+settled+' из '+catalogSources.length+' источников';
  $('round-loader').hidden=!round;
  if(round) {
    $('round-spinner').hidden=Boolean(round.finished);
    $('round-stage').textContent='Раунд '+round.round+' из '+round.maxRounds;
    const detail=round.finished ? (round.note??'Проверка раунда завершена.')
      : round.phase==='cards' ? 'Проверяем карточки новых магазинов: '+round.found+'.'
      : round.method==='catalog' ? 'Проверяем дополнительные каталоги.' : round.method==='exa'?'Ищем у продавцов через Exa.':'Ищем новых продавцов.';
    $('round-status').textContent=detail+' Сопоставимых цен: '+round.confirmed+' из '+(round.target??3)+'.'+(round.cv!=null?' Вариация: '+variation(round.cv)+'.':'')+(round.query?' Запрос: «'+round.query+'».':'');
  }
  const totals=[
    ['eligible','В расчёте',result.lite?result.n-result.reviewedIds.size:result.n],
    ['excluded','Исключено',result.rows.filter(row=>row.state==='excluded').length],
    ['review','На проверку',result.rows.filter(row=>row.state==='review').length]
  ];
  $('outcome').hidden=isLoading||!state.rows.length;
  $('outcome').innerHTML=totals.map(([status,label,count])=>{
    const icon={eligible:'ok',excluded:'close-icon',review:'alert'}[status];
    const help=status==='eligible'?'':'<button type="button" class="outcome-help" data-status-help="'+status+'" aria-label="Что означает статус «'+label+'»" aria-haspopup="dialog">?</button>';
    return '<div class="outcome-tile '+status+'"><button type="button" class="outcome-card" data-outcome="'+status+'"><i class="icon '+icon+'" aria-hidden="true"></i><span><strong>'+count+'</strong> '+label+'</span></button>'+help+'</div>';
  }).join('');
  $('sources').innerHTML=state.sources.map(s=>{
    const detail=s.state==='loading'?'ищем':s.state==='ok'?(s.count ? s.count+' найдено':'ничего не найдено'):
      s.state==='skipped'?'пропущен':s.state==='partial'?'требует проверки':'недоступен';
    const href=safeLink(s.url);
    const tag=href?'a':'span';
    return '<'+tag+' class="source-chip '+(s.state==='ok'?'ok':s.state==='loading'?'wait':'')+'" title="'+esc(s.note??detail)+'"'+
      (href?' href="'+esc(href)+'" target="_blank" rel="noopener noreferrer"':'')+'>'+
      (s.state==='ok'?'<i class="icon ok" aria-hidden="true"></i>':['unavailable','partial'].includes(s.state)?'<i class="icon alert" aria-hidden="true"></i>':'')+
      esc(s.name)+' · '+detail+'</'+tag+'>';
  }).join('');
  const history=state.roundHistory ?? [];
  $('round-history').hidden=!history.length;
  $('round-list').replaceChildren(...history.map(item=>{
    const entry=document.createElement('li');
    const found=item.domains.length ? item.domains.join(', ')+' · карточек с ценой: '+item.priced
      : item.repeated ? 'Агент вернул только уже проверенные магазины' : 'новых магазинов нет';
    const source={catalog:'Каталоги',exa:'Exa',agent:'Timeweb'}[item.method];
    entry.textContent='Раунд '+item.round+' · '+source+' · '+(item.query?'«'+item.query+'» · ':'')+
      (item.note??found)+' · сопоставимых цен '+item.confirmed+' из '+(item.target??3);
    return entry;
  }));
  const deep=state.deepResult;
  $('deep-metrics').hidden=!deep;
  $('deep-metrics-text').textContent=deep?'Сопоставимых цен до расширения: '+deep.baseline+', после: '+deep.count+
    '. На проверку: '+deep.baselineReview+' → '+deep.finalReview+'. Карточек проверено повторно: '+deep.reread+
    '. Время: '+Math.round(deep.elapsedMs/1000)+' с.'+
    (deep.verifier?' Вторая модель нашла несоответствий: '+deep.secondChecks+'.':'')+
    (state.usage?' Вызовы Timeweb: '+state.usage.agent.calls+' (поисковых раундов: '+state.usage.webRounds+').'+
      (state.usage.verifier.calls?' Вызовы второй модели: '+state.usage.verifier.calls+'.':''):''):'';
  const deepNote=deep?'Глубокий поиск: '+deep.count+' сопоставимых цен от разных продавцов.'+
    (deep.cv!=null?' Вариация '+variation(deep.cv)+'.':'')+
    (deep.reached?' Цель достигнута.':deep.count<3?' Для расчёта по трём продавцам нужно больше подтверждённых цен.':' Цель: пять цен и вариация до 20%.'):null;
  const feedback=state.error ?? deepNote ?? (state.roundHistory?.length && !result.lite && !result.preliminary && result.n<3
    ? 'Подтверждено '+result.n+' из 3 цен. Сверьте предложения или добавьте проверенное КП.'
    : '');
  $('feedback').hidden=!feedback;
  $('feedback').textContent=feedback;
  const all=result.rows;
  document.querySelectorAll('[data-filter]').forEach(button=>{
    const key=button.dataset.filter;
    button.setAttribute('aria-pressed',String(key===filter));
    button.querySelector('span').textContent=key==='all'?all.length:all.filter(r=>key==='web'?r.web:key==='analogs'?r.analog:r.state===key).length;
  });
  const visible=all.filter(r=>filter==='all'||(filter==='web'?r.web:filter==='analogs'?r.analog:r.state===filter));
  const restorable = new Set(all.filter(row=>(row.unitPrice || (result.lite && row.assumedUnitPrice)) && row.reason==='Исключено пользователем' &&
    evaluate(state.rows,state.request,{...state.overrides,[row.id]:true}).included.some(item=>item.id===row.id)).map(row=>row.id));
  const isChecked = row => row.state==='eligible' || result.reviewedIds?.has(row.id);
  const canToggle = row => isChecked(row) || restorable.has(row.id);
  const showInclude = visible.some(canToggle);
  $('offer-list').innerHTML=visible.length ? '<table><thead><tr><th scope="col">Предложение</th><th scope="col">Источник</th><th scope="col">Цена за ед.</th>'+(showInclude?'<th scope="col">Учесть</th>':'')+'</tr></thead><tbody>'+
    visible.map(row=>{
      const index=all.indexOf(row);
      const action=row.state==='review'?'Проверить предложение':'Открыть карточку';
      const preliminary=result.reviewedIds?.has(row.id) ? '<span class="row-meta">Учтено в режиме «Лайт»</span>' :
        result.preliminary?.ids.has(row.id) ? '<span class="row-meta">В предварительной оценке</span>' : '';
      const checkbox=canToggle(row)?'<input class="check" type="checkbox" aria-label="Учесть предложение '+esc(row.title)+'" data-toggle="'+index+'" '+(isChecked(row)?'checked':'')+'>':'';
      return '<tr><td><strong class="offer-title">'+esc(row.title)+'</strong><span class="row-meta">'+esc(row.reason)+'</span><button class="row-title offer-detail" type="button" data-detail="'+index+'">'+action+'</button></td><td>'+sourceLink(row)+'<span class="row-meta"><span class="status '+row.state+'">'+badges[row.state]+'</span></span>'+(row.analog?'<span class="row-meta">Кандидат в аналоги</span>':'')+preliminary+'</td><td>'+(row.unitPrice?money(row.unitPrice):row.web&&row.price?esc(sourceMoney(row))+'<span class="row-meta">Единицу уточнить</span>':money(null))+'</td>'+(showInclude?'<td>'+checkbox+'</td>':'')+'</tr>';
    }).join('')+'</tbody></table>'
    : '<div class="empty">'+(isLoading?'Источники отвечают независимо. Обычно это занимает несколько секунд.':all.length?'В этом разделе пока нет предложений.':!state.searched?'Запустите поиск или добавьте проверенное предложение.':'Открытых цен по запросу пока нет. Уточните публичное наименование или добавьте проверенное предложение.')+'</div>';
}

function syncInputs(){
  const input=requestFromForm();
  const dirty=input.description!==state.request.description || input.unit!==state.request.unit;
  $('input-note').hidden=!dirty;
  const reportAvailable=positions.some(item=>item.result?.mode==='live' && item.result.rows.length);
  $('nav-report').disabled=$('results-report').disabled=batchRunning || (!reportAvailable &&
    (state.mode==='loading'||state.rows.length===0||dirty));
}
$('description').addEventListener('input',syncInputs);
$('unit').addEventListener('change',syncInputs);

function open(id){
  const dialog=$(id);
  if(!dialog.open) dialog.showModal();
}
$('variation-help-button').addEventListener('click',()=>open('variation-help'));
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}));
function showSection(section){
  const details=section!=='purchase' && section!=='method';
  $('method').hidden=section!=='method';
  document.body.dataset.section=section;
  $('calculation-details').hidden=!details;
  $('specification').hidden=section!=='purchase';
  document.querySelector('.workflow').hidden=section!=='purchase';
  $('results-header').hidden=section!=='results';
  document.querySelectorAll('.sidebar nav a').forEach(link=>{
    const target={'#calculation':'purchase','#offers-title':'results','#method':'method'}[link.hash];
    if(target===section) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });

  if(section==='manual' && !activePosition && state) renderPositions();
  if(section==='manual' && $('spec-modes').parentElement!==$('purchase')) $('purchase').insertBefore($('spec-modes'),$('purchase').querySelector('.examples'));
}
function syncSection(){
  const sections={'#offers-title':'results','#subject-title':'manual','#method':'method'};
  showSection(sections[location.hash]??(location.hash.startsWith('#method-')?'method':'purchase'));
}
function goToSection(section,hash){
  if(batchRunning && section!=='purchase') return;
  history.replaceState(null,'',hash);
  showSection(section);
  window.scrollTo({top:0,behavior:'instant'});
}
window.addEventListener('hashchange',syncSection);
document.querySelectorAll('a[href="#offers-title"],a[href="#method"],a[href="#calculation"]').forEach(link=>{
  link.addEventListener('click',event=>{
    event.preventDefault();
    goToSection({'#offers-title':'results','#method':'method','#calculation':'purchase'}[link.hash],link.hash);
  });
});
syncSection();
$('unit').innerHTML=units.map(unit=>'<option>'+unit+'</option>').join('');
document.querySelectorAll('[name="pricing-mode"]').forEach(input=>input.addEventListener('change',()=>{
  pricingMode=input.value;
  for(const item of positions) if(item.result) item.result.request={...item.result.request,pricingMode};
  state.request={...state.request,pricingMode};
  filter='all';
  render();
}));
document.querySelectorAll('[data-example]').forEach(button=>button.addEventListener('click',()=>showExample(button.dataset.example)));
const cupDescription = /стакан/i;
let suggestionController;
let reviewedDescription;

function openSearch() {
  pending=activePosition?{...positionRequest(activePosition,pricingMode),...requestFromForm()}:requestFromForm();
  const preset=Object.values(examples).find(example=>example.description===pending.description);
  const publicTitle=pending.description.split(/[\n;.!?]/)[0].replace(/_{2,}/g,'').trim();
  $('query').value=activePosition?.query || preset?.query || publicTitle.slice(0,130);
  open('search-dialog');
  $('query').select();
}

function missingDescriptionDetails(description) {
  if(cupDescription.test(description)) {
    const missing=[];
    if(!/бумаж|пластик|картон|полипропилен/i.test(description)) missing.push('материал');
    if(!/\d+(?:[.,]\d+)?\s*(?:мл|л)(?!\p{L})/iu.test(description)) missing.push('объём');
    if(!/горяч|холод/i.test(description)) missing.push('назначение');
    if(!/(?:с|без) крышк/i.test(description)) missing.push('наличие крышки');
    return missing;
  }
  const words=description.match(/[\p{L}\d]+/gu) ?? [];
  if(words.length<4 && !/\p{L}.*\d|\d.*\p{L}/u.test(description)) return ['модель, размер или другие важные параметры'];
  return [];
}

function localDescriptionSuggestion(description) {
  if(cupDescription.test(description) && !/\d|бумаж|пластик|картон|горяч|холод|крышк/i.test(description)) {
    return 'Одноразовые стаканы, материал ___ (бумага или пластик), для горячих/холодных напитков (выберите), объём ___ мл, с крышкой/без крышки (выберите).';
  }
  return (description.replace(/[.\s]+$/,'')+'. Уточните: '+missingDescriptionDetails(description).map(detail=>detail+' ___').join(', ')+'.').slice(0,700);
}

$('purchase').addEventListener('submit',event=>{
  event.preventDefault();
  const {description}=requestFromForm();
  if(description.length<3) return $('description').focus();
  const missing=missingDescriptionDetails(description);
  if(activePosition || !missing.length || description===reviewedDescription) return openSearch();
  $('description-warning').textContent='По такому описанию поиск может вернуть разные товары. Уточните '+missing.join(', ')+'.';
  $('description-suggestion-wrap').hidden=true;
  $('description-improve').hidden=false;
  $('description-improve').disabled=false;
  $('description-apply').hidden=true;
  $('description-status').hidden=true;
  open('description-dialog');
});

$('description-dialog').addEventListener('close',()=>suggestionController?.abort());
$('description-continue').addEventListener('click',()=>{
  $('description-dialog').close();
  openSearch();
});
$('description-improve').addEventListener('click',async()=>{
  const {description}=requestFromForm();
  const controller=new AbortController();
  suggestionController=controller;
  const status=$('description-status');
  $('description-improve').disabled=true;
  status.textContent='Готовим вариант описания…';
  status.hidden=false;
  let suggestion;
  try {
    const response=await fetch('/hack-phystech/api/suggest-description',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({description}),signal:controller.signal
    });
    if(!response.ok) throw new Error('Агент недоступен');
    suggestion=(await response.json()).description;
    if(cupDescription.test(description) && missingDescriptionDetails(description).some(detail=>{
      const fields={'материал':/бумаж|бумага|пластик|материал/i,'объём':/мл|об[ъь][её]м/i,
        'назначение':/горяч|холод/i,'наличие крышки':/крышк/i};
      return !fields[detail].test(suggestion);
    })) suggestion=localDescriptionSuggestion(description);
    status.hidden=true;
  } catch {
    if(controller.signal.aborted) return;
    suggestion=localDescriptionSuggestion(description);
    status.textContent='ИИ сейчас недоступен. Можно заполнить этот шаблон.';
  }
  if(controller.signal.aborted || !$('description-dialog').open) return;
  $('description-suggestion').value=suggestion;
  $('description-suggestion-wrap').hidden=false;
  $('description-improve').hidden=true;
  $('description-apply').hidden=false;
  $('description-suggestion').focus();
});
$('description-apply').addEventListener('click',()=>{
  const text=$('description-suggestion').value.trim();
  if(text.length<3) return $('description-suggestion').focus();
  reviewedDescription=text;
  $('description').value=text;
  syncInputs();
  $('description-dialog').close();
  $('description').focus();
});
$('market-search').addEventListener('submit',async event=>{
  event.preventDefault();
  const query=$('query').value.trim();
  if(query.length<3) return $('query').focus();
  $('search-dialog').close();
  if(activePosition) {
    Object.assign(activePosition,{quantity:pending.quantity,unit:pending.unit,query});
    activePosition.editedDescription=pending.description;
  }
  await runSearch(query,pending);
});

async function runSearch(query,request){
  liveController?.abort();
  const controller=new AbortController();
  liveController=controller;
  state={request,query,mode:'loading',rows:[],overrides:{},sources:sourceNames.map(name=>({name,state:'loading'}))};
  filter='all';
  render();
  if(!batchRunning) goToSection('results','#offers-title');
  try {
    const printerAnalogQuery=request.analogQuery?'':suggestedAnalogQuery({title:query,requirements:request.description});
    const searchRequest=!request.analogQuery && /3\s*d[ -]?(?:принтер|printer)|creatbot/i.test(query+' '+request.description) && printerAnalogQuery
      ? {...request,analogs:true,analogQuery:printerAnalogQuery}
      : request;
    const response=await fetch('/hack-phystech/api/search',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({query,...searchRequest}),signal:controller.signal});
    if(!response.ok){
      const error=await response.json().catch(()=>null);
      throw new Error(error?.error ?? 'Поиск сейчас недоступен. Попробуйте ещё раз.');
    }
    const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer='', data;
    while(true){
      const {value,done}=await reader.read();
      if(done) break;
      buffer+=value;
      const lines=buffer.split('\n');
      buffer=lines.pop();
      for(const line of lines){
        if(!line) continue;
        const update=JSON.parse(line);
        if(update.source && !controller.signal.aborted){
          const i=state.sources.findIndex(source=>source.name===update.source.name);
          if(i<0) state.sources.push(update.source);
          else state.sources[i]=update.source;
          render();
        }
        if(update.round && !controller.signal.aborted){
          state.round=update.round;
          if(update.round.finished) {
            state.roundHistory=[...(state.roundHistory??[]),update.round];
            $('round-history').open=true;
          }
          render();
        }
        if(update.error) throw new Error(update.error);
        if(update.result) data=update.result;
      }
    }
    if(!data) throw new Error('Поиск прервался. Запустите его ещё раз.');
    if(controller.signal.aborted) return;
    state={...state,searched:true,mode:'live',rows:data.records,sources:data.sources,roundHistory:data.roundHistory,deepResult:data.deepResult,usage:data.usage,error:data.sources.every(s=>s.state==='unavailable')?'Каталоги не ответили. Повторите поиск позже или добавьте КП.':
      !data.deepResult && data.rounds && data.confirmed<3 ? data.sources.find(source=>source.name==='ИИ-поиск в интернете')?.note : null};
  } catch(error){
    if(controller.signal.aborted) return;
    state={...state,searched:true,mode:'live',sources:[],error:error.message==='Failed to fetch'?'Поиск сейчас недоступен. Попробуйте ещё раз.':error.message};
  }
  render();
}
$('quantity').addEventListener('change',()=>{
  const value=Number($('quantity').value);
  if(!$('quantity').validity.valid || value<=0 || state.mode==='loading') return;
  state.request={...state.request,quantity:value};
  if(activePosition) activePosition.quantity=value;
  render();
});
$('estimate-action').addEventListener('click',event=>{
  filter=event.currentTarget.dataset.target;
  render();
  $('filters').querySelector('[aria-pressed="true"]').focus({preventScroll:true});
  $('offers-title').scrollIntoView({block:'start'});
});
$('filters').addEventListener('click',event=>{
  const button=event.target.closest('[data-filter]');
  if(button){filter=button.dataset.filter;render();}
});
$('outcome').addEventListener('click',event=>{
  const help=event.target.closest('[data-status-help]');
  if(help){
    open('status-help-'+help.dataset.statusHelp);
    return;
  }
  const button=event.target.closest('[data-outcome]');
  if(button){filter=button.dataset.outcome;render();$('filters').querySelector('[aria-pressed="true"]').focus();}
});
$('offer-list').addEventListener('click',event=>{
  const button=event.target.closest('[data-detail]');
  if(button) showDetail(result.rows[Number(button.dataset.detail)]);
});
$('offer-list').addEventListener('change',event=>{
  const input=event.target.closest('[data-toggle]');
  if(!input) return;
  const row=result.rows[Number(input.dataset.toggle)];
  state.overrides[row.id]=input.checked;
  render();
});

function showDetail(row){
  detailRow=row;
  $('detail-body').innerHTML='<h3>'+esc(row.title)+'</h3>'+
    '<dl class="detail-facts"><div><dt>Цена источника</dt><dd>'+esc(sourceMoney(row))+'</dd></div><div><dt>За '+esc(state.request.unit)+'</dt><dd>'+money(row.unitPrice)+'</dd></div><div><dt>Источник</dt><dd>'+sourceLink(row)+'</dd><small>'+esc(when(row.date))+'</small></div><div><dt>Релевантность</dt><dd>'+num.format(row.score)+' / 100</dd></div><div><dt>Статус</dt><dd>'+badges[row.state]+'</dd></div></dl>'+
    '<p class="proof">'+esc(row.reason)+'</p>'+
    (row.shippingQuotes?.length?'<p><strong>Тариф доставки продавца.</strong> '+row.shippingQuotes.map(item=>esc(item.region)+' — '+money(item.amount)).join(' · ')+'<br>Уточните тариф для всего заказа.</p>':'')+
    (row.manualShipping?'<p><strong>Подтверждённая доставка.</strong> '+esc(row.manualShipping.region)+' — '+money(row.manualShipping.amount)+'</p>':'')+
    (row.sellerDelivery?'<p><strong>Срок по данным продавца.</strong> <q>'+esc(row.sellerDelivery)+'</q></p>':'')+
    (row.aiReview?'<p><strong>Проверка ИИ.</strong> '+esc(row.aiReview.reason)+
      (row.aiReview.evidence?'<br><q>'+esc(row.aiReview.evidence)+'</q>':'')+'</p>':'')+
    (row.conditions?'<p><strong>Условия.</strong> '+esc(row.conditions)+'</p>':'')+
    (row.details?'<p><strong>Из карточки.</strong> '+esc(row.details)+'</p>':'')+
    (row.checks.length?'<h4>Соответствие характеристик</h4><table class="spec-table"><thead><tr><th>Характеристика</th><th>Требуется</th><th>Найдено</th></tr></thead><tbody>'+row.checks.map(c=>'<tr><td>'+esc(c.key)+'</td><td>'+esc(c.want)+'</td><td><i class="icon '+(c.status==='match'?'ok':'alert')+'" aria-hidden="true"></i> '+esc(c.got??'Не указано')+'</td></tr>').join('')+'</tbody></table>':'')+
    (row.specEvidence?'<p><strong>Спецификация.</strong> '+sourceLink({...row.specEvidence,seller:row.specEvidence.title})+'</p>':'')+
    (row.unitPrice && row.state!=='excluded'?'<div class="dialog-actions"><button type="button" class="outline" data-edit-terms>Внести условия доставки и НДС</button></div>':'')+
    (row.web&&row.state==='review'&&!row.unitPrice?'<div class="dialog-actions"><button type="button" class="primary" data-add-web>Внести проверенное КП</button></div>':'')+
    (row.state==='review'&&row.assumedUnitPrice?'<p>Если цена у продавца указана за одну штуку и товар подходит по характеристикам, подтвердите предложение.</p>':'')+
    (row.state==='review'?'<div class="dialog-actions"><button type="button" class="outline" data-detail-choice="false">Исключить</button>'+(row.unitPrice?'<button type="button" class="primary" data-detail-choice="true">Подтверждаю сопоставимость</button>':row.assumedUnitPrice?'<button type="button" class="primary" data-confirm-unit>Подходит, цена за 1 шт.</button>':'')+'</div>':'');
  open('detail-dialog');
}
$('detail-body').addEventListener('click',event=>{
  if(event.target.closest('[data-confirm-unit]') && detailRow?.assumedUnitPrice){
    const row=state.rows.find(item=>item.id===detailRow.id);
    if(!row) return;
    row.unit='шт.';
    state.overrides[row.id]=true;
    $('detail-dialog').close();
    render();
    return;
  }
  if(event.target.closest('[data-edit-terms]') && detailRow){
    openManual(detailRow,true);
    return;
  }
  if(event.target.closest('[data-add-web]') && detailRow?.web){
    openManual(detailRow);
    return;
  }
  const button=event.target.closest('[data-detail-choice]');
  if(!button||!detailRow)return;
  state.overrides[detailRow.id]=button.dataset.detailChoice==='true';
  $('detail-dialog').close();
  render();
});
function openManual(row, termsOnly=false){
  if((state.mode==='demo' || state.mode==='idle') && !$('purchase').checkValidity()){
    goToSection('manual','#subject-title');
    $('purchase').reportValidity();
    return;
  }
  const request=state.mode==='demo' || state.mode==='idle' ? requestFromForm() : state.request;
  const form=$('manual-form');
  form.reset();
  editingOffer=termsOnly?row.id:null;
  for(const key of ['seller','title','url','price','multiplier']){
    const field=form.elements.namedItem(key);
    field.readOnly=termsOnly;
    if(row) field.value=row[key]??(key==='multiplier'?1:'');
  }
  if(row){
    form.elements.conditions.value=row.conditions??'';
    form.elements['shipping-region'].value=row.manualShipping?.region??'';
    form.elements['shipping-cost'].value=row.manualShipping?.amount??'';
    form.elements['shipping-vat'].value=row.manualShipping?.vat??row.vat??'';
  }
  const title=activePosition?.title || request.description.split('\n')[0];
  $('manual-position').textContent=title+' · '+request.quantity+' '+request.unit;
  $('manual-error').textContent='';
  $('manual-title').textContent=termsOnly?'Условия доставки и НДС':'Добавить предложение';
  form.querySelector('[type=submit]').textContent=termsOnly?'Сохранить':'Добавить';
  if(row) $('detail-dialog').close();
  open('manual-dialog');
}
$('add-offer').addEventListener('click',()=>openManual());
$('manual-form').addEventListener('submit',event=>{
  event.preventDefault();
  const fields=Object.fromEntries(new FormData(event.target));
  const url=safeLink(fields.url);
  if(!url){$('manual-error').textContent='Введите публичную ссылку, начинающуюся с https://.';return;}
  if(!editingOffer && state.rows.some(r=>r.url===url&&!r.web)){$('manual-error').textContent='Это предложение уже есть в выборке.';return;}
  if(state.mode==='demo' || state.mode==='idle') state={...emptySearch(requestFromForm()),mode:'live'};
  const price=Number(fields.price), multiplier=Number(fields.multiplier);
  const shippingRegion=fields['shipping-region'].trim();
  const shippingCost=fields['shipping-cost'];
  if(Boolean(shippingRegion)!==Boolean(shippingCost)){
    $('manual-error').textContent='Для расчёта доставки укажите и регион, и стоимость за всю позицию.';
    return;
  }
  const manualShipping=shippingRegion?{region:shippingRegion,amount:Number(shippingCost),
    quantity:state.request.quantity,vat:fields['shipping-vat']||null}:undefined;
  if(editingOffer){
    const row=state.rows.find(item=>item.id===editingOffer);
    if(!row){$('manual-error').textContent='Предложение больше не в выборке.';return;}
    Object.assign(row,{manualShipping,conditions:fields.conditions.trim()});
    $('manual-dialog').close();
    render();
    return;
  }
  const sellerDelivery=state.rows.find(row=>row.url===url)?.sellerDelivery;
  delete state.overrides[url];
  state.rows=state.rows.filter(row=>row.url!==url);
  state.rows.push({id:url,url,price,multiplier,unit:state.request.unit,currency:'RUB',manual:true,normalized:true,
    sellerDelivery,manualShipping,
    seller:fields.seller.trim(),title:fields.title.trim(),conditions:fields.conditions.trim(),date:new Date().toISOString()});
  $('manual-dialog').close();
  filter='all';
  render();
});

const reportSettingsForm=$('report-settings-form');
let reportSettings={offers:'active',details:false,sources:false};

function groupedReport(){
  return state.mode!=='demo' && positions.some(item=>item.result?.mode==='live');
}

function reportRows(calculation, selection){
  if(!calculation) return [];
  if(selection==='all') return calculation.rows;
  if(selection==='used'){
    const ids=new Set(calculation.included.map(row=>row.id));
    return calculation.rows.filter(row=>ids.has(row.id) || calculation.preliminary?.ids.has(row.id));
  }
  return calculation.rows.filter(row=>row.state!=='excluded');
}

function report(){
  if(!groupedReport()) return positionReport(state,result);
  return '<h3>Обоснование НМЦД по закупке</h3><p class="proof">'+esc(purchaseTotal())+'</p>'+
    positions.map((item,index)=>{
      const heading='<h4>'+esc((index+1)+'. '+item.title)+'</h4>';
      const terms='<p>'+esc([item.code?'ОКПД2 '+item.code:'',item.delivery].filter(Boolean).join(' · '))+'</p>'+
        (reportSettings.details && item.requirements?'<p>'+esc(item.requirements).replaceAll('\n','<br>')+'</p>':'');
      if(!item.result || item.result.mode!=='live') return heading+terms+'<p>Поиск по позиции не завершён.</p>';
      const calculation=evaluate(item.result.rows,item.result.request,item.result.overrides);
      return '<section>'+heading+terms+positionReport(item.result,calculation,false)+'</section>';
    }).join('');
}

function positionReport(state,result,showHeading=true){
  const {request,mode,query,sources}=state;
  const rows=reportRows(result,reportSettings.offers).map(row=>'<tr><td>'+esc(row.title)+'<br><small>'+esc(row.conditions??'')+'</small>'+(row.sellerDelivery?'<br><small>Срок по данным продавца: '+esc(row.sellerDelivery)+'</small>':'')+'</td><td>'+sourceLink(row)+(row.specEvidence?'<br>'+sourceLink({...row.specEvidence,seller:row.specEvidence.title}):'')+'<br>'+esc(when(row.date))+'</td><td>'+esc(sourceMoney(row))+' / '+esc(row.unit)+(row.multiplier>1?' · '+num.format(row.multiplier)+' баз. ед.':'')+'<br>'+money(row.unitPrice??((result.reviewedIds?.has(row.id) || result.preliminary?.ids.has(row.id))?row.assumedUnitPrice:null))+' за '+esc(request.unit)+'</td><td>'+badges[row.state]+'. '+esc(row.reason)+(reportSettings.details && row.checks.length?'<br>'+row.checks.map(check=>esc(check.key+' — '+(check.got??'нет данных')+' / требуется '+check.want)).join('<br>'):'')+(result.reviewedIds?.has(row.id)?' · Учтено в режиме «Лайт»':result.preliminary?.ids.has(row.id)?' · В предварительной оценке':'')+'</td></tr>').join('');
  const estimate=result.preliminary ?? result;
  const prices=result.preliminary?.prices??result.included.map(row=>row.unitPrice);
  const heading=result.lite?'Оценка · Лайт':result.preliminary?'Предварительная оценка':'Рекомендуемая НМЦД';
  const formula=estimate.total===null?(result.lite?'Подходящих цен пока нет.':'Для итогового расчёта нужны цены от трёх продавцов.'):
    heading+' '+money(estimate.total)+' за '+num.format(request.quantity)+' '+request.unit+'.';
  const guidance=estimateGuidance(result);
  const assumption=estimate.assumedCount?' Цены без указанной единицы предварительно считаются ценами за 1 шт.':'';
  return (showHeading?'<h3>Обоснование начальной максимальной цены договора</h3>':'')+
    '<p><strong>'+esc(mode==='demo'?'Учебный пример · условные цены':'Расчёт по открытым предложениям')+'</strong><br>'+esc(when(new Date().toISOString()))+'</p>'+
    '<h4>Предмет закупки</h4><p>'+esc(reportSettings.details?request.description:request.description.split('\n')[0])+'</p><p>'+num.format(request.quantity)+' '+esc(request.unit)+(query?' · Поиск «'+esc(query)+'»':'')+(request.analogQuery?' · Аналоги «'+esc(request.analogQuery)+'»':'')+'</p>'+
    '<h4>Расчёт</h4><p class="proof">'+esc(formula)+'</p><p>'+(result.lite?'Цен в оценке: ':'Продавцов в оценке: ')+estimate.n+
    '. Средняя цена за единицу: '+money(estimate.mean)+'. Коэффициент вариации: '+variation(estimate.cv)+'.</p>'+
    (prices.length?'<p>'+esc('('+prices.map(price=>num.format(price)).join(' + ')+') ÷ '+prices.length+' × '+num.format(request.quantity)+' = '+money(estimate.total))+'</p>':'')+
    (deliverySummary(request,result)?'<p>'+esc(deliverySummary(request,result))+'</p>':'')+
    (guidance||assumption?'<p>'+esc(guidance+assumption)+'</p>':'')+
    (result.lite?'<p>Режим «Лайт». Порог релевантности 40 из 100, допустимая вариация до 70%.</p>':
    '<p>Учитывается одна цена от каждого продавца. При четырёх и более ценах отсеиваются значения ниже 65% и выше 145% медианы. Итог строится при трёх и более независимых ценах и вариации до 33% включительно.</p>')+
    '<h4>Предложения</h4>'+(rows?'<table><thead><tr><th>Предложение</th><th>Источник и время</th><th>Цена</th><th>Обоснование</th></tr></thead><tbody>'+rows+'</tbody></table>':
      '<p>Нет предложений, подходящих под настройки отчёта.</p>')+
    (reportSettings.sources && sources.length?'<h4>Проверенные источники</h4><p>'+sources.map(s=>esc(s.name+' — '+(s.state==='ok'?s.count+' записей':s.note))).join(' · ')+'</p>':'')+
    '<p><small>Условия поставки, наличие, скидки и НДС следует уточнить перед использованием расчёта в закупке.</small></p>';
}
function showReport(){
  $('export-status').textContent='';
  $('report-body').innerHTML=report();
  open('report-dialog');
}
function reportSettingsFromForm(){
  const {offers,details,sources}=reportSettingsForm.elements;
  return {offers:offers.value,details:details.checked,sources:sources.checked};
}

function updateReportRowCount(){
  const {offers}=reportSettingsFromForm();
  const calculations=groupedReport()?positions.flatMap(item=>{
    const current=item.result;
    return current?.mode==='live'?[evaluate(current.rows,current.request,current.overrides)]:[];
  }):[result];
  const count=calculations.reduce((total,calculation)=>total+reportRows(calculation,offers).length,0);
  $('report-row-count').textContent='Строк предложений в отчёте: '+num.format(count);
}

function openReportSettings(){
  const {offers,details,sources}=reportSettingsForm.elements;
  offers.value=reportSettings.offers;
  details.checked=reportSettings.details;
  sources.checked=reportSettings.sources;
  updateReportRowCount();
  open('report-settings');
}

reportSettingsForm.addEventListener('change',updateReportRowCount);
reportSettingsForm.addEventListener('submit',event=>{
  event.preventDefault();
  reportSettings=reportSettingsFromForm();
  $('report-settings').close();
  if($('report-dialog').open) $('report-body').innerHTML=report();
  else showReport();
});
$('results-report').addEventListener('click',openReportSettings);
$('nav-report').addEventListener('click',openReportSettings);
$('edit-report-settings').addEventListener('click',openReportSettings);
$('print-report').addEventListener('click',()=>window.print());
$('download-report').addEventListener('click',()=>{
  const html='<!doctype html><html lang="ru"><meta charset="utf-8"><title>Обоснование НМЦД</title><style>body{font:16px/1.5 system-ui;max-width:1050px;margin:40px auto;padding:0 15px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #aaa;padding:8px;text-align:left;vertical-align:top}.proof{background:#f1e7fa;padding:12px}small{color:#555}a{color:#531e70}</style><main>'+report()+'</main></html>';
  const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;
  link.download='obosnovanie-nmcd.html';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
});
$('quantity').value=1;
state=emptySearch(requestFromForm());
render();

function blankPosition(){
  return {title:'',query:'',analogQuery:'',requirements:'',quantity:1,unit:'шт.',code:'',delivery:''};
}

function purchaseTotal(){
  const estimates=positions.map(item=>{
    if(item.result?.mode!=='live') return null;
    return evaluate(item.result.rows,item.result.request,item.result.overrides);
  });
  const ready=estimates.filter(value=>value && (value.preliminary??value).total!==null);
  if(!ready.length) return 'Цены по позициям пока не рассчитаны.';
  const total=round(ready.reduce((sum,value)=>sum+(value.preliminary??value).total,0));
  if(ready.length<positions.length) return 'Сумма по '+ready.length+' из '+positions.length+' позиций · '+money(total)+'. Для общего итога нужны цены по остальным позициям.';
  const reliable=ready.every(value=>value.reliable && !value.lite);
  return (reliable?'НМЦД по договору · ':'Предварительная оценка договора · ')+money(total);
}

function renderWorkflow(){
  const searching=batchRunning;
  const completed=positions.filter(item=>item.result?.searched).length;
  const phase=searching?'search':positions.length?(completed===positions.length?'complete':'edit'):'start';
  const step={start:0,edit:1,search:2,complete:3}[phase];
  $('specification').dataset.phase=phase;
  document.body.dataset.workspacePhase=phase;
  document.body.classList.toggle('batch-searching',batchRunning);
  const reviewing=searching && state.sources.some(source=>source.name===offerReviewSource && source.state==='loading');
  document.querySelectorAll('.workflow li').forEach((item,index)=>{
    item.toggleAttribute('data-busy',index===step && (importing || searching));
    item.toggleAttribute('data-done',index<step);
    if(index===step) item.setAttribute('aria-current','step');
    else item.removeAttribute('aria-current');
    const marker=item.firstElementChild;
    if(index<step) marker.innerHTML='<i class="icon ok" aria-hidden="true"></i>';
    else marker.textContent=index+1;
  });
  $('spec-file-name').textContent=specFileName;
  $('spec-file-name').hidden=!specFileName || phase==='start' || searching;
  $('spec-title-text').textContent={start:'Новая закупка по ТЗ',edit:'Позиции закупки',
    search:'Ищем цены и аналоги',complete:'Результаты закупки'}[phase];
  $('spec-welcome').hidden=phase!=='start';
  $('batch-hero').hidden=!searching;
  $('queue-panel').hidden=!searching;
  $('spec-actions').hidden=phase==='start';
  $('spec-feedback').hidden=searching;
  $('batch-summary').hidden=!searching;
  if(searching){
    $('batch-progress').max=positions.length;
    $('batch-progress').value=completed;
    $('batch-count').textContent=completed+' из '+positions.length+' позиций';
    $('batch-summary').textContent='Всего позиций: '+positions.length+' · Проверено: '+completed;
    const queue=$('spec-queue');
    const signature=positions.map(item=>item.result?.mode+':'+Boolean(item.result?.searched)).join('|')+reviewing;
    if(queue.dataset.signature!==signature){
      queue.dataset.signature=signature;
      queue.innerHTML=positions.map(item=>{
        const status=item.result?.mode==='loading'?'active':item.result?.searched?(item.result.rows.length?'done':'empty'):'waiting';
        const label={active:reviewing?'Проверка ИИ':'Поиск',done:'Готово',empty:'Нет цен',waiting:'В очереди'}[status];
        const sources=status==='done'?new Set(item.result.rows.map(row=>row.seller)).size:null;
        return '<li data-status="'+status+'"><strong>'+esc(item.title.split(/Производитель/i)[0].trim())+
          '</strong><span class="queue-status">'+(status==='done'?'<i class="icon ok" aria-hidden="true"></i>':'')+label+'</span><span class="queue-sources">'+
          (sources===null?'—':sources+' '+({one:'источник',few:'источника',many:'источников',other:'источников'}[sourcePlural.select(sources)]))+'</span></li>';
      }).join('');
    }
  }else{
    delete $('spec-queue').dataset.signature;
  }
  $('spec-positions').hidden=!positions.length || batchRunning;
  $('spec-run').hidden=!positions.length || batchRunning;
  $('spec-run').textContent=completed===positions.length?'Повторить поиск':completed?'Продолжить поиск':'Найти цены и аналоги';
  $('spec-stop').hidden=!batchRunning;
  $('open-spec').hidden=batchRunning;
  $('spec-add').hidden=batchRunning;
  const modes=$('spec-modes');
  const inManual=document.body.dataset.section==='manual';
  const slot=positions.length && !inManual?$('spec-mode-slot'):$('purchase');
  if(modes.parentElement!==slot){
    if(slot===$('spec-mode-slot')) slot.append(modes);
    else slot.insertBefore(modes,slot.querySelector('.examples'));
  }
  modes.hidden=batchRunning;
  const choice=$('result-position');
  const selected=positions.indexOf(activePosition);
  const options=positions.map((item,index)=>'<option value="'+index+'">'+esc(item.title || 'Позиция '+(index+1))+'</option>').join('');
  if(choice.dataset.options!==options){
    choice.innerHTML='<option value="" disabled>Выберите позицию</option>'+options;
    choice.dataset.options=options;
  }
  choice.value=selected<0?'':String(selected);
  $('result-position-label').hidden=!positions.length;
  const summary=completed?purchaseTotal():'';
  const split=summary.split(' · ');
  $('results-total').innerHTML=split.length===2?'<span>'+esc(split[0])+'</span><strong>'+esc(split[1])+'</strong>':esc(summary);
  $('result-position').disabled=batchRunning;
}

function renderPositions(){
  renderWorkflow();
  const list=$('spec-positions');
  if(!batchRunning && !importing && list.contains(document.activeElement) && document.activeElement.matches('input,select,textarea')) return;
  list.innerHTML=positions.map((item,index)=>{
    const calculation=item.result?.mode==='live'?evaluate(item.result.rows,item.result.request,item.result.overrides):null;
    const estimate=calculation?.preliminary??calculation;
    const status=item.result?.mode==='loading'?'Ищем цены…':estimate?.total!=null?
      (calculation.reliable && !calculation.lite?'':'Оценка · ')+money(estimate.total):
      item.result?.searched?'Сопоставимой цены пока нет':'Поиск ещё не запущен';
    return '<fieldset class="spec-position" data-position="'+index+'"><legend>Позиция '+(index+1)+'</legend>'+
      '<div class="position-main"><label>Наименование<input data-field="title" maxlength="200" value="'+esc(item.title)+'"></label>'+
      '<label>Количество<input data-field="quantity" type="number" min="0.001" max="1000000" step="any" value="'+esc(item.quantity)+'"></label>'+
      '<label>Ед. изм.<select data-field="unit">'+units.map(unit=>'<option'+(unit===item.unit?' selected':'')+'>'+esc(unit)+'</option>').join('')+'</select></label></div>'+
      '<details><summary>Характеристики и поисковые запросы</summary><div class="position-queries">'+
      '<label>Публичный поисковый запрос<input data-field="query" maxlength="130" value="'+esc(item.query)+'"></label>'+
      '<label>Запрос для аналогов<input data-field="analogQuery" maxlength="130" value="'+esc(item.analogQuery)+'"></label></div>'+
      '<label>Характеристики<textarea rows="4" data-field="requirements">'+esc(item.requirements)+'</textarea></label>'+
      '<div class="position-queries"><label>Срок поставки<input data-field="delivery" value="'+esc(item.delivery)+'"></label>'+
      '<label>ОКПД2<input data-field="code" value="'+esc(item.code)+'"></label></div></details>'+
      '<div class="spec-actions"><span data-position-status>'+status+'</span><button type="button" class="outline small" data-position-action="open">Открыть позицию</button>'+
      '<button type="button" class="outline small" data-position-action="remove">Удалить</button></div></fieldset>';
  }).join('');
  for(const field of list.querySelectorAll('fieldset')) field.disabled=batchRunning;
  $('spec-add').disabled=batchRunning || importing || positions.length>=30;
  $('open-spec').disabled=batchRunning || importing;
  $('spec-file').disabled=batchRunning || importing;
  $('spec-run').disabled=batchRunning || importing || !positions.length;
  $('spec-total').textContent=positions.length && !batchRunning?purchaseTotal():'';
}

$('result-position').addEventListener('change',event=>{
  if(event.target.value!=='') openPosition(positions[Number(event.target.value)]);
});

function openPosition(item){
  activePosition=item;
  const request=positionRequest(item,pricingMode);
  state=item.result??{request,query:item.query,mode:'live',rows:[],sources:[],overrides:{}};
  state.request={...state.request,pricingMode};
  $('description').value=state.request.description;
  $('quantity').value=state.request.quantity;
  $('unit').value=state.request.unit;
  filter='all';
  render();
}

const picker=$('spec-picker');
$('open-spec').addEventListener('click',()=>{
  $('spec-import-message').textContent='';
  $('import-slot').append(picker);
  open('spec-import');
});
$('spec-import').addEventListener('close',()=>$('intake-slot').append(picker));
$('go-manual').addEventListener('click',()=>{
  if($('spec-import').open) $('spec-import').close();
  if(activePosition){
    liveController?.abort();
    activePosition=null;
    state=manualState??emptySearch({description:'',quantity:1,unit:units[0],pricingMode});
    $('description').value=state.request.description;
    $('quantity').value=state.request.quantity;
    $('unit').value=state.request.unit;
    filter='all';
    render();
  }
  goToSection('manual','#subject-title');
  requestAnimationFrame(()=>$('description').focus());
});
$('spec-file').addEventListener('change',event=>importSpecification(event.target.files[0]));
const dropZone=$('spec-drop');
dropZone.addEventListener('dragover',event=>{
  event.preventDefault();
  if(!importing) dropZone.classList.add('dragging');
});
dropZone.addEventListener('dragleave',event=>{
  if(!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('dragging');
});
dropZone.addEventListener('drop',event=>{
  event.preventDefault();
  dropZone.classList.remove('dragging');
  importSpecification(event.dataTransfer.files[0]);
});

async function importSpecification(file){
  if(!file || batchRunning || importing) return;
  importing=true;
  $('spec-import-message').dataset.state='busy';
  $('spec-import-message').textContent='Извлекаем позиции…';
  renderPositions();
  try{
    if(!/\.(docx|pdf)$/i.test(file.name) || file.size>5*1024*1024) throw new Error('Выберите DOCX или PDF размером до 5 МБ.');
    const parsed=/\.pdf$/i.test(file.name)?await parsePdfSpecification(file,units):await importWord(file);
    liveController?.abort();
    specFileName=file.name;
    positions=parsed.map(item=>({...item,analogQuery:suggestedAnalogQuery(item),query:item.title.split(/Производитель/i)[0].trim().slice(0,130)}));
    openPosition(positions[0]);
    $('spec-feedback').textContent='Позиций в ТЗ: '+positions.length+'. '+(/\.pdf$/i.test(file.name)?
      'Сверьте названия и количество с PDF. Добавьте существенные характеристики из документа перед поиском.':
      'Проверьте характеристики, количество и публичные запросы.');
    $('spec-import').close();
  }catch(error){
    $('spec-import-message').dataset.state='error';
    $('spec-import-message').textContent=error.name==='PasswordException'?'Снимите пароль с PDF или выберите другой документ.':error.message;
  }finally{
    importing=false;
    $('spec-file').value='';
    renderPositions();
  }
}

async function importWord(file){
  if(!zipLibrary) zipLibrary=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='/hack-phystech/jszip.js';
    script.onload=()=>resolve(window.JSZip);
    script.onerror=()=>{zipLibrary=null;script.remove();reject(new Error('Не удалось открыть DOCX. Попробуйте ещё раз.'));};
    document.head.append(script);
  });
  const JSZip=await zipLibrary;
  const zip=await JSZip.loadAsync(await file.arrayBuffer());
  const xmlFile=zip.file('word/document.xml');
  if(!xmlFile) throw new Error('В файле нет документа Word.');
  const xml=await new Promise((resolve,reject)=>{
    let text='';
    const stream=xmlFile.internalStream('string');
    stream.on('data',chunk=>{
      text+=chunk;
      if(text.length>4000000){
        stream.pause();
        reject(new Error('Таблицы документа слишком велики.'));
      }
    }).on('error',reject).on('end',()=>resolve(text)).resume();
  });
  return parseSpecification(xml,units);
}

$('spec-add').addEventListener('click',()=>{
  positions.push(blankPosition());
  renderPositions();
  $('spec-positions').lastElementChild.querySelector('[data-field="title"]').focus();
});
$('spec-positions').addEventListener('change',event=>{
  const field=event.target.dataset.field;
  if(!field) return;
  const item=positions[Number(event.target.closest('[data-position]').dataset.position)];
  item[field]=field==='quantity'?Number(event.target.value):event.target.value.trim();
  if(field==='title' && !item.query){
    item.query=item.title.slice(0,130);
    event.target.closest('[data-position]').querySelector('[data-field=query]').value=item.query;
  }
  delete item.result;
  if(field==='title' || field==='requirements') delete item.editedDescription;
  if(activePosition===item){
    liveController?.abort();
    state={request:positionRequest(item,pricingMode),mode:'live',query:item.query,rows:[],sources:[],overrides:{}};
    $('description').value=state.request.description;
    $('quantity').value=state.request.quantity;
    $('unit').value=state.request.unit;
    render();
  }
  event.target.closest('[data-position]').querySelector('[data-position-status]').textContent='Поиск ещё не запущен';
  $('spec-total').textContent=purchaseTotal();
  syncInputs();
});
$('spec-positions').addEventListener('click',event=>{
  const button=event.target.closest('[data-position-action]');
  if(!button || batchRunning) return;
  const index=Number(button.closest('[data-position]').dataset.position);
  liveController?.abort();
  if(button.dataset.positionAction==='open') {
    const item=positions[index];
    if(!item.title || !item.quantity) return;
    openPosition(item);
    goToSection(item.result?.searched?'results':'manual',item.result?.searched?'#offers-title':'#subject-title');
    renderPositions();
    return;
  }
  if(activePosition===positions[index]){
    activePosition=null;
    state={...state,mode:'live',rows:[],sources:[],overrides:{},roundHistory:[],error:null};
  }
  positions.splice(index,1);
  if(!positions.length) $('spec-feedback').textContent='';
  render();
});
$('spec-run').addEventListener('click',async()=>{
  const invalid=positions.find(item=>item.title.length<3 || item.query.length<3 || !Number.isFinite(item.quantity) ||
    item.quantity<.001 || item.quantity>1000000 || /https?:|@|\+\d[\d ()-]{9,}/i.test(item.query+' '+item.analogQuery));
  if(invalid){
    $('spec-feedback').textContent='Проверьте название, публичный запрос и количество во всех позициях.';
    return;
  }
  const repeat=positions.every(item=>item.result?.searched);
  batchStopped=false;
  batchRunning=true;
  window.scrollTo({top:0,behavior:'instant'});
  if(repeat) positions.forEach(item=>delete item.result);
  try{
    for(const [index,item] of positions.entries()){
      if(item.result?.searched) continue;
      $('spec-message').textContent='Ищем цены для позиции '+(index+1)+' из '+positions.length+'.';
      openPosition(item);
      await runSearch(item.query,{...positionRequest(item,pricingMode),deepSearch:$('deep-search').checked});
      if(batchStopped){
        delete item.result;
        openPosition(item);
        break;
      }
    }
    $('spec-feedback').textContent=batchStopped?'Поиск остановлен. Готовые результаты сохранены.':
      'Поиск завершён. Откройте позицию, чтобы проверить предложения.';
  } finally{
    batchRunning=false;
    render();
    if(!batchStopped) goToSection('results','#offers-title');
  }
});
$('spec-stop').addEventListener('click',()=>{
  batchStopped=true;
  liveController?.abort();
});

const onboardingSteps = [
  {
    title: 'Начните с технического задания',
    description: 'Загрузите DOCX или PDF с текстом. Сервис извлечёт позиции, единицы и количество. Проверьте их перед поиском цен и аналогов.',
    tip: 'Позиции можно добавить вручную или запустить отдельный поиск в форме ниже.'
  },
  {
    title: 'Выберите поиск и расчёт',
    description: 'Глубокий поиск можно включить в любом режиме расчёта.',
    art: 'onboarding-search.webp',
    modes: [
      ['Строгий', 'Рекомендуемая НМЦД по сопоставимым ценам от трёх продавцов при вариации до 33%.'],
      ['Лайт', 'Оценка рынка. Может учитывать цены, которые ещё требуют проверки.'],
      ['Глубокий поиск', 'Пробует синонимы и ищет по характеристикам. Цель — пять цен с вариацией до 20%.']
    ]
  },
  {
    title: 'Проверьте предложения',
    description: 'Откройте карточку со статусом «На проверку» и сверьте товар с описанием закупки по ссылке продавца. Если характеристики совпадают, подтвердите сопоставимость.',
    tip: 'Если у продавца указана цена за единицу, внесите её через «Внести проверенное КП».'
  },
  {
    title: 'Получите НМЦД и отчёт',
    description: 'Рекомендуемая начальная максимальная цена договора появится, когда есть цены от трёх разных продавцов и разброс не превышает 33%.',
    tip: 'В обосновании будут ссылки и формула расчёта. Его можно распечатать в PDF или выгрузить в XLSX.'
  }
];
const onboarding = $('onboarding');
const onboardingSegments=onboarding.querySelector('.onboarding-segments');
onboardingSegments.replaceChildren(...onboardingSteps.map(()=>document.createElement('span')));
const onboardingKey = 'price-lab-onboarding-seen';
let onboardingIndex = 0;
let startPurchaseAfterTour = false;

function renderOnboarding(index) {
  onboardingIndex = index;
  const step = onboardingSteps[index];
  const last = index === onboardingSteps.length - 1;
  $('onboarding-title').textContent = step.title;
  $('onboarding-description').textContent = step.description;
  $('onboarding-tip').textContent = step.tip??'';
  $('onboarding-tip').hidden = !step.tip;
  $('onboarding-modes').hidden = !step.modes;
  $('onboarding-modes').innerHTML = (step.modes??[]).map(([label,detail])=>'<li><strong>'+esc(label)+'</strong> — '+esc(detail)+'</li>').join('');
  onboarding.classList.toggle('onboarding-search-step',Boolean(step.modes));
  $('onboarding-step').textContent = 'Шаг ' + (index + 1) + ' из ' + onboardingSteps.length;
  $('onboarding-art').src = '/hack-phystech/assets/' + (step.art??['pastel-folder.webp',null,'pastel-quotes.webp','pastel-report.webp'][index]);
  $('onboarding-back').hidden = index === 0;
  $('onboarding-skip').hidden = index !== 0;
  $('onboarding-next').textContent = last ? 'К подбору цен' : 'Далее';
  onboarding.querySelectorAll('.onboarding-segments span').forEach((segment, i) => {
    segment.classList.toggle('filled', i <= index);
  });
}

function openOnboarding() {
  renderOnboarding(0);
  open('onboarding');
  $('onboarding-title').focus({preventScroll:true});
}
function moveOnboarding(index) {
  renderOnboarding(index);
  $('onboarding-title').focus({preventScroll:true});
}
$('open-onboarding').addEventListener('click', openOnboarding);
$('onboarding-back').addEventListener('click', () => moveOnboarding(onboardingIndex - 1));
$('onboarding-next').addEventListener('click', () => {
  if(onboardingIndex < onboardingSteps.length - 1) {
    moveOnboarding(onboardingIndex + 1);
    return;
  }
  startPurchaseAfterTour = true;
  onboarding.close();
});
onboarding.addEventListener('close', () => {
  try { localStorage.setItem(onboardingKey, '1'); } catch {}
  if(startPurchaseAfterTour) {
    ($('spec-welcome').hidden?$('open-spec'):$('spec-file')).focus();
    startPurchaseAfterTour = false;
  }
});

let seenOnboarding = false;
try { seenOnboarding = localStorage.getItem(onboardingKey) === '1'; } catch {}
if(!seenOnboarding) openOnboarding();

let workbookLibrary;
function loadWorkbook(){
  if(!workbookLibrary) workbookLibrary=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='/hack-phystech/exceljs.js';
    script.onload=()=>resolve(window.ExcelJS);
    script.onerror=()=>{workbookLibrary=null;script.remove();reject(new Error('Не загрузился модуль экспорта'));};
    document.head.append(script);
  });
  return workbookLibrary;
}

$('download-xlsx').addEventListener('click',async event=>{
  const button=event.currentTarget;
  const settings=reportSettings;
  const entries=groupedReport()?positions.map(item=>{
    const current=item.result;
    return {title:item.title,code:item.code,delivery:item.delivery,requirements:item.requirements,
      request:current?.request??positionRequest(item,pricingMode),mode:current?.mode,sources:current?.sources,
      calculation:current?.mode==='live'?evaluate(current.rows,current.request,current.overrides):null};
  }) : [{title:state.request.description.split('\n')[0],request:state.request,mode:state.mode,calculation:result,sources:state.sources}];
  const contractSummary=entries.length>1?purchaseTotal():'';
  button.disabled=true;
  $('export-status').textContent='Готовим таблицу…';
  try{
    const ExcelJS=await loadWorkbook();
    const workbook=new ExcelJS.Workbook();
    const sheet=workbook.addWorksheet('Предложения');
    sheet.columns=[
      {header:'Позиция',key:'position',width:26},{header:'Предложение',key:'title',width:46},
      {header:'Продавец',key:'seller',width:22},{header:'Ссылка',key:'url',width:34},
      {header:'Получено (МСК)',key:'date',width:23},{header:'Цена источника',key:'price',width:20},
      {header:'Цена за единицу, ₽',key:'unitPrice',width:22},{header:'Статус',key:'status',width:18},
      {header:'Причина',key:'reason',width:42},
      ...(settings.details?[{header:'Характеристики',key:'specs',width:52}]:[])
    ];
    const summary=workbook.addWorksheet('Расчёт');
    summary.columns=[
      {header:'Позиция',width:44},{header:'Количество',width:14},{header:'Единица',width:14},
      {header:'ОКПД2',width:17},{header:'Цен в оценке',width:16},{header:'Средняя, ₽',width:16},
      {header:'Вариация, %',width:16},{header:'НМЦД, ₽',width:18},{header:'Предварительно, ₽',width:21},
      {header:'Условия и пояснения',width:58},...(settings.details?[{header:'Требования ТЗ',width:58}]:[])
    ];
    const sourcesTab=settings.sources?workbook.addWorksheet('Источники'):null;
    if(sourcesTab) sourcesTab.columns=[
      {header:'Позиция',width:44},{header:'Источник',width:36},{header:'Результат проверки',width:54}
    ];
    for(const entry of entries){
      const {request,mode,calculation}=entry;
      const estimate=calculation?.preliminary??calculation;
      const finalPrice=calculation?.reliable && !calculation.lite && mode!=='demo'?calculation.total:null;
      summary.addRow([entry.title,request.quantity,request.unit,entry.code,estimate?.n,estimate?.mean,
        estimate?.cv,finalPrice,finalPrice===null?estimate?.total:null,
        [entry.delivery,mode==='demo'?'Учебные данные':'',calculation?estimateGuidance(calculation):'Поиск не завершён',calculation?deliverySummary(request,calculation):''].filter(Boolean).join(' · '),...(settings.details?[entry.requirements]:[])]);
      if(sourcesTab) for(const source of entry.sources??[]){
        sourcesTab.addRow([entry.title,source.name,source.state==='ok'?source.count+' записей':source.note]);
      }
      for(const row of reportRows(calculation,settings.offers)){
        const url=safeLink(row.url);
        const used=calculation.included.some(item=>item.id===row.id) || calculation.preliminary?.ids.has(row.id);
        sheet.addRow({position:entry.title,title:row.title,seller:row.seller,url:url?{text:row.seller,hyperlink:url}:null,
          date:when(row.date),price:sourceMoney(row)+(row.unit?' / '+row.unit:''),
          unitPrice:row.unitPrice??(used?row.assumedUnitPrice:null),status:badges[row.state],
          reason:row.reason+(row.sellerDelivery?' · Срок по данным продавца: '+row.sellerDelivery:'')+(used?' · Учтено в оценке':'')+(row.analog?' · Кандидат в аналоги':''),
          specs:settings.details?row.checks.map(check=>check.key+' — '+(check.got??'нет данных')+' / требуется '+check.want).join(', '):undefined});
      }
    }
    if(contractSummary) summary.addRow([contractSummary]);
    sheet.autoFilter={from:'A1',to:settings.details?'J1':'I1'};
    for(const tab of [sheet,summary,...(sourcesTab?[sourcesTab]:[])]){
      tab.views=[{state:'frozen',ySplit:1}];
      tab.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
      tab.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF63334F'}};
      tab.eachRow({includeEmpty:false},row=>{row.alignment={vertical:'top',wrapText:true};});
    }
    sheet.getColumn('unitPrice').numFmt='#,##0.00';
    const output=await workbook.xlsx.writeBuffer();
    const url=URL.createObjectURL(new Blob([output],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    const link=document.createElement('a');
    link.href=url;
    link.download='nmcd.xlsx';
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),3000);
    $('export-status').textContent='Таблица готова';
  }catch{
    $('export-status').textContent='Не удалось скачать XLSX. Повторите попытку.';
  }finally{
    button.disabled=false;
  }
});
