/* Opt-in chronological restoration of factual events from an existing RP chat.
 * The analysis model is called by index.js, never by this pure data module.
 * Review events are additions ONLY: manually recorded or earlier analyzed data
 * is never silently deleted or replaced. No turn-count-based time estimates. */
import {uniqKey} from './core.mjs';
import {sharedEvent} from './npc-tracking.mjs';

export const HISTORY_STATE_PREFIX='history-state-review:';
export function collectHistorySources(chat){
 const rows=[],pairedUserIndices=new Set();
 for(let i=0;i<(chat||[]).length;i++){
  const msg=chat[i];
  if(!msg||msg.is_system||!String(msg.mes||'').trim()||msg.is_user)continue;
  const prev=chat[i-1],paired=prev&&!prev.is_system&&prev.is_user&&String(prev.mes||'').trim();
  if(paired)pairedUserIndices.add(i-1);
  rows.push({index:i,key:uniqKey(msg,i),userIndex:paired?i-1:null,userKey:paired?uniqKey(prev,i-1):null,userText:paired?String(prev.mes):'',assistantText:String(msg.mes),speaker:'char'});
 }
 for(let i=0;i<(chat||[]).length;i++){
  const msg=chat[i];
  if(!msg?.is_user||msg.is_system||!String(msg.mes||'').trim()||pairedUserIndices.has(i))continue;
  rows.push({index:i,key:uniqKey(msg,i),userText:String(msg.mes),assistantText:'',speaker:'user'});
 }
 return rows.sort((a,b)=>a.index-b.index);
}
export function historySnapshot(chat){
 return (chat||[]).map((msg,i)=>msg?uniqKey(msg,i):`empty:${i}`).join('|');
}
// Category-level event keys; preserve separate medications, preference tags and other
// disjoint facts but refuse to add a second clock advancement for the same message.
export function eventIdentity(e){
 const who=String(e.person||e.gestator||e.actor||'');
 switch(e.kind){
  case 'time_advance':return 'time_advance';
  case 'scene':case 'scene_unverified':return `scene:${who}`;
  case 'vital_observation':return `vital_observation:${who}`;
  case 'medication':return `medication:${who}:${e.drug||''}:${e.use_mode||''}`;
  case 'preference':return `preference:${who}:${e.preference||''}:${e.level||''}`;
  case 'bond':return `bond:${e.actor||''}:${e.target||''}`;
  case 'bond_loss':return `bond_loss:${e.person||''}:${e.partner||''}`;
  case 'exposure':return `exposure:${e.gestator||''}:${e.donor||''}`;
  case 'pregnancy_reveal':return `pregnancy_reveal:${e.person||''}:${e.knower||''}:${e.level||''}`;
  default:return `${e.kind}:${who}`;
 }
}
export function matchingRecordedEvents(mainRecord,npcRecord,multiNpc){
 const shared=(mainRecord?.events||[]).filter(e=>!multiNpc||sharedEvent(e));
 return multiNpc?[...shared,...(npcRecord?.events||[])]:shared;
}
export function buildHistoryCandidates(sources,results,ledger={},npcLedger={},multiNpc=false,personaId=''){
 const pending=[],duplicates=[],errors=[];
 for(const src of sources){
  const res=results[src.key];
  if(!res||res.error){errors.push({index:src.index,message:res?.error||'Анализ не завершён'});continue;}
  const main=ledger[src.key],npc=npcLedger[src.key];
  const valid=r=>!r?.personaId||r.personaId===personaId;
  // Guard against a previously saved record for another USER persona.
  if((main&&!valid(main))||(multiNpc&&npc&&!valid(npc))){
   errors.push({index:src.index,message:'Прежняя персона USER: исключено из автоматического объединения'});continue;
  }
  const seen=new Set();
  for(let j=0;j<res.events.length;j++){
   const original=res.events[j],{__sourceKey,__sourceIndex,...event}=original;
   const key=__sourceKey||src.key,index=Number.isInteger(__sourceIndex)?__sourceIndex:src.index;
   const relatedMain=ledger[key],relatedNpc=npcLedger[key];
   if((relatedMain&&!valid(relatedMain))||(multiNpc&&relatedNpc&&!valid(relatedNpc))){
    errors.push({index,message:'Прежняя USER конфликт с событиями персоны: объединение пропущено'});continue;
   }
   const identity=eventIdentity(event);
   const sameLocation=matchingRecordedEvents(ledger[key],npcLedger[key],multiNpc);
   // Older versions can save USER-sourced facts on the following bot message.
   const olderLocation=src.key===key?[]:matchingRecordedEvents(ledger[src.key],npcLedger[src.key],multiNpc);
   const known=seen.has(`${key}:${identity}`)||sameLocation.some(e=>eventIdentity(e)===identity)||olderLocation.some(e=>eventIdentity(e)===identity);
   const item={key,index,parentKey:src.key,ordinal:j,identity,event,speaker:src.speaker};
   if(known)duplicates.push(item);
   else{pending.push(item);seen.add(`${key}:${identity}`);}
  }
 }
 return {pending,duplicates,errors};
}
export function appendHistorySelections({ledger,npcLedger,multiNpc=false,personaId,targetId,config,candidates,selectedIds}){
 let applied=0;
 for(const item of candidates){
  const choice=`${item.key}#${item.ordinal}`;
  if(!selectedIds.has(choice))continue;
  const destination=(multiNpc&&!sharedEvent(item.event))?npcLedger:ledger;
  const old=destination[item.key]||{};
  if(old.personaId&&old.personaId!==personaId)throw new Error('Конфликт с записями другой персоны USER');
  const existing=[...matchingRecordedEvents(ledger[item.key],npcLedger[item.key],multiNpc),
   ...(item.parentKey!==item.key?matchingRecordedEvents(ledger[item.parentKey],npcLedger[item.parentKey],multiNpc):[])];
  if(existing.some(e=>eventIdentity(e)===item.identity))continue;
  const event={...item.event,id:`${HISTORY_STATE_PREFIX}${targetId}:${item.key}:${item.ordinal}`,
   ...(item.event.kind==='bond'?{allowMultipleAtCreation:config?.asymmetricBond===true}:{})};
  destination[item.key]={...old,events:[...(old.events||[]),event],manual:old.manual||[],
   personaId,at:Date.now()};
  applied++;
 }
 return applied;
}
export function countHistoryStateEvents(ledger,npcLedger={}){
 return [...Object.values(ledger||{}),...Object.values(npcLedger||{})].reduce((n,r)=>n+(r?.events||[]).filter(e=>String(e.id||'').startsWith(HISTORY_STATE_PREFIX)).length,0);
}
