import test from 'node:test';
import assert from 'node:assert/strict';
import {extractPages,verifiedPrice,measureSearchUsage,verifyDisputedOffers} from './web-search.mjs';

test('разбирает два формата Exa и отбрасывает локальные и неподходящие ссылки',()=>{
  const pages=extractPages('Title: Карточка A\nURL: https://shop.ru/item?utm_medium=web\n\n# Описание\n380 ₽\n---\n# Карточка B\nURL: https://shop2.ru/item\n490 руб.\n---\nTitle: Локальная\nURL: https://127.0.0.1/admin\n100 ₽');
  assert.deepEqual(pages.map(p=>[p.url,verifiedPrice(p.body)]),[['https://shop.ru/item',380],['https://shop2.ru/item',490]]);
});

test('разные цены и цена доставки не подменяют цену предложения',()=>{
  assert.equal(verifiedPrice('Цена: 1 259,50 ₽\nДоставка от 300 ₽'),1259.5);
  assert.equal(verifiedPrice('399 ₽\n349 ₽'),null);
});

test('второй агент учитывает только цитату из переданной карточки',async t=>{
  t.mock.method(globalThis,'fetch',async input=>{
    assert.match(input,/\/agents\/quality-test\//);
    return Response.json({usage:{prompt_tokens:100,completion_tokens:30},choices:[{message:{content:JSON.stringify([
      {id:0,key:'Объём печати',evidence:'180×180×180 мм'},
      {id:1,key:'Объём печати',evidence:'999×999×999 мм'}
    ])}}]});
  });
  const previousId=process.env.PRICE_LAB_VERIFIER_ID, previousToken=process.env.PRICE_LAB_VERIFIER_TOKEN;
  process.env.PRICE_LAB_VERIFIER_ID='quality-test';
  process.env.PRICE_LAB_VERIFIER_TOKEN='test';
  t.after(()=>{
    for(const [key,value] of Object.entries({PRICE_LAB_VERIFIER_ID:previousId,PRICE_LAB_VERIFIER_TOKEN:previousToken})){
      if(value===undefined) delete process.env[key];
      else process.env[key]=value;
    }
  });
  const rows=['a','b'].map(id=>({title:'3D-принтер',url:'https://example.com/'+id,details:'Объём печати 180×180×180 мм',
    checks:[{key:'Объём печати',want:'600×600×600 мм',status:'unknown'}]}));
  const {verified,usage}=await measureSearchUsage(async()=>({
    verified:await verifyDisputedOffers('3D-принтер',{description:'3D-принтер 600×600×600 мм'},rows)
  }));
  assert.equal(verified,1);
  assert.equal(rows[0].secondaryReview.source,rows[0].url);
  assert.equal(rows[1].secondaryReview,undefined);
  assert.deepEqual(usage.verifier,{calls:1,input:100,output:30,reported:1});
});

test('проверка ИИ требует цитату из проверяемой карточки и повторяет запрос только для карточки без ответа',async t=>{
  const {reviewOffers}=await import('./web-search.mjs');
  const env={PRICE_LAB_AGENT_ID:'test',PRICE_LAB_AGENT_TOKEN:'test',PRICE_LAB_AGENT_QUOTA:'1',PRICE_LAB_AGENT_UNTIL:'2000-01-01'};
  const previous=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));
  Object.assign(process.env,env);
  t.after(()=>{
    for(const [key,value] of Object.entries(previous)){
      if(value===undefined) delete process.env[key];
      else process.env[key]=value;
    }
  });
  let calls=0;
  t.mock.method(globalThis,'fetch',async (_url,{signal,body})=>{
    await new Promise(resolve=>setTimeout(resolve,5));
    signal.throwIfAborted();
    const {cards}=JSON.parse(JSON.parse(body).messages[0].content.split('\n').at(-1));
    assert.deepEqual(cards.at(-1),{
      id:cards.length-1,title:'Бумага',details:'',specification:'',conditions:'',
      price:637500,currency:'RUB',saleUnit:'шт.'
    });
    const decisions=calls++===0 ? [
      {id:0,status:'conflict',reason:'Другой формат',evidence:'Бумага А3',deliveryQuote:'Доставка по Москве за 3 рабочих дня'},
      {id:1,status:'conflict',reason:'Другой формат',evidence:'Бумага А3',deliveryQuote:'Доставка за 1 день'},
      {id:1,status:'match',reason:'Дублирующее решение'},
      {id:2,status:'review',reason:'Нет цены и единицы'}
    ] : [{id:0,status:'review',reason:'Не указан формат бумаги'}];
    return Response.json({choices:[{message:{content:JSON.stringify(decisions)}}]});
  });
  const deliveryQuotes=['Доставка по Москве за 3 рабочих дня'];
  const rows=[{title:'Бумага А3',deliveryQuotes},{title:'Бумага А4',deliveryQuotes},{title:'Бумага',price:637500,currency:'RUB',unit:'шт.'}];
  const progress=[];
  const result=await reviewOffers('Бумага А4',{description:'Бумага А4',quantity:1,unit:'пачка'},rows,update=>progress.push(update));
  assert.equal(rows[0].aiReview.status,'conflict');
  assert.equal(rows[1].aiReview.status,'review');
  assert.equal(rows[0].sellerDelivery,deliveryQuotes[0]);
  assert.equal(rows[1].sellerDelivery,undefined);
  assert.deepEqual(rows[2].aiReview,{status:'review',reason:'Не указан формат бумаги'});
  assert.equal(calls,2);
  assert.equal(result.state,'ok');
  assert.equal(result.count,3);
  assert.equal(progress[0].state,'loading');
});
