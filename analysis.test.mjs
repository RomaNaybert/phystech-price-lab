import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate} from './public/analysis.js';

const paper={description:'Бумага А4 SvetoCopy. Белая, плотность 80 г/м², 500 листов в пачке.',quantity:25,unit:'пачка'};
const offer=(seller,price,extra={})=>({id:seller,seller,price,unit:'шт.',currency:'RUB',title:'Бумага А4 SvetoCopy 80г/м2 500л.',...extra});

test('ИИ не отправляет на проверку за материал или объём, уже найденные в карточке',()=>{
  const request={description:'Стакан бумажный для горячих напитков 250 мл',quantity:100,unit:'шт.'};
  const title='Стакан бумажный однослойный белый, для горячего, 250 мл, 50 шт/уп.';
  for(const reason of ['Нет данных о материале','Нет объёма в заголовке']){
    const result=evaluate([offer('А',127,{title,baseUnit:'шт.',unit:'пачка',multiplier:50,aiReview:{status:'review',reason}})],request);
    assert.equal(result.rows[0].state,'eligible');
    assert.equal(result.rows[0].aiReview,undefined);
    assert.equal(result.rows[0].unitPrice,2.54);
  }
  const result=evaluate([offer('Б',9.2,{title:'Стакан одноразовый бумажный «С днем рождения», 250 мл',
    aiReview:{status:'review',reason:'Нет объёма в заголовке'}})],request);
  assert.equal(result.rows[0].state,'review');
  assert.equal(result.rows[0].aiReview,undefined);
  assert.equal(result.rows[0].checks.find(check=>check.key==='Для горячих напитков').status,'unknown');
});

test('средняя, вариация, формат, выброс и дубль воспроизводимы',()=>{
  const rows=[offer('А',345),offer('Б',356.9),offer('В',499),offer('Г',692),
    offer('А',120,{id:'duplicate'}),offer('Д',540,{title:'Бумага А3 SvetoCopy 80 г/м2 500 листов'})];
  const result=evaluate(rows,paper);
  assert.equal(result.total,10007.5);
  assert.equal(result.n,3);
  assert.ok(Math.abs(result.cv-21.4048)<0.001);
  assert.match(result.rows.find(row=>row.id==='Г').reason,/Выброс/);
  assert.match(result.rows.find(row=>row.id==='duplicate').reason,/того же продавца/);
  assert.match(result.rows.find(row=>row.id==='Д').reason,/формат/);
});

test('снятие одного предложения блокирует итог при двух источниках',()=>{
  const result=evaluate([offer('А',345),offer('Б',356.9),offer('В',499),offer('Г',692)],paper,{А:false});
  assert.equal(result.n,2);
  assert.equal(result.total,null);
});

test('стоимость коробки приводится к одной пачке, неполные данные требуют проверки',()=>{
  const rows=[offer('А',1725,{unit:'коробка',multiplier:5,baseUnit:'пачка'}),
    offer('Б',450,{title:'Бумага А4 SvetoCopy 80 г/м²'}),offer('В',400,{currency:'USD'})];
  const result=evaluate(rows,paper);
  assert.equal(result.rows.find(r=>r.id==='А').unitPrice,345);
  assert.equal(result.rows.find(r=>r.id==='Б').state,'review');
  assert.equal(result.rows.find(r=>r.id==='В').state,'excluded');
});

test('чехол и меньшая конфигурация исключаются из выборки ноутбуков',()=>{
  const laptop={description:'Ноутбук офисный. ОЗУ не менее 16 ГБ, SSD не менее 512 ГБ.',quantity:5,unit:'шт.'};
  const rows=[offer('А',45000,{title:'Ноутбук офисный ОЗУ 8 ГБ SSD 256 ГБ'}),
    offer('Б',1300,{title:'Чехол для ноутбука 16"'})];
  assert.deepEqual(evaluate(rows,laptop).rows.map(x=>x.state),['excluded','excluded']);
});

test('коммутаторы: три цены дают НМЦД, ссылка без цены и несовпадающие порты не входят',()=>{
  const request={description:'Неуправляемый коммутатор. 8 портов RJ-45, 1 Гбит/с, без PoE, адаптер питания в комплекте.',quantity:20,unit:'шт.'};
  const exact={title:'Коммутатор TP-Link TL-SG108',details:'8 портов 10/100/1000 Мбит/с',
    specEvidence:{details:request.description},web:true};
  const rows=[offer('А',3241,exact),offer('Б',3290,exact),offer('В',3520,exact),
    offer('Г',null,exact),offer('Д',3100,{...exact,title:'Коммутатор 5 портов',details:'5 портов RJ45 1000 Мбит/с'})];
  const result=evaluate(rows,request,{Г:true});
  assert.equal(result.total,67006.67);
  assert.equal(result.rows.find(r=>r.id==='Г').state,'review');
  assert.match(result.rows.find(r=>r.id==='Д').reason,/количество портов/);
});

