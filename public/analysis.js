export const units = ['шт.', 'пачка', 'кг', 'л', 'м', 'м²', 'час', 'услуга'];
export const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
export const plain = value => String(value ?? '').toLowerCase().replaceAll('ё','е').replace(/[aа]4/gi,'а4').replace(/(?<!s[aа]t)[aа]3/gi,'а3').replace(/\s+/g,' ').trim();

const characteristics = [
  ['Формат', /(?<![\p{L}\d])([аa][345])(?![\p{L}\d])/giu, ''],
  ['Листов в пачке', /(\d+)\s*(?:лист(?:ов|а)?|л\.?(?![\p{L}]))(?=\s|[,.)/]|$)/giu, ' лист.'],
  ['Плотность', /(\d+)(?:\s*±\s*\d+)?\s*(?:г|гр)\s*\/\s*(?:кв\.?\s*м|м(?:2|²))/giu, ' г/м²'],
  ['Оперативная память', /(?:озу|ram|оперативн\p{L}* памят\p{L}*)\s*[:—-]?\s*(?:от\s*|не менее\s*)?(\d+)\s*(?:гб|gb)/giu, ' ГБ'],
  ['Накопитель', /(?:ssd|накопител\p{L}*)\s*[:—-]?\s*(?:от\s*|не менее\s*)?(\d+)\s*(?:гб|gb)/giu, ' ГБ'],
  ['Диагональ', /(\d+(?:[.,]\d+)?)\s*(?:дюйм\p{L}*|["″])/giu, '″'],
  ['Объём', /(\d+(?:[.,]\d+)?)\s*(?:мл|ml)(?!\p{L})/giu, ' мл'],
  ['Размер', /(?:размер|size)\s*[:—-]?\s*([smlx]{1,3}|\d{1,3})(?!\p{L})/giu, ''],
];

const cupName = /стакан\p{L}*/iu;
const hotCup = /горяч|д\s*\/\s*(?:хол\.?\s*\/\s*)?гор\b|д\s*\/\s*гор(?=\s|[.,]|$)/iu;
export const ssdProductName = /^(?!.*(?:ноутбук|сервер|моноблок|компьютер|внешн|корпус|адаптер))(?=.*\bssd\b)/iu;
export const mouseName = /мыш(?:ь|и|ей|ью|ка|ки|ек|ку)(?!\p{L})/iu;
const monitorName = /монитор\p{L}*/iu;
const switchName = /коммутатор|свитч|(?:^|\W)switch(?:\W|$)/iu;
const printerName = /3\s*[-‑–]?\s*d\s*[-‑–]?\s*(?:принтер|printer)|\bcreatbot\b/iu;
export function printerModelKey(text) {
  const match=plain(text).match(/\b([a-z]{1,8}[- ]?\d{2,4}[a-z]?)(?:\s*[- ]?\s*(pro|max|plus|ultra))?(?:\s*([2-9]))?(?:\s*(hs))?\b/iu);
  return match ? match.slice(1).filter(Boolean).join('').replace(/[ -]/g,'') : '';
}

export function reviewContradictsSpecs(review, facts) {
  if(!review) return false;
  const reason=plain(review.reason);
  const missing=/(?:нет|не\s+(?:указан\p{L}*|найден\p{L}*|приведен\p{L}*|подтвержден\p{L}*)|отсутств\p{L}*|неизвест\p{L}*|неяс\p{L}*)/u;
  if(!missing.test(reason)) return false;
  const fields=[
    [/материал|бумажн|пластик/u,key=>key==='Материал стакана'],
    [/об[ъь]ем|емкост|вместимост|литраж/u,key=>/Объём/.test(key)],
    [/плотност/u,key=>key==='Плотность'],
    [/формат бумаги/u,key=>key==='Формат'],
    [/количество листов|листов в пачке/u,key=>key==='Листов в пачке']
  ];
  return fields.some(([mentioned,matches])=>reason.split(/[.,;!?\n]|\s+(?:но|однако)\s+/u)
    .some(clause=>missing.test(clause) && mentioned.test(clause)) &&
    Object.entries(facts).some(([key,value])=>value && matches(key)));
}


export function specs(text) {
  const clean = plain(text);
  const result = Object.fromEntries(characteristics.flatMap(([key, pattern, suffix]) => {
    const value = [...clean.matchAll(pattern)][0]?.[1];
    return value ? [[key, value.replace(',','.') + suffix]] : [];
  }));
  if (printerName.test(clean)) {
    const technology=clean.match(/(?<![a-z])(fdm|fff|sla|sls|msla)(?![a-z])/i)?.[1];
    if(technology) result['Технология печати']=technology==='fff'?'FDM':technology.toUpperCase();
    const volume=clean.match(/область[^:]{0,30}мм\s*:\s*(\d{2,4})\s*[xх×]\s*(\d{2,4})\s*[xх×]\s*(\d{2,4})/u) ?? clean.match(/(\d{2,4})\s*[xх×]\s*(\d{2,4})\s*[xх×]\s*(\d{2,4})\s*мм/u);
    if(volume) result['Объём печати']=volume.slice(1).join('×')+' мм';
    const temperature=clean.match(/(?:нагрев|температур\p{L}*)(?:\s+нагрева)?\s+(?:экструдер|хотенд|сопл)\p{L}*\s*(?:до)?\s*[:—-]?\s*(\d{2,3})/u)?.[1];
    if(temperature) result['Нагрев экструдера']=temperature+' °C';
  }
  const cytokine=clean.match(/(?:rh\s*)?il[ -]?(2|7|15|21)(?!\d)|интерлейкин[ -]?(2|7|15|21)(?!\d)|tgf[ -]?(?:beta|β|b|бета)[ -]?1/i);
  if(cytokine){
    result['Белок']=cytokine[1] || cytokine[2] ? 'IL-'+(cytokine[1]??cytokine[2]) : 'TGFβ1';
    if(/человек|human/i.test(clean)) result['Вид белка']='Человек';
    else if(/мыши|mouse|murine/i.test(clean)) result['Вид белка']='Мышь';
    const mass=clean.match(/(\d+(?:[.,]\d+)?)\s*(?:мкг|µg|μg|ug)(?![\p{L}\d/])/u)?.[1];
    if(mass) result['Масса белка']=mass.replace(',','.')+' мкг';
    if(/\bcho\b/i.test(clean)) result['Клеточная линия']='CHO';
    else if(/(?:e\.?\s*coli|escherichia coli)/i.test(clean)) result['Клеточная линия']='E. coli';
    const purity=clean.match(/чистот\p{L}*[^\d]{0,60}(\d+(?:[.,]\d+)?)\s*%/iu)?.[1];
    if(purity) result['Чистота белка']=purity.replace(',','.')+'%';
    const endotoxin=clean.match(/эндотоксин\p{L}*[^\d]{0,45}(\d+(?:[.,]\d+)?)\s*(?:eu|еу)/iu)?.[1];
    if(endotoxin) result['Эндотоксин']=endotoxin.replace(',','.')+' EU/мкг';
  }
  if(/бумаг/u.test(clean)){
    const sheets=clean.match(/(?:количество листов|листов в пачке)[^\d]{0,40}(\d{2,5})/u)?.[1];
    if(sheets) result['Листов в пачке']=sheets+' лист.';
    const thickness=clean.match(/толщин\p{L}*\s*[:—-]?\s*(\d+(?:[.,]\d+)?)\s*мкм/u)?.[1];
    if(thickness) result['Толщина бумаги']=thickness.replace(',','.')+' мкм';
    const grade=clean.match(/(?:марка бумаги|марка|класс)\s*[:—-]?\s*([abcабс])(?!\p{L})/u)?.[1];
    if(grade) result['Класс бумаги']=grade.replace('с','c').replace('а','a').replace('б','b').toUpperCase();
    const whiteness=clean.match(/(?:белизна\s*(?:cie)?\s*[:—-]?\s*(\d{2,3})\s*(?:%\s*)?cie|белизна\s*cie\s*[:—-]?\s*(\d{2,3}))/u);
    if(whiteness) result['Белизна CIE']=whiteness[1]??whiteness[2];
    const standard=clean.match(/гост\s*[рp]\s*(\d{5})[-– ](\d{4})/u);
    if(standard) result['ГОСТ бумаги']=standard[1]+'-'+standard[2];

    if(/офсет/u.test(clean)) result['Вид бумаги']='Офсетная';
    else if(/офисн|svetocopy|светокоп/u.test(clean)) result['Вид бумаги']='Офисная';
  }
  if (mouseName.test(clean)) {
    if(/беспровод|wireless|bluetooth/iu.test(clean)) result['Подключение мыши']='Беспроводное';
    else if(/проводн|\bwired\b/iu.test(clean)) result['Подключение мыши']='Проводное';
    if(/оптич|\boptical\b/iu.test(clean)) result['Сенсор мыши']='Оптический';
    else if(/лазер|\blaser\b/iu.test(clean)) result['Сенсор мыши']='Лазерный';
    if(/usb\s*[-‑–]?\s*[cс](?![\p{L}\d])/iu.test(clean)) result['Разъём мыши']='USB-C';
    else if(/usb\s*[-‑–]?\s*[aа](?![\p{L}\d])/iu.test(clean)) result['Разъём мыши']='USB-A';
    else if(/\busb\b/iu.test(clean)) result['Разъём мыши']='USB';
    const buttons=clean.match(/(?:количество\s+)?кноп(?:ок|ки)\s*(?:мыши\s*)?[:—-]?\s*(\d+)/iu)?.[1]
      ?? clean.match(/(\d+|три)\s*кноп(?:ки|ок)/iu)?.[1];
    if(buttons) result['Кнопки мыши']=buttons==='три'?'3':buttons;
  }
  if (ssdProductName.test(clean)) {
    const capacity=clean.match(/(?<![\d.,])(\d+)\s*(?:гб|gb)(?!\p{L})/iu)?.[1];
    if(capacity) result['Накопитель']=capacity+' ГБ';
    if(/m[. -]?2(?!\d)/iu.test(clean)) result['Форм-фактор SSD']='M.2';
    else if(/(?<![\d.,])2[.,]5\s*(?:["″]|дюйм\p{L}*)|\b2[.,]5(?=\s|$)/iu.test(clean)) {
      result['Форм-фактор SSD']='2.5″';
      delete result['Диагональ'];
    }
    if(/\bnvme\b|\bpcie\b/iu.test(clean)) result['Интерфейс SSD']='NVMe / PCIe';
    else if(/\bsata(?:\s*(?:iii|3(?:[.,]0)?))?(?![a-z])/iu.test(clean)) {
      result['Интерфейс SSD']=/\bsata\s*(?:iii|3(?:[.,]0)?)/iu.test(clean)?'SATA III':'SATA';
    }
  }
  if (monitorName.test(clean)) {
    const diagonal = clean.match(/(\d+(?:[.,]\d+)?)\s*(?:дюйм\p{L}*|["″])/iu)?.[1];
    if(diagonal) result['Диагональ']=Number(diagonal.replace(',','.'))+'″';
    const matrix=clean.match(/\b(ips|tn|va|oled)\b/i)?.[1];
    if(matrix) result['Матрица']=matrix.toUpperCase();
    const resolution=clean.match(/(\d{3,4})\s*[xх×]\s*(\d{3,4})/iu);
    if(resolution) result['Разрешение']=resolution[1]+'×'+resolution[2];
    else if(/\bfull\s*hd\b|\bfhd\b/iu.test(clean)) result['Разрешение']='1920×1080';
    if(/\bhdmi\b/iu.test(clean)) result['HDMI']=/без\s+hdmi|hdmi\s*[:—-]?\s*нет/iu.test(clean)?'Нет':'Есть';
  }
  if (cupName.test(clean)) {
    const nominal=clean.match(/(\d+)\s*(?:[-–/]\s*\d+\s*)?мл(?!\p{L})/iu)?.[1];
    if(nominal) result['Объём']=nominal+' мл';
    if(/бумаж|картон/u.test(clean)) result['Материал стакана']='Бумага';
    else if(/пластик|полипропилен/u.test(clean)) result['Материал стакана']='Пластик';
    if(/только для холод|не для горяч/u.test(clean)) result['Для горячих напитков']='Нет';
    else if(hotCup.test(clean)) result['Для горячих напитков']='Да';
  }
  if (switchName.test(clean)) {
    const ports = clean.match(/(?:кол(?:ичество|[.-]?\s*во)\s+(?:основных\s+)?портов[^\d]{0,25}(?:\(\s*1\s*гбит\/с\)\s*[:—-]?\s*)?|кол-во\s+портов:\s*)(\d+)(?![\d/])/u)?.[1]
      ?? clean.match(/(\d+)\s*(?:[-–]\s*)?(?:порт(?:ов(?:ый|ых)?|а|овый)?(?!\p{L})|(?:[xх×]\s*)?rj[- ]?45|[xх×]\s*\d+\s*(?:гбит|мбит))/iu)?.[1]
      ?? clean.match(/(\d+)\s*[xх×]\s*(?:ethernet|10[/-]100)/iu)?.[1];
    if(ports) result['Количество портов']=ports;
    const speeds=[...clean.replace(/пропускная способность\s*[:—-]?\s*\d+(?:[.,]\d+)?\s*гбит(?:\/с)?/gu,'').matchAll(/(\d+(?:[.,]\d+)?)\s*(гбит|мбит|gbps|mbps)/giu)].map(m=>Number(m[1].replace(',','.'))*(/гбит|gbps/i.test(m[2])?1000:1));
    if(/10\s*[/-]\s*100\s*[/-]\s*1000|гигабитн|gigabit/u.test(clean)) speeds.push(1000);
    if(speeds.length) result['Скорость порта']=Math.max(...speeds)+' Мбит/с';
    if(/rj[- ]?45/u.test(clean)) result['Разъём']='RJ-45';
    if(/неуправляем|unmanaged/u.test(clean)) result['Управление']='Неуправляемый';
    else if(/управляем|managed/u.test(clean)) result['Управление']='Управляемый';
    if(/без\s+poe|poe\s*(?:[:—-]\s*)?(?:нет|не поддерж|отсутств)|poe\s*[,\s]*шт\.?\s*нет/u.test(clean)) result.PoE='Нет';
    else if(/(?:^|\s)с\s+(?:поддержкой\s+)?poe|poe\s*[:—-]?\s*(?:да|есть|поддерживается)|\d+\s+порт\p{L}*\s+poe/u.test(clean)) result.PoE='Да';
    if(/без\s+(?:блока|адаптера)\s+питания|(?:блок|адаптер)\s+питания\s+не\s+входит/u.test(clean)) result['Блок питания в комплекте']='Нет';
    else if(/(?:блок(?:ом)?|адаптер(?:ом)?)\s+питания\s+(?:в\s+комплекте|входит)|комплект\p{L}*\s*[:—-]?\s*[^.;]{0,70}(?:блок|адаптер)\s+питания/u.test(clean)) result['Блок питания в комплекте']='Да';
  }
  return result;
}

const ignored = new Set(['купить','цена','поставка','для','под','без','или','закупка','необходимо','менее','штук','листов','комплект','россия','россии']);
const words = text => [...new Set(plain(text).match(/[\p{L}\d][\p{L}\d-]+/gu) ?? [])]
  .filter(word => !ignored.has(word) && !/^\d+$/.test(word));
const stem = word => word.length > 5 ? word.slice(0, -2) : word;
const median = values => {
  const s = [...values].sort((a,b) => a-b);
  return (s[Math.floor((s.length-1)/2)] + s[Math.floor(s.length/2)]) / 2;
};

export function evaluate(rows, request, overrides = {}) {
  const lite = request.pricingMode === 'lite';
  const required = specs(request.description);
  const keywords = words(request.description.split(/[\n;:.]/)[0]).slice(0, 10);
  const isSwitch = switchName.test(plain(request.description));
  const isCup = cupName.test(request.description);
  const isPrinter = printerName.test(request.description);
  const requestedPrinterModel = isPrinter && printerModelKey(request.description.split(/[\n;.]/)[0]);
  const isPaper = !isCup && /бумаг/iu.test(request.description) &&
    ['Формат','Листов в пачке'].some(key=>required[key]);
  const isMouse = mouseName.test(request.description);
  const isMonitor = monitorName.test(request.description);
  const isSSD = ssdProductName.test(request.description);
  const subject = keywords.find(word => !/\d/.test(word));
  const paperBrand = plain(request.description).match(/svetocopy|светокоп|ballet|снегурочка|cartblank|projecta/iu)?.[0];
  const seen = new Set();
  const sorted = rows.map(row => {
    const sellerSpecs=specs(row.title+' '+(row.details??''));
    const sourceSpecs={...specs(row.specEvidence?.details),...sellerSpecs};
    const secondaryKey=row.secondaryReview?.key;
    const secondaryUsed=secondaryKey && !sourceSpecs[secondaryKey];
    if(secondaryUsed) sourceSpecs[secondaryKey]=specs(row.title+' '+row.secondaryReview.evidence)[secondaryKey];
    if(isMonitor && monitorName.test(row.title+' '+(row.details??''))) {
      const technical = specs('Монитор '+(row.details??''));
      Object.assign(sourceSpecs,technical);
    }
    if(isMouse && mouseName.test(row.title)) {
      const details=specs('Мышь '+(row.details??''));
      if(details['Разъём мыши']==='USB' && row.specEvidence && specs(row.specEvidence.details)['Разъём мыши']==='USB-A') {
        details['Разъём мыши']='USB-A';
      }
      Object.assign(sourceSpecs,details);
      if(sourceSpecs['Разъём мыши']==='USB' && specs(row.specEvidence?.details)['Разъём мыши']==='USB-A') {
        sourceSpecs['Разъём мыши']='USB-A';
      }
    }
    const mainName = plain(row.title).split(/[,.]/)[0];
    const hasSubject = isSwitch ? switchName.test(plain(row.title)) : isCup ? cupName.test(row.title) : isPrinter ? printerName.test(row.title) : isPaper ? /бумаг/iu.test(mainName) : isMonitor ? monitorName.test(row.title+' '+(row.details??'')) : isMouse ? mouseName.test(row.title) : isSSD ? ssdProductName.test(row.title) : !subject || words(mainName).slice(0,6).some(term=>stem(term)===stem(subject));
    const accessory = isMouse && /коврик|комплект|набор|клавиатур|адаптер/iu.test(mainName)
      || isMonitor && /^(?:кронштейн|креплени|подставк|кабель|адаптер|чехол|блок питания)/iu.test(mainName)
      || isCup && (/^(?:крышк|держател|манжет)/iu.test(mainName)
      || (/без крышк/i.test(request.description) && /(?:с крышк|крышка в комплекте)/iu.test(mainName)))
      || isSwitch && /^(?:блок питания|адаптер|кабель|крепление|инжектор|чехол)/i.test(mainName) || subject?.startsWith('ноутбук') && /сумк|чехол|рюкзак|подставк|адаптер|зарядн/i.test(mainName);
    const printerAccessory = isPrinter && /^(?:экструдер|сопло|плата|запчаст|филамент|пластик|термобарьер|хотэнд|стол|ремень|стекло|кожух|комплектующие)/iu.test(mainName);
    const actualPrinterModel = isPrinter && printerModelKey(row.title);
    const printerAnalog = isPrinter && requestedPrinterModel && hasSubject &&
      actualPrinterModel!==requestedPrinterModel;
    const wrongBrand = paperBrand && (/svetocopy|светокоп/u.test(paperBrand)
      ? !/svetocopy|светокоп/u.test(plain(row.title)) : !plain(row.title).includes(paperBrand));
    const hasTechnicalMatch = (required['Технология печати'] && sourceSpecs['Технология печати']) ||
      (required['Белок'] && sourceSpecs['Белок']===required['Белок']);
    const wrongPaperType = /бел(?:ая|ую|ый)/i.test(request.description) && /сер(?:ая|ую)|цветн(?:ая|ую)|\beco\b|эко/i.test(mainName);
    const checks = Object.entries(required).map(([key, want]) => {
      const got = sourceSpecs[key];
      const minimum = /(?:от|не менее)\s*\d/i.test(request.description) && ['Оперативная память','Накопитель'].includes(key);
      const nominal24 = isMonitor && key==='Диагональ' && want==='24″' && got==='23.8″'
        && !/(?:ровно|строго|не менее|от)\s*24/iu.test(request.description);
      const sataCompatible = key==='Интерфейс SSD' && want==='SATA' && got==='SATA III';
      const usbCompatible = key==='Разъём мыши' && want==='USB' && /^USB-[AC]$/.test(got??'');
      const usbUnknown = key==='Разъём мыши' && want==='USB-A' && got==='USB';
      const proteinMinimum = (key==='Масса белка' && /не менее/i.test(request.description) || key==='Чистота белка') &&
        parseFloat(got)>=parseFloat(want);
      const endotoxinLimit = key==='Эндотоксин' && parseFloat(got)<=parseFloat(want);
      const passes = got === want || proteinMinimum || endotoxinLimit || usbCompatible || nominal24 || sataCompatible || (minimum && Number.parseFloat(got) >= Number.parseFloat(want));
      return {key,want,got,source:got?(sellerSpecs[key]?row.url:secondaryUsed && secondaryKey===key?row.secondaryReview.source:row.specEvidence?.url??row.url):null,status: passes ? 'match' : got && !usbUnknown && !(key==='Интерфейс SSD' && want==='SATA III' && got==='SATA') ? 'conflict' : 'unknown'};
    });
    const candidate = words(row.title);
    const hits = keywords.filter(word => candidate.some(term => stem(term) === stem(word)));
    let score = round((hits.length / Math.max(1, keywords.length)) * 55 + (checks.length ? checks.filter(c=>c.status==='match').length / checks.length : hits.length / Math.max(1, keywords.length)) * 45);
    if (lite && hasSubject && !row.unverifiedTitle && !accessory) score = round(40 + score * .6);
    const pack = Number(row.multiplier ?? 1);
    const base = row.unit === request.unit || (request.unit === 'пачка' && row.unit === 'шт.' && /бумаг/i.test(row.title) && !/короб|комплект|упаковк|пач(?:ек|ки|ка)\s*по/i.test(row.title));
    const compatible = row.normalized === true || (base && pack === 1) || (pack > 1 && row.baseUnit === request.unit);
    const unitPrice = compatible && Number.isFinite(pack) && pack>0 && row.price > 0 && row.currency === 'RUB' ? round(row.price / pack) : null;
    let reason = '';
    let state = 'eligible';
    if (row.unavailable) { state = 'excluded'; reason = row.unavailable; }
    else if (!row.manual && ((!hasSubject && !hasTechnicalMatch && !row.unverifiedTitle) || accessory || printerAccessory || (wrongBrand && !request.analogs) || wrongPaperType)) { state = 'excluded'; reason = 'Другой товар, марка или комплектация'; }
    else if (row.minQty > request.quantity) { state = 'excluded'; reason = 'Минимальный заказ: ' + row.minQty + ' ' + request.unit; }
    else if (unitPrice && row.minOrderAmount > unitPrice * request.quantity) { state = 'excluded'; reason = 'Минимальная сумма заказа у продавца: ' + row.minOrderAmount.toLocaleString('ru-RU') + ' ₽'; }
    else if (checks.some(c=>c.status==='conflict') && !row.manual) { state = 'excluded'; reason = 'Не совпадает: ' + checks.filter(c=>c.status==='conflict').map(c=>c.key.toLowerCase()).join(', '); }
    else if (!unitPrice) { state = row.web ? 'review' : 'excluded'; reason = row.priceAccess === 'blocked' ? 'Магазин запросил проверку в браузере' : row.price ? 'Проверьте единицу продажи и валюту' : 'Откройте источник и внесите подтверждённую цену'; }
    else if (row.onOrder && !row.manual) { state='review'; reason='Под заказ. Подтвердите срок поставки.'; }
    else if (!row.manual && ((!isSwitch && !isCup && !isPaper && !isMonitor && !isSSD && !isMouse && (hits.length === 0 || score < 32)) || checks.some(c=>c.status==='unknown'))) { state = 'review'; reason = 'Проверьте назначение и недостающие характеристики'; }
    else { reason = row.manual ? 'Характеристики и условия проверены пользователем' : (checks.length ? 'Совпадают существенные характеристики' : 'Совпадают признаки в наименовании'); }
    const appearsSingle = request.unit === 'шт.' && !row.unit && pack === 1 && hasSubject && !row.unverifiedTitle &&
      !/упаковк|партия|комплект|набор|(?<!\p{L})лот(?!\p{L})|\d+\s*(?:шт\.?|штук)(?!\p{L})/iu.test(row.title);
    const assumedUnitPrice = (lite || state === 'review') && row.web && !unitPrice && appearsSingle &&
      Number.isFinite(row.price) && row.price > 0 && row.currency === 'RUB' &&
      (lite || !row.minOrderAmount || row.minOrderAmount <= row.price * request.quantity) ? round(row.price) : null;
    const analog=(request.analogs || isPrinter) && !row.manual && !printerAccessory &&
      (printerAnalog || wrongBrand || row.analogSearch && !(requestedPrinterModel && hasSubject)) && (hasSubject || hasTechnicalMatch) &&
      !checks.some(check=>check.status==='conflict');
    if (analog && state==='eligible') {
      state='review';
      reason='Кандидат в аналоги. Сверьте характеристики и условия поставки.';
    }
    const aiReview=reviewContradictsSpecs(row.aiReview,sourceSpecs)?undefined:row.aiReview;
    if (!row.manual && aiReview) {
      if (aiReview.status==='conflict' && state!=='excluded') {
        state='excluded';
        reason='ИИ выявил несоответствие: '+aiReview.reason;
      } else if (aiReview.status==='review' && state==='eligible') {
        state='review';
        reason='ИИ рекомендует проверить: '+aiReview.reason;
      }
    }
    return {...row, aiReview, checks, score, unitPrice, assumedUnitPrice, state, reason, analog, needsAnalogApproval:Boolean(isPrinter && analog)};
  }).sort((a,b) => (a.state === 'eligible' ? 0 : a.state === 'review' ? 1 : 2) - (b.state === 'eligible' ? 0 : b.state === 'review' ? 1 : 2) || b.score-a.score);

  if (lite) {
    const included = [];
    const reviewedIds = new Set();
    let assumedCount = 0;
    for (const row of sorted) {
      if (overrides[row.id] === false) {
        row.state = 'excluded';
        row.reason = 'Исключено пользователем';
      } else if (!row.manual && row.state==='excluded' && (isPrinter || request.deepSearch || row.aiReview?.status==='conflict')) {
        continue;
      } else if (row.needsAnalogApproval && overrides[row.id]!==true) {
        continue;
      } else if (!row.manual && row.score < 40) {
        row.state = 'excluded';
        row.reason = 'Релевантность ниже 40 из 100';
      } else {
        const price = row.unitPrice ?? row.assumedUnitPrice;
        if (row.state !== 'eligible') row.state = 'review';
        if (!price) {
          row.state = 'review';
          continue;
        }
        if (row.state === 'review') reviewedIds.add(row.id);
        if (!row.unitPrice) assumedCount++;
        included.push({...row,unitPrice:price});
      }
    }
    const stats = priceStatistics(included,request.quantity);
    return {rows:sorted,included,...stats,required,lite:true,reviewedIds,assumedCount,
      reliable:stats.n>0 && stats.cv!==null && stats.cv<=70,preliminary:null};
  }

  const sample = [];
  for (const row of sorted) {
    const choice = overrides[row.id];
    if (choice === false && row.state === 'review') { row.state = 'excluded'; row.reason = 'Исключено пользователем'; continue; }
    if (row.state === 'review' && choice === true && row.unitPrice) { row.state = 'eligible'; row.reason = 'Сопоставимость подтверждена пользователем'; }
    if (row.state !== 'eligible') continue;
    const seller = plain(row.seller);
    if (seen.has(seller)) { row.state = 'excluded'; row.reason = 'Есть более релевантное предложение того же продавца'; continue; }
    seen.add(seller);
    sample.push(row);
  }
  if (sample.length >= 4) {
    const center = median(sample.map(row=>row.unitPrice));
    for (const row of sample) {
      if (row.unitPrice < center * .65 || row.unitPrice > center * 1.45) {
        row.state = 'excluded';
        row.reason = 'Выброс относительно медианы ' + round(center).toLocaleString('ru-RU') + ' ₽';
      }
    }
  }
  for (const row of sample) if (row.state === 'eligible' && overrides[row.id] === false) {
    row.state = 'excluded'; row.reason = 'Исключено пользователем';
  }
  const included = sample.filter(row=>row.state==='eligible');
  const stats = priceStatistics(included,request.quantity);
  const reliable = stats.n >= 3 && stats.cv <= 33;
  let preliminary = null;
  if (stats.n < 3) {
    const sellers = new Set(included.map(row=>plain(row.seller)));
    const candidates = [];
    const reviewRows = sorted.filter(row=>row.state==='review').sort((a,b)=>Boolean(b.unitPrice)-Boolean(a.unitPrice));
    for (const row of reviewRows) {
      if (row.needsAnalogApproval) continue;
      if (included.length + candidates.length >= 3) break;
      const seller = plain(row.seller);
      if (!(row.unitPrice || row.assumedUnitPrice) || !seller || sellers.has(seller)) continue;
      sellers.add(seller);
      candidates.push({...row,unitPrice:row.unitPrice ?? row.assumedUnitPrice});
    }
    if (candidates.length) preliminary = {
      ...priceStatistics([...included,...candidates],request.quantity),
      ids:new Set(candidates.map(row=>row.id)),
      prices:[...included,...candidates].map(row=>row.unitPrice),
      assumedCount:candidates.filter(row=>row.assumedUnitPrice).length
    };
  }
  if (!preliminary && !reliable && stats.n > 0) {
    preliminary = {...stats,ids:new Set(),assumedCount:0,prices:included.map(row=>row.unitPrice)};
  }
  return { rows:sorted,included,...stats,total:reliable ? stats.total : null,reliable,required,preliminary };
}

function priceStatistics(rows, quantity) {
  const n = rows.length;
  const sum = rows.reduce((acc,row)=>acc+row.unitPrice,0);
  const mean = n ? sum/n : null;
  const cv = n >= 2 ? 100 * Math.sqrt(rows.reduce((acc,row)=>acc+(row.unitPrice-mean)**2,0)/(n-1))/mean : null;
  return {n,mean,cv,total:n ? round(mean*quantity) : null};
}

export function deliveredEstimate(rows, quantity, destination) {
  if(!rows.length || !destination || !(quantity>0)) return null;
  const region=plain(destination).trim();
  const offers=rows.map(row=>{
    const terms=row.manualShipping?.region && plain(row.manualShipping.region)===region && row.manualShipping.quantity===quantity
      ? row.manualShipping : row.shippingQuotes?.find(shipping=>plain(shipping.region)===region && shipping.orderWide===true);
    if(!terms || !Number.isFinite(terms.amount) || terms.amount<0 || !(row.unitPrice>0)) return null;
    const vat=terms.vat??row.vat;
    return {id:row.id,goods:round(row.unitPrice*quantity),shipping:terms.amount,vat:vat??null,
      total:round(row.unitPrice*quantity+terms.amount),source:row.url};
  });
  const verified=offers.filter(Boolean);
  const vatUniform=verified.length && verified.every(row=>row.vat && row.vat===verified[0].vat);
  return {verified,missing:rows.length-verified.length,vatUniform:Boolean(vatUniform),
    total:verified.length===rows.length && vatUniform ? round(verified.reduce((sum,row)=>sum+row.total,0)/verified.length):null};
}
