/* Conservative, deterministic recovery of explicit story time from existing chat.
 * No inferred duration from turn counts, wall-clock timestamps, or message ordering. */
import {uniqKey} from './core.mjs';
const PREFIX='history-time-sync:';
const UNIT={시간:1,일:24,주:168,개월:720,달:720,분:1/60,hour:1,hours:1,day:24,days:24,week:168,weeks:168};
const SKIP=/^(?:\s*(?:<|\{|\[)(?:script|style|system|metadata|ooc|설정|작가노트))/i;
// Exact-duration phrases are candidates; approximate time-of-day changes are review-only.
const KOREAN_NUM={하루:24,이틀:48,사흘:72,나흘:96,닷새:120,엿새:144,이레:168,일주일:168,보름:360,반나절:12,한나절:12};
const LEXICAL=[
 [/\b(?:the\s+)?next\s+day\b/gi,null], [/\b(?:a|one)\s+day\s+later\b/gi,24],
 [/\b(?:the\s+)?following\s+morning\b/gi,null],
 [/\b(?:an|one)\s+hour\s+later\b/gi,1],
 [/(?:그\s*)?다음\s*날|이튿날|익일/g,null],
 [/하룻밤이\s*지나(?:고|서)?|하루가\s*(?:지나|흐르)(?:고|자)?/g,24],
 [/(?:이틀|사흘|나흘|닷새|엿새|이레|일주일|보름|반나절|한나절)\s*(?:뒤|후|지나(?:고|서)?|흐른\s*뒤)/g,null],
 [/(?:다음\s*날\s*아침|다음\s*아침|이튿날\s*아침|날이\s*(?:밝(?:았|아)|새(?:었|고))|밤이\s*지나(?:고|자)|다음\s*날\s*저녁|며칠\s*(?:뒤|후)|몇\s*(?:시간|분|일|주|달)\s*(?:뒤|후)|한참\s*(?:뒤|후)|잠시\s*(?:뒤|후)|곧이어)/g,null],
];
const UNSURE=/(?:약|대략|대충|정도|쯤|가량|남짓|무렵|즈음|아마|것\s*같|듯(?:했|하다)|쯤|쯤|쯤)/;
const CONTEXT=/(?:꿈(?:속|에서)|회상|기억(?:속|에서)|과거|예전에|옛날|만약|가정(?:하면|해)|예를\s*들|했을\s*텐데|일지도|소설\s*속|대사\s*속)/;
function overlap(a,b){return a.start<b.end&&b.start<a.end;}
export function recoverHistoryTime(chat){
 const matches=[],warnings=[],uncertain=[];
 for(let i=0;i<(chat||[]).length;i++){
  const message=chat[i];
  if(!message||message.is_system||typeof message.mes!=='string')continue;
  const text=message.mes.slice(0,45000), key=uniqKey(message,i), occupied=[];
  if(SKIP.test(text.trim()))continue;
  function addTime(start,end,hours,evidence,reason=''){
   if(occupied.some(r=>overlap({start,end},r)))return;
   occupied.push({start,end});
   const context=text.slice(Math.max(0,start-75),Math.min(text.length,end+60));
   const caution=CONTEXT.test(context)?'Возможно воспоминание или предположение, а не текущее событие':reason;
   if(hours===null||caution){
    uncertain.push({key,index:i,offset:start,evidence,reason:caution||'Нельзя определить точное прошедшее время'});
    return;
   }
   if(!Number.isFinite(hours)||hours<=0||hours>8760){warnings.push(`Сообщение ${i+1}: Время выходит за допустимый диапазон`);return;}
   matches.push({key,index:i,offset:start,kind:'time_advance',hours:Math.round(hours*100)/100,evidence,speaker:message.is_user?'USER':'CHAR'});
  }
  // Numerical phrases with explicit passage of time, including "3시간이 흘러", "2일이 지난 후".
  const numerical=/\b(\d+(?:\.\d+)?)\s*(hours?|days?|weeks?)\s*(?:later|passed|elapsed)\b|(?:그로부터\s*)?(\d+(?:\.\d+)?)\s*(시간|일|주|개월|달|분)\s*(?:이|가)?\s*(?:지난\s*(?:뒤|후)|흐른\s*(?:뒤|후)|후|뒤|경과(?:했다|해|함)?|지났다|흘렀다|흘러(?:서|가)?|지나(?:고|서)?)/gi;
  for(const m of text.matchAll(numerical)){
   const amount=Number(m[1]??m[3]), unit=(m[2]??m[4]).toLowerCase();
   let hours=amount*UNIT[unit];
   // Calendar months do not have an exact duration without a calendar anchor.
   if(unit==='개월'||unit==='달')hours=null;
   const snippet=text.slice(Math.max(0,m.index-8),Math.min(text.length,m.index+m[0].length+12));
   addTime(m.index,m.index+m[0].length,hours,m[0],UNSURE.test(snippet)?'Приблизительное указание времени':(hours===null?'Длительность месяца неизвестна без исходной даты':''));
  }
  // Calendar transitions are not automatically equal to 24 elapsed hours.
  for(const m of text.matchAll(/(?:한|두|세|네|몇)\s*(?:달|개월|주|시간|분|일)\s*(?:뒤|후)/g)) {
   if(occupied.some(r=>overlap({start:m.index,end:m.index+m[0].length},r)))continue;
   addTime(m.index,m.index+m[0].length,null,m[0],'Нет точной длительности или исходной календарной даты');
  }
  // Korean lexical durations and day-boundary cues.
  for(const [pattern,value] of LEXICAL){
   for(const m of text.matchAll(pattern)){
    let h=value;
    if(h===null){const label=Object.keys(KOREAN_NUM).find(k=>m[0].startsWith(k));if(label)h=KOREAN_NUM[label];}
    addTime(m.index,m.index+m[0].length,h,m[0]);
   }
  }
  const cycle=/(?:^|[\s\n.!?])(?:(CHAR|USER|캐릭터|유저|상대|나(?:는|의)?|그(?:는|의)?|그녀(?:는|의)?)\s*(?:의|가|는)?\s*)?(히트|러트|heat|rut)\s*(?:가|이|는)?\s*(?:시작(?:됐다|되었다|했다|함)?|발현(?:됐다|되었다|했다)?)/gi;
  for(const m of text.matchAll(cycle)){
   const role=m[1],person=/^(?:USER|유저)$/i.test(role||'')?'user':/^(?:CHAR|캐릭터)$/i.test(role||'')?'char':null;
   if(!person){warnings.push(`Сообщение ${i+1}: Пропущено: неясно, у кого начался цикл (${m[0].trim().slice(0,55)})`);continue;}
   matches.push({key,index:i,offset:m.index,kind:/러트|rut/i.test(m[2])?'rut_start':'heat_start',person,evidence:m[0].trim(),speaker:message.is_user?'USER':'CHAR'});
  }
 }
 matches.sort((a,b)=>a.index-b.index||a.offset-b.offset);
 uncertain.sort((a,b)=>a.index-b.index||a.offset-b.offset);
 const counts=new Map();for(const x of matches)counts.set(x.index,(counts.get(x.index)||0)+1);
 for(const [i,n] of counts)if(n>1)warnings.push(`Сообщение ${i+1}: ${n}указаний времени / цикла. Проверьте, нет ли повторов.`);
 return {matches,warnings,uncertain,scanned:(chat||[]).length};
}
export function removeHistorySync(ledger){
 for(const [key,rec] of Object.entries(ledger||{})){
  if(!rec)continue;
  const hadSync=(rec.events||[]).some(x=>String(x.id||'').startsWith(PREFIX));
  for(const field of ['events','manual'])if(Array.isArray(rec[field]))rec[field]=rec[field].filter(x=>!String(x.id||'').startsWith(PREFIX));
  if(hadSync&&!rec.events?.length&&!rec.manual?.length&&!rec.analyzed)delete ledger[key];
 }
}
export function applyHistorySync(ledger,result,personaId){
 removeHistorySync(ledger);
 for(let i=0;i<result.matches.length;i++){
  const x=result.matches[i];
  const event={id:`${PREFIX}${x.key}:${i}`,kind:x.kind,...(x.hours?{hours:x.hours}:{}),...(x.person?{person:x.person}:{})};
  const rec=ledger[x.key]||{analyzed:false,events:[],manual:[]};
  if(rec.personaId&&rec.personaId!==personaId)continue;
  rec.events=[...rec.events||[],event];
  rec.manual=[...rec.manual||[],event];
  rec.personaId=personaId;
  ledger[x.key]=rec;
 }
}
export function syncedHistoryEventCount(ledger){return Object.values(ledger||{}).reduce((n,r)=>n+(r?.events||[]).filter(e=>String(e.id||'').startsWith(PREFIX)).length,0);}
