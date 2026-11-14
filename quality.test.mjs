import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveredEstimate,evaluate,printerModelKey} from './public/analysis.js';
import {deepQueriesForGap} from './deep-review.mjs';

const offer=(id,title,details='',extra={})=>({id,title,details,seller:id,url:'https://'+id+'.ru/item',currency:'RUB',unit:'шт.',price:100,web:true,...extra});

test('оценка качества по размеченным сценариям закупки',()=>{
  const cases=[
    {name:'бумага',description:'Бумага А4, 80 г/м², 500 листов',unit:'пачка',cards:[
      ['good',offer('a','Офисная бумага А4 80 г/м² 500 листов')],
      ['bad',offer('b','Бумага А3 80 г/м² 500 листов')]]},
    {name:'принтер',description:'3D-принтер CreatBot D600 Pro\nТехнология печати FDM\n600×600×600 мм\nНагрев экструдера 420 °C',unit:'шт.',cards:[
      ['good',offer('a','3D-принтер CreatBot D600 Pro','', {specEvidence:{url:'https://www.creatbot.com/ru/d600-pro/',details:'3D-принтер FDM 600×600×600 мм. Температура сопла 420 °C'}})],
      ['analog',offer('b','3D-принтер CreatBot D600 Pro 2 HS','FDM 600×600×600 мм. Нагрев экструдера 420 °C')],
      ['bad',offer('c','3D-принтер Bambu Lab A1 Mini','FDM 180×180×180 мм')],
      ['bad',offer('d','Сопло для 3D-принтера CreatBot D600 Pro')]]},
    {name:'цитокины',description:'rhIL-15 человека CHO 10 мкг',unit:'шт.',cards:[
      ['good',offer('a','rhIL-15 человека CHO 10 мкг')],
      ['bad',offer('b','rhIL-15 мыши CHO 10 мкг')]]},
    {name:'услуга',description:'Поверка лабораторных весов',unit:'услуга',cards:[
      ['good',offer('a','Поверка лабораторных весов','',{unit:'услуга'})],
      ['bad',offer('b','Ремонт лабораторных весов','',{unit:'услуга'})]]}
  ];
  let trueOffers=0,falseOffers=0,expected=0,manual=0;
  for(const sample of cases){
    const result=evaluate(sample.cards.map(([,row])=>row),{...sample,deepSearch:true,analogs:true,quantity:1});
    for(const [label,row] of sample.cards){
      const resolved=result.rows.find(candidate=>candidate.id===row.id);
      if(label==='good') expected++;
      if(resolved.state==='eligible') label==='good'?trueOffers++:falseOffers++;
      if(resolved.state==='review') manual++;
      assert.equal(resolved.state,label==='good'?'eligible':label==='analog'?'review':'excluded',sample.name+' '+row.title);
      if(label==='analog') assert.ok(resolved.analog);
      if(row.specEvidence) assert.ok(resolved.checks.every(check=>check.source===row.specEvidence.url));
    }
  }
  console.log({scenarios:cases.length,trueOffers,falseOffers,expected,manual});
});

test('ревизии не сливаются, а запрос использует модель и характеристики',()=>{
  assert.notEqual(printerModelKey('CreatBot D600 Pro'),printerModelKey('CreatBot D600 Pro 2 HS'));
  assert.equal(printerModelKey('CreatBot D600 Pro2 HS'),'d600pro2hs');
  const queries=deepQueriesForGap('CreatBot D600 Pro',{description:'3D-принтер CreatBot D600 Pro FDM 600×600×600 мм',quantity:1,unit:'шт.',analogQuery:'3D-принтер FDM 600×600×600 мм'},[]);
  assert.ok(queries.some(query=>query.includes('цена в наличии')));
  assert.ok(queries.some(query=>query.includes('600×600×600')));
});

test('полная стоимость требует подтверждения на весь заказ и той же базы НДС',()=>{
  const row={id:'a',unitPrice:100};
  const shipping={region:'Москва',amount:50,quantity:10,vat:'included'};
  assert.equal(deliveredEstimate([{...row,shippingQuotes:[{...shipping,orderWide:false}]}],10,'Москва').total,null);
  assert.equal(deliveredEstimate([{...row,manualShipping:shipping}],20,'Москва').total,null);
  assert.equal(deliveredEstimate([{...row,manualShipping:shipping},{...row,id:'b',manualShipping:{...shipping,vat:'excluded'}}],10,'Москва').total,null);
  assert.equal(deliveredEstimate([{...row,manualShipping:shipping},{...row,id:'b',unitPrice:120,manualShipping:{...shipping,amount:100}}],10,'Москва').total,1175);
});
