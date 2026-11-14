const namespace='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const children=(node,tag)=>Array.from(node.children).filter(child=>child.namespaceURI===namespace && child.localName===tag);
const all=(node,tag)=>Array.from(node.getElementsByTagNameNS(namespace,tag));
const tidy=text=>text.replace(/[^\S\n]+/g,' ').trim();
const cellText=cell=>all(cell,'p').map(p=>tidy(all(p,'t').map(node=>node.textContent).join(''))).filter(Boolean).join('\n');
const oneLine=text=>text.replace(/\s+/g,' ').trim();
const number=text=>Number(text.replace(/\s/g,'').replace(',','.'));
const matchIndex=(row,pattern)=>row.findIndex(value=>pattern.test(value));

export function parseSpecification(xml,units) {
  const document=new DOMParser().parseFromString(xml,'application/xml');
  if(document.querySelector('parsererror')) throw new Error('Не удалось прочитать таблицы Word.');
  const tables=all(document,'tbl').map(table=>children(table,'tr').map(row=>children(row,'tc').map(cellText)));
  return parseTables(tables,units);
}

function parseTables(tables,units){
  const positions=[];
  const requirements=new Map();
  let delivery='';
  for(const table of tables){
    const headerIndex=table.findIndex(row=>matchIndex(row,/наименование/i)>=0 && matchIndex(row,/количество/i)>=0 &&
      matchIndex(row,/единица измерения/i)>=0);
    if(headerIndex>=0){
      const header=table[headerIndex];
      const title=matchIndex(header,/наименование/i);
      const unit=matchIndex(header,/единица измерения/i);
      const quantity=matchIndex(header,/количество/i);
      const code=matchIndex(header,/окпд/i);
      for(const row of table.slice(headerIndex+1)){
        const name=oneLine(row[title]??'');
        const amount=number(row[quantity]??'');
        const label=oneLine(row[unit]??'').toLowerCase();
        const normalized=label==='шт'?'шт.':label;
        if(name.length<3 || !/[\p{L}]/u.test(name) || !Number.isFinite(amount) || amount<=0 || amount>1000000) continue;
        if(!units.includes(normalized)) throw new Error('Единица «'+label+'» пока не поддерживается. Введите позицию вручную.');
        positions.push({number:row[0],title:name,quantity:amount,unit:normalized,code:oneLine(row[code]??'')});
      }
      continue;
    }
    const deliveryHeader=table.findIndex(row=>matchIndex(row,/срок поставки/i)>=0);
    if(deliveryHeader>=0){
      const column=matchIndex(table[deliveryHeader],/срок поставки/i);
      delivery=table.slice(deliveryHeader+1).map(row=>row[column]).find(value=>/дн|суток|недел|месяц/i.test(value??''))??delivery;
      continue;
    }
    const specsIndex=table.findIndex(row=>row.some(value=>/функциональные, технические|требования обязательные/i.test(value)));
    if(specsIndex<0) continue;
    let position;
    for(const row of table.slice(specsIndex+1)){
      if(/^\d+$/.test(row[0]) && /[\p{L}]/u.test(row[1]??'')) position=row[0];
      if(!position || !row[2] || !/[\p{L}]/u.test(row[2])) continue;
      const specs=requirements.get(position)??[];
      specs.push(row.slice(2).filter(Boolean).join(' '));
      requirements.set(position,specs);
    }
  }
  if(!positions.length) throw new Error('В ТЗ не найдена таблица с названием, количеством и единицей. Добавьте позиции вручную.');
  if(positions.length>30) throw new Error('За один раз можно обработать до 30 позиций.');
  return positions.map(({number,...item})=>({...item,delivery,requirements:(requirements.get(number)??[]).join('\n')}));
}

