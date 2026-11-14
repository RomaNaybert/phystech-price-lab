import test from 'node:test';
import assert from 'node:assert/strict';
import {market} from './sources.mjs';

test('глубокий поиск продолжает проверять каталоги после тайм-аута Timeweb и пустой выдачи Exa',async t=>{
  const previous=process.env.PRICE_LAB_AGENT_ID;
  const previousToken=process.env.PRICE_LAB_AGENT_TOKEN;
  process.env.PRICE_LAB_AGENT_ID='test';
  process.env.PRICE_LAB_AGENT_TOKEN='test';
  t.after(()=>{
    if(previous===undefined) delete process.env.PRICE_LAB_AGENT_ID;
    else process.env.PRICE_LAB_AGENT_ID=previous;
    if(previousToken===undefined) delete process.env.PRICE_LAB_AGENT_TOKEN;
    else process.env.PRICE_LAB_AGENT_TOKEN=previousToken;
  });
  t.mock.method(globalThis,'fetch',async (input,options)=>{
    const hostname=new URL(input).hostname;
    if(hostname==='agent.timeweb.cloud') throw new DOMException('timeout','TimeoutError');
    if(hostname==='mcp.exa.ai'){
      assert.equal(JSON.parse(options.body).params.name,'web_search_exa');
      return Response.json({result:{content:[{type:'text',text:'Нет результатов'}]}});
    }
    return new Response('');
  });
  const output=await market('Тестовый прибор КЦ749',undefined,{
    description:'Тестовый прибор КЦ749',quantity:1,unit:'шт.',pricingMode:'strict',deepSearch:true
  });
  assert.deepEqual(output.roundHistory.map(round=>round.method),['catalog','agent','catalog','catalog','catalog']);
  assert.equal(output.deepResult.reached,false);
  assert.equal(output.deepResult.count,0);
});

test('поиск начинает с ЕИС, проходит обязательные площадки и условно включает маркетплейсы',async t=>{
  for (const empty of [false,true]) {
    const requests=[];
    const sources=[];
    const mock=t.mock.method(globalThis,'fetch',async input=>{
      const url=new URL(input);
      requests.push(url);
      if (url.hostname==='zakupki.gov.ru') {
        if (!empty) return new Response('',{status:503});
        return new Response('<main>По вашему запросу ничего не найдено</main>');
      }
      if (url.hostname==='www.sima-land.ru') return Response.json({items:[]});
      if (url.hostname==='www.roseltorg.ru') return new Response('<a href="/procedure/123/1">Бумага для офиса A4</a>');
      return new Response('');
    });
    const output=await market('бумага А4',source=>sources.push(source));
    mock.mock.restore();
    assert.equal(requests[0].hostname,'zakupki.gov.ru');
    assert.equal(sources[0].name,'ЕИС');
    for(const name of ['ГИСП','Сбербанк-АСТ','РТС-тендер','Росэлторг','ЭТП ГПБ','Заказ РФ','ТЭК-Торг','Фабрикант',
      'РАД','ЕАТ «Берёзка»','Портал поставщиков Москвы','Электронный магазин Московской области','КОРУС','ЭТМ','Чип и Дип']) {
      assert.ok(sources.some(source=>source.name===name),name);
    }
    assert.equal(requests.some(url=>url.hostname==='www.ozon.ru'),empty);
    assert.equal(sources.find(source=>source.name==='Ozon').state,empty?'partial':'skipped');
    const procurement=output.records.find(record=>record.seller==='Росэлторг');
    assert.equal(procurement.price,null);
    assert.ok(procurement.unavailable);
  }
});
