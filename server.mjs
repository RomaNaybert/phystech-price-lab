import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';
import { market } from './sources.mjs';
import { agentConfigured, measureSearchUsage, suggestDescription } from './web-search.mjs';
import { units } from './public/analysis.js';

const root = fileURLToPath(new URL('./public',import.meta.url));
const port = Number(process.env.PORT ?? 8780);
const host = process.env.HOST ?? '127.0.0.1';
const prefix = '/hack-phystech';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
const cache=new Map();
let active=0;
function reply(res,status,body,type='application/json; charset=utf-8',extra={}) {
  res.writeHead(status,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store',...extra});
  res.end(body);
}
const json=(res,status,body)=>reply(res,status,JSON.stringify(body));
const server=createServer(async (req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(![prefix,prefix+'/'].includes(url.pathname) && !url.pathname.startsWith(prefix+'/')) return json(res,404,{error:'Страница не найдена'});
    const isSearch=url.pathname===prefix+'/api/search';
    const isSuggestion=url.pathname===prefix+'/api/suggest-description';
    if((isSearch||isSuggestion) && req.method==='POST'){
      if(req.headers['sec-fetch-site']==='cross-site') return json(res,403,{error:'Откройте форму сервиса'});
      let raw='';
      for await(const chunk of req){
        raw+=chunk;
        if(raw.length>4000) return json(res,413,{error:'Запрос слишком длинный'});
      }
      let input;
      try { input=JSON.parse(raw); } catch { return json(res,400,{error:'Некорректный запрос'}); }
      const description=typeof input?.description==='string' ? input.description.trim() : '';
      const publicText=text=>!/https?:|@|\+\d[\d ()-]{9,}/i.test(text);
      if(isSuggestion) {
        if(!agentConfigured()) return json(res,503,{error:'Агент временно недоступен'});
        if(description.length<3 || description.length>700 || !publicText(description)) return json(res,400,{error:'Нужно публичное описание без ссылок и контактов'});
        if(active>=4) return json(res,429,{error:'Сервис занят'});
        active++;
        try { return json(res,200,{description:await suggestDescription(description)}); }
        catch { return json(res,503,{error:'Агент временно недоступен'}); }
        finally { active--; }
      }
      const query=typeof input?.query==='string' ? input.query.trim().replace(/\s+/g,' ') : '';
      if(query.length<3 || query.length>130 || /https?:|@|\+\d[\d ()-]{9,}/i.test(query)) return json(res,400,{error:'Введите короткое публичное название товара без ссылок и контактов'});
      const analogQuery=typeof input?.analogQuery==='string' ? input.analogQuery.trim() : '';
      if(analogQuery && (analogQuery.length>130 || !publicText(analogQuery))) return json(res,400,{error:'Проверьте публичный запрос для аналогов'});
      const quantity=input?.quantity;
      const unit=input?.unit;
      const pricingMode=input?.pricingMode==='lite'?'lite':'strict';
      const streaming=req.headers.accept==='application/x-ndjson';
      const request=streaming && description.length>=3 && description.length<=700 && Number.isFinite(quantity) &&
        quantity>0 && quantity<=1e9 && units.includes(unit) ? {description,quantity,unit,pricingMode,analogs:input?.analogs===true,analogQuery,
          deepSearch:input?.deepSearch===true} : undefined;
      if(streaming && !request) return json(res,400,{error:'Проверьте описание, количество и единицу измерения.'});
      const key=JSON.stringify([query.toLocaleLowerCase('ru'),request]);
      let hit=cache.get(key);
      if(!hit || (hit.finished && hit.expires<Date.now())){
        if(active>=4) return json(res,429,{error:'Сервис занят, попробуйте через несколько секунд'});
        if(cache.size>=80) cache.delete(cache.keys().next().value);
        active++;
        hit={expires:Date.now()+180_000, progress:[], listeners:new Set()};
        const run=hit;
        const publish=update=>{
          run.progress.push(update);
          for(const listener of run.listeners) listener(update);
        };
        const search=()=>market(query,source=>publish({source}),request,round=>publish({round}));
        run.data=(request?.deepSearch?measureSearchUsage(search):search())
          .then(result=>{
            // Briefly share failures too, but let a later search try the provider again.
            if(result.roundHistory?.at(-1)?.note) run.expires=Date.now()+10_000;
            else run.expires=Date.now()+180_000;
            return result;
          }).finally(()=>{run.finished=true;active--;});
        cache.set(key,hit);
      }
      if(streaming){
        res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','X-Accel-Buffering':'no','Cache-Control':'no-store'});
        res.flushHeaders();
        const send=update=>res.write(JSON.stringify(update)+'\n');
        for(const update of hit.progress) send(update);
        hit.listeners.add(send);
        const heartbeat=setInterval(()=>res.write('\n'),8000);
        res.once('close',()=>{
          clearInterval(heartbeat);
          hit.listeners.delete(send);
        });
        try {
          const result=await hit.data;
          if(!res.destroyed) res.end(JSON.stringify({result})+'\n');
        } catch {
          if(!res.destroyed) res.end(JSON.stringify({error:'Не удалось завершить поиск'})+'\n');
        } finally {
          clearInterval(heartbeat);
        }
        return;
      }
      const data=await hit.data;
      return json(res,200,data);
    }
    if(req.method!=='GET' && req.method!=='HEAD') return json(res,405,{error:'Метод не поддерживается'});
    if(url.pathname===prefix) return reply(res,308,'','text/plain',{'Location':prefix+'/'});
    const relative=decodeURIComponent(url.pathname.slice(prefix.length+1)) || 'index.html';
    const filename=resolve(root,relative);
    if(!filename.startsWith(root+sep) || !types[extname(filename)]) return json(res,404,{error:'Файл не найден'});
    const libraries={'exceljs.js':'exceljs/dist/exceljs.min.js','jszip.js':'jszip/dist/jszip.min.js','pdf.mjs':'pdfjs-dist/build/pdf.min.mjs','pdf.worker.mjs':'pdfjs-dist/build/pdf.worker.min.mjs'};
    const asset=Object.hasOwn(libraries,relative) ? new URL('./node_modules/'+libraries[relative],import.meta.url) : filename;
    const content=await readFile(asset).catch(()=>null);
    if(!content) return json(res,404,{error:'Файл не найден'});
    return reply(res,200,req.method==='HEAD'?'':content,types[extname(filename)],{
      'Content-Security-Policy':"default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; font-src 'self'; worker-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'Referrer-Policy':'no-referrer'
    });
  } catch {
    if(!res.headersSent) json(res,500,{error:'Не удалось обработать запрос'});
  }
});
server.listen(port,host,()=>console.log('Price Lab: http://'+host+':'+port+prefix+'/'));
