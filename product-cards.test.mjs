import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCard} from './product-cards.mjs';

const url='https://www.regard.ru/product/129160/kommutator-svitc-tp-link-tl-sg108';
const card=offers=>'<script type="application/ld+json">'+JSON.stringify({
  '@type':'Product',name:'Коммутатор TL-SG108',offers
})+'</script>';
const offer={'@type':'Offer',price:3520,priceCurrency:'RUB',availability:'https://schema.org/InStock',url};
test('карточка: подтверждаем публичную цену в рублях только при наличии и однозначном предложении',()=>{
  assert.equal(parseCard(card(offer),url).unit,'шт.');
  assert.equal(parseCard(card(offer),url).price,3520);
  const deliveryCard=card(offer)+'<main><p>Доставка по Москве за 3 рабочих дня.</p><p>Возврат после доставки в течение 14 дней.</p></main>';
  assert.deepEqual(parseCard(deliveryCard,url).deliveryQuotes,['Доставка по Москве за 3 рабочих дня']);
  assert.equal(parseCard(card({...offer,availability:'OutOfStock'}),url).price,null);
  assert.equal(parseCard(card({...offer,'@type':'AggregateOffer'}),url).price,null);
  assert.equal(parseCard(card([offer,{...offer,price:3990}]),url).price,null);
  assert.equal(parseCard(card({...offer,url:url+'/other'}),url).price,null);
  assert.equal(parseCard(card(offer),'https://www.regard.ru/catalog?search=TL-SG108'),null);
});

test('Ситилинк: читает цену после перенаправления на канонический адрес',async t=>{
  const {readCard}=await import('./product-cards.mjs');
  const original='https://www.citilink.ru/product/mysh-oklick-489mw-1885440/';
  const canonical='https://www.citilink.ru/product/mysh-oklick-489mw-chernyi-1885440/';
  const requests=[];
  t.mock.method(globalThis,'fetch',async input=>{
    requests.push(input);
    if(input===original) return Response.redirect(canonical,301);
    return new Response(card({...offer,price:702,url:canonical}),{headers:{'Content-Type':'text/html'}});
  });
  const result=await readCard(original);
  assert.deepEqual(requests,[original,canonical]);
  assert.equal(result.url,canonical);
  assert.equal(result.price,702);
});

test('Онлайнтрейд: страница проверки не выдаётся за карточку товара',async t=>{
  const {expandCards}=await import('./product-cards.mjs');
  t.mock.method(globalThis,'fetch',async()=>new Response('<script>function get_cookie_spsn(){}</script>',
    {headers:{'Content-Type':'text/html'}}));
  const url='https://www.onlinetrade.ru/catalogue/myshi-c123/brand/mysh-1234.html';
  const [result]=await expandCards([{url,price:null,web:true}]);
  assert.equal(result.price,null);
  assert.equal(result.priceAccess,'blocked');
});

test('незнакомый магазин: берёт цену из разметки основного товара',()=>{
  const url='https://www.shop.ru/products/mouse';
  const html=`<article itemscope itemtype="https://schema.org/Product">
    <h1>Мышь проводная</h1>
    <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
      <meta itemprop="price" content="890"><meta itemprop="priceCurrency" content="RUB">
      <link itemprop="availability" href="https://schema.org/InStock">
    </div>
  </article>`;
  assert.equal(parseCard(html,url,{allowPublic:true}).price,890);
});