test('предварительная оценка берёт цены на проверку от разных продавцов и сохраняет итоговый порог',()=>{
  const uncertain='Бумага А4 SvetoCopy 80 г/м²';
  const rows=[
    offer('А',300),offer('А',400,{id:'duplicate',title:uncertain}),
    offer('Б',325,{title:uncertain}),offer('В',350,{title:uncertain}),
    offer('Г',100,{title:'Бумага А3 SvetoCopy 80 г/м² 500 листов'}),
    offer('Д',null,{web:true,title:uncertain})
  ];
  const result=evaluate(rows,paper);
  assert.equal(result.total,null);
  assert.equal(result.n,1);
  assert.deepEqual([...result.preliminary.ids],['Б','В']);
  assert.equal(result.preliminary.total,8125);
  assert.ok(Math.abs(result.preliminary.cv-7.6923)<0.001);
  const confirmed=evaluate(rows,paper,{Б:true,В:true});
  assert.equal(confirmed.preliminary,null);
  assert.equal(confirmed.total,8125);
  const rejected=evaluate(rows,paper,{Б:false,В:false});
  assert.equal(rejected.preliminary.total,7500);
  assert.equal(rejected.preliminary.ids.size,0);
});

test('розничные цены мышей с неизвестной единицей видны в предварительной оценке',()=>{
  const request={description:'Мышь компьютерная беспроводная',quantity:10,unit:'шт.'};
  const row=(id,seller,title,price)=>({id,seller,title,price,currency:'RUB',unit:null,web:true});
  const rows=[
    row('defender','sotovikm.ru','Мышь беспроводная Defender MM-396',308),
    row('m170','Регард','Мышь беспроводная Logitech M170 Grey',980),
    row('m185','Регард','Мышь беспроводная Logitech M185 Grey',1080),
    row('pack','Другой','Мышь беспроводная, упаковка 5 штук',1500),
    {...row('unknown','Другой','Карточка на сайте',100),unverifiedTitle:true}
  ];
  const result=evaluate(rows,request);
  assert.equal(result.n,0);
  assert.equal(result.total,null);
  assert.equal(result.preliminary.n,2);
  assert.equal(result.preliminary.mean,644);
  assert.equal(result.preliminary.total,6440);
  assert.equal(result.preliminary.assumedCount,2);
  const confirmed=evaluate(rows.map(item=>item.id==='defender'?{...item,unit:'шт.'}:item),request,{defender:true});
  assert.equal(confirmed.n,1);
  assert.equal(confirmed.preliminary.assumedCount,1);
});

test('при большой вариации показывает предварительную цену по подтверждённым предложениям',()=>{
  const result=evaluate([offer('А',308),offer('Б',980),offer('В',1080)],paper);
  assert.equal(result.n,3);
  assert.ok(result.cv>33);
  assert.equal(result.total,null);
  assert.equal(result.preliminary.total,19733.33);
  assert.equal(result.preliminary.ids.size,0);
});

test('одна подтверждённая цена даёт предварительную сумму даже без других цен',()=>{
  const result=evaluate([offer('А',980)],paper);
  assert.equal(result.preliminary.total,24500);
  assert.equal(result.preliminary.n,1);
  assert.equal(result.preliminary.cv,null);
});

test('предварительная оценка использует подходящие штучные товары разных категорий',()=>{
  const request={description:'Лампа настольная',quantity:10,unit:'шт.'};
  const lamp=(seller,title,price,extra={})=>offer(seller,price,{title,web:true,unit:null,...extra});
  const rows=[
    lamp('А','Лампа настольная, белая',980,{unit:'шт.'}),
    lamp('Б','Лампа настольная, чёрная',702),
    lamp('В','Лампа настольная, серая',1200),
    lamp('Г','Лампа настольная, набор 3 шт.',900),
    lamp('Д','Лампа настольная, товар недоступен',500,{unavailable:'Нет в наличии'})
  ];
  const result=evaluate(rows,request);
  assert.equal(result.preliminary.n,3);
  assert.equal(result.preliminary.total,9606.67);
  assert.deepEqual([...result.preliminary.ids],['Б','В']);
});