export async function parsePdfSpecification(file,units){
  const pdfjs=await import('./pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc=new URL('./pdf.worker.mjs',import.meta.url).href;
  const task=pdfjs.getDocument({data:await file.arrayBuffer(),isEvalSupported:false});
  try{
    const pdf=await task.promise;
    if(pdf.numPages>35) throw new Error('В PDF должно быть не более 35 страниц.');
    const tables=[];
    let readable=false;
    let columns;
    for(let i=1;i<=pdf.numPages;i++){
      const page=await pdf.getPage(i);
      const {items}=await page.getTextContent();
      const lines=[];
      for(const item of items.filter(item=>item.str?.trim()).sort((a,b)=>b.transform[5]-a.transform[5])){
        const y=item.transform[5];
        let line=lines.at(-1);
        if(!line || Math.abs(line.y-y)>3) lines.push(line={y,parts:[]});
        line.parts.push({x:item.transform[4],width:item.width,text:tidy(item.str)});
        readable=true;
      }
      const section=lines.findIndex(line=>line.parts.some(part=>/требование к срок|требования к качеству/i.test(part.text)));
      const tableLines=section<0?lines:lines.slice(0,section);
      const header=tableLines.findIndex(line=>{
        if(!line.parts.some(part=>/^наименование/i.test(part.text))) return false;
        const nearby=tableLines.filter(other=>Math.abs(other.y-line.y)<=12).flatMap(other=>other.parts);
        return nearby.some(part=>/^единица/i.test(part.text)) && nearby.some(part=>/^количество/i.test(part.text));
      });
      if(header>=0){
        const nearby=tableLines.filter(line=>Math.abs(line.y-tableLines[header].y)<=16).flatMap(line=>line.parts);
        const labels=[/^номер|^№/,/^наименование/i,/^единица/i,/^количество/i,/^окпд/i].map(pattern=>nearby.find(part=>pattern.test(part.text.toLowerCase())));
        const centers=labels.map(part=>part?part.x+part.width/2:Infinity);
        columns=[0,labels[0]?Math.min(labels[0].x+labels[0].width+5,(centers[0]+centers[1])/2):0,
          (centers[1]+centers[2])/2,(centers[2]+centers[3])/2,(centers[3]+centers[4])/2];
      }
      if(columns){
        const candidates=tableLines.slice(header<0?0:header+1).map(line=>{
          const row=columns.map(()=> '');
          const edges=[];
          for(const part of line.parts.sort((a,b)=>a.x-b.x)){
            const index=columns.findLastIndex(x=>x<=part.x);
            const gap=part.x-(edges[index]??0);
            row[index]+=(row[index] && gap>1.2?' ':'')+part.text;
            edges[index]=part.x+part.width;
          }
          return row;
        });
        const priced=candidates.map((row,index)=>({row,index})).filter(({row})=>
          units.includes(row[2].toLowerCase().replace(/^шт$/,'шт.')) && number(row[3])>0);
        const isTitleLine=row=>row && !row[0] && row[1] && !row[2] && !row[3] && !row[4] &&
          !/^\(?система|^измерения|^производитель|^страна/i.test(row[1]);
        const centered=isTitleLine(candidates[priced[0]?.index-1]);
        const rows=priced.map(({row,index},n)=>{
          const [previous,next]=[priced[n-1]?.index,priced[n+1]?.index];
          const low=centered?(previous===undefined?index-1:Math.floor((previous+index)/2)+1):index;
          const high=centered?(next===undefined?index+1:Math.ceil((index+next)/2)-1):(next??candidates.length)-1;
          row[1]=candidates.slice(Math.max(low,0),high+1).filter(value=>value===row || isTitleLine(value))
            .map(value=>value[1]).join(' ').trim();
          return row;
        });
        if(rows.length) tables.push([['Номер','Наименование','Единица измерения','Количество','ОКПД'],...rows]);
      }
      if(section>=0) columns=undefined;
      page.cleanup();
    }
    if(!readable) throw new Error('PDF содержит скан. Загрузите PDF с выделяемым текстом или добавьте позиции вручную.');
    return parseTables(tables,units);
  }finally{
    await task.destroy();
  }
}

export function positionRequest(item,pricingMode){
  const title=oneLine(item.title);
  const requirements=item.requirements.split('\n').filter(Boolean);
  const priority=/общий вес 1 шт|формат бумаги|листов в|плотность|площадью 1 м|технология печати|печать одним экструдером|нагрев экструдера|эндотоксин|чистота/i;
  const essential=[...requirements.filter(line=>priority.test(line)),...requirements.filter(line=>!priority.test(line))];
  return {description:item.editedDescription??[title,...essential].join('\n').slice(0,700),quantity:item.quantity,unit:item.unit,pricingMode,
    analogs:true,analogQuery:item.analogQuery};
}


export function suggestedAnalogQuery(item){
  const text=item.title+' '+item.requirements;
  if(/creatbot|3d[ -]?принтер/i.test(text)){
    const volume=text.match(/(\d{2,4})\s*[xх×]\s*(\d{2,4})\s*[xх×]\s*(\d{2,4})\s*мм/i);
    return ['3D принтер FDM',volume?.slice(1).join('x')].filter(Boolean).join(' ');
  }
  if(/бумаг/i.test(item.title)){
    const format=text.match(/[aа][345](?!\d)/i)?.[0]??'';
    return /офсет/i.test(item.title)?'бумага офсетная '+format+' 65 г/м² 500 листов':'бумага офисная '+format+' 80 г/м² 500 листов';
  }
  if(/rhIL|tgf|интерлейкин/i.test(item.title)){
    const identifier=item.title.match(/rhIL\s*-?\s*\d+|TGF\s*(?:beta|β|b)\s*1/i)?.[0]?.replace(/^rh/i,'');
    const mass=text.match(/не менее\s*(\d+)\s*мкг/i)?.[1];
    return [identifier,'human recombinant CHO',mass?mass+' мкг':''].filter(Boolean).join(' ');
  }
  return '';
}