test('Лайт учитывает спорные цены, повторные предложения продавца и разброс до 70%',()=>{
  const rows=[
    offer('А',100),offer('А',200,{id:'duplicate'}),
    offer('Б',350,{title:'Бумага А4 SvetoCopy 80 г/м²'}),
    offer('Г',1000,{title:'Клавиатура'})
  ];
  const lite=evaluate(rows,{...paper,pricingMode:'lite'});
  assert.equal(lite.n,3);
  assert.ok(lite.cv>33 && lite.cv<=70);
  assert.equal(lite.total,5416.67);
  assert.ok(lite.reviewedIds.has('Б'));
  assert.equal(lite.rows.find(row=>row.id==='Г').state,'excluded');
  assert.equal(evaluate(rows,paper).n,1);
  assert.equal(evaluate(rows,{...paper,pricingMode:'lite'},{Б:false}).n,2);
});

test('аналог принтера требует сверки, а несовместимый объём исключается',()=>{
  const request={description:'3D принтер CreatBot D600 Pro\nТехнология печати FDM\n600х600х600 мм',unit:'шт.',quantity:1,analogs:true};
  const rows=[
    offer('А',1000,{title:'3D-принтер Qidi X600 FFF 600×600×600 мм'}),
    offer('Б',1000,{title:'3D принтер FDM 300×300×300 мм',analogSearch:true}),
    offer('В',1000,{title:'3D-принтер CreatBot D600 Pro FDM 600×600×600 мм',analogSearch:true}),
    offer('Г',1000,{title:'Сопло для 3D-принтера CreatBot D600 Pro FDM'})
  ];
  const result=evaluate(rows,request);
  assert.equal(result.rows.find(row=>row.id==='А').state,'review');
  assert.equal(result.rows.find(row=>row.id==='А').analog,true);
  assert.equal(result.rows.find(row=>row.id==='Б').state,'excluded');
  assert.equal(result.rows.find(row=>row.id==='В').state,'eligible');
  assert.equal(result.rows.find(row=>row.id==='Г').state,'excluded');
  assert.deepEqual(result.included.map(row=>row.id),['В']);
  assert.ok(!result.preliminary.ids.has('А'));
  assert.deepEqual(evaluate(rows,{...request,pricingMode:'lite'}).included.map(row=>row.id),['В']);
  assert.ok(evaluate(rows,request,{А:true}).included.some(row=>row.id==='А'));
});

test('для цитокинов проверяются идентичность белка, масса и клеточная линия',()=>{
  const request={description:'rhIL-15 человека, CHO, не менее 10 мкг',unit:'шт.',quantity:2,analogs:true};
  const rows=[
    offer('А',1000,{title:'rhIL-15 человека, CHO',details:'Фасовка 20 мкг',onOrder:true}),
    offer('Б',1000,{title:'rhIL-15 человека, E. coli',details:'Фасовка 10 мкг'}),
    offer('В',1000,{title:'rhIL-7 человека, CHO',details:'Фасовка 10 мкг'})
  ];
  const result=evaluate(rows,request);
  assert.match(result.rows.find(row=>row.id==='А').reason,/срок поставки/);
  assert.match(result.rows.find(row=>row.id==='Б').reason,/клеточная линия/);
  assert.equal(result.rows.find(row=>row.id==='В').state,'excluded');
});

test('проверка ИИ отправляет сомнения на сверку и исключает конфликт даже в режиме Лайт',()=>{
  const rows=[offer('А',345,{aiReview:{status:'review',reason:'Уточните белизну'}}),
    offer('Б',356,{aiReview:{status:'conflict',reason:'Бумага серая'}}),
    offer('В',370,{title:'Обложка для бумаги А4',aiReview:{status:'match',reason:'Подходит'}})];
  for(const pricingMode of ['strict','lite']){
    const result=evaluate(rows,{...paper,pricingMode});
    assert.equal(result.rows.find(row=>row.id==='А').state,'review');
    assert.equal(result.rows.find(row=>row.id==='Б').state,'excluded');
    assert.ok(!result.included.some(row=>row.id==='Б'));
  }
  assert.equal(evaluate(rows,paper).rows.find(row=>row.id==='В').state,'excluded');
  assert.equal(evaluate(rows,paper,{А:true}).rows.find(row=>row.id==='А').state,'eligible');
});
