/* ABO Pixel Tracker · standalone pure state engine. No third-party extension code. */
import {anatomyDefault} from './profile.mjs';
import {initialVitalBaseline,recalculateVitals,validVitalNumber,CONDITION_OBSERVATIONS,PHEROMONE_OBSERVATIONS} from './vitals.mjs';
import {openingMenstruationEvidence} from './menstruation-evidence.mjs';
import {readCycleTiming} from './cycle-settings.mjs';
export const VERSION = 2;
export const PHASE_RATES = Object.freeze({ quiet: .10, prodrome: .40, active: .75, recovery: .35 });
export const INSTINCTS = Object.freeze({
  approach:['alpha','beta','omega'], contact_request:['alpha','beta','omega'],
  protect:['alpha','beta','omega'], jealousy:['alpha','beta','omega'],
  territorial:['alpha','omega'], nesting:['omega'], bond_partner_seek:['alpha','omega']
});
export const COMPATIBLE = Object.freeze({
  male_alpha:['female_alpha','male_omega','female_omega','female_beta'],
  female_alpha:['female_alpha','male_omega','female_omega','female_beta'],
  male_beta:['female_beta']
});
export const DRUGS = Object.freeze({
  oral_suppressant:{adverse:.08,duration:[12,24]},
  long_suppressant:{adverse:.12,duration:[480,1080]},
  emergency_suppressant:{adverse:.10,duration:[4,12]},
  scent_blocker:{adverse:.04,duration:[6,12]},
  symptom_inducer:{adverse:.15,duration:[12,36]},
  cycle_inducer:{adverse:.22,duration:[12,72]},
  unlicensed_mixture:{adverse:.40,duration:[4,72]},
  emergency_contraceptive:{adverse:.10,duration:[0,0]},
  oral_contraceptive:{adverse:.08,duration:[24,24]}
});
export const DEFAULT_CONFIG = Object.freeze({
  enabled:true,autoAnalyze:true,injectState:true,hideTruth:false,pregnancyEnabled:true,asymmetricBond:false,bondBaseSeparationStress:10,bondCycleSeparationStress:20,
  analysisConnection:'',customApiUrl:'',customModel:'',setupMaxTokens:5000,
  rate:{rise:.03,fertile:.14,peak:.30,fall:.06},
  sideEffectScale:1, windowCap:.85,
  oralContraceptiveEffectiveness:.85,emergencyContraceptiveReduction:.75,longSuppressantSuccess:.90,
  style:'pixel',uiTheme:'auto', analysisMaxChars:4500
});
// Symptoms are fictional narrative defaults, never clinical claims.
export const ADVERSE_SYMPTOMS = Object.freeze({
 oral_suppressant:['Головная боль','Головокружение','Временное снижение чувствительности к феромонам'],
 long_suppressant:['Усталость','Изменение температуры тела','Временная нерегулярность цикла'],
 emergency_suppressant:['Тошнота','Ощущение жара','Временная повышенная чувствительность'],
 scent_blocker:['Притупление обоняния','Сухость кожи','Нестабильный остаточный аромат'],
 symptom_inducer:['Ощущение жара','Учащённое сердцебиение','Беспокойство'],
 cycle_inducer:['Дискомфорт в животе','Сильная усталость','Нерегулярное выделение феромонов'],
 unlicensed_mixture:['Резкие изменения температуры тела','Головокружение','Нестабильный контроль феромонов'],
 emergency_contraceptive:['Тошнота','Усталость','Временное изменение цикла'],
 oral_contraceptive:['Головная боль','Тошнота','Лёгкая усталость']
});
const CLAMP=(n,lo,hi)=>Math.min(hi,Math.max(lo,n));
export const clamp=CLAMP;
export function hash(s){let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');}
export function dice(seed,tag){return parseInt(hash(`${seed}:${tag}`),16)/4294967296;}
export function pickInt(seed,tag,lo,hi){return lo+Math.floor(dice(seed,tag)*(hi-lo+1));}
export function uniqKey(m,i){const swipe=Number.isInteger(m?.swipe_id)?m.swipe_id:0;const text=String(m?.mes??'');return`${i}:${swipe}:${hash(text)}`;}
export function normalizeSex(raw){const v=String(raw||'').toLowerCase().trim();return ['male','남성','남자','m'].includes(v)?'male':['female','여성','여자','f'].includes(v)?'female':['nonbinary','non-binary','논바이너리'].includes(v)?'nonbinary':'unknown';}
export function normalizeABO(raw){const v=String(raw||'').toLowerCase().trim();return ['alpha','알파','a'].includes(v)?'alpha':['beta','베타','b'].includes(v)?'beta':['omega','오메가','o'].includes(v)?'omega':'unknown';}
export function inferExplicit(text){
 const s=String(text||'').slice(0,13000);
 const sexMatches=[...s.matchAll(/(?:^|[\s\n\[:(])(?:gender|성별|sex)\s*[:：=]\s*(male|female|남성|여성|남자|여자|nonbinary|논바이너리)(?=$|[^\p{L}\p{N}_])/igu)];
 const aboMatches=[...s.matchAll(/(?:^|[\s\n\[:(])(?:secondary\s*(?:sex|gender)|제2성별|2차\s*성별|abo)\s*[:：=]\s*(alpha|beta|omega|알파|베타|오메가)(?=$|[^\p{L}\p{N}_])/igu)];
 const shapeMatches=[...s.matchAll(/(?:anatomy|신체\s*유형|생식기\s*유형)\s*[:：=]\s*(female_alpha_combined|female_only|combined|vaginal_only|male_only|복합형|컨트보이형|남성\s*생식기형|여성\s*생식기형|여성\s*알파\s*복합형)/ig)];
 const shape=shapeMatches.length?shapeMatches.at(-1)[1].toLowerCase():null;
 return {sex:sexMatches.length?normalizeSex(sexMatches.at(-1)[1]):'unknown',secondary:aboMatches.length?normalizeABO(aboMatches.at(-1)[1]):'unknown',anatomy:shape===null?null:shape==='컨트보이형'?'vaginal_only':shape.includes('여성')&&shape.includes('복합')?'female_alpha_combined':shape.includes('여성')?'female_only':shape.includes('남성')?'male_only':shape==='복합형'?'combined':shape};
}
export function person(id,name,seed,canon={}){
 const sex=normalizeSex(canon.sex);
 const secondary=normalizeABO(canon.secondary)||'unknown';
 const abo=secondary; // Unspecified means unspecified; never silently roll a fictional ABO type.
 const omegaMale=sex==='male'&&abo==='omega';
 const vitalBaseline=initialVitalBaseline(canon,abo,name);
 const interval=abo==='omega'?pickInt(seed,`${id}:interval`,20,35):pickInt(seed,`${id}:interval`,30,90);
 const prodrome=abo==='omega'?pickInt(seed,`${id}:prodrome`,6,48):pickInt(seed,`${id}:prodrome`,6,24);
 const active=abo==='omega'?pickInt(seed,`${id}:active`,3,7)*24:pickInt(seed,`${id}:active`,1,3)*24;
 const recovery=abo==='omega'?pickInt(seed,`${id}:recovery`,12,72):pickInt(seed,`${id}:recovery`,12,48);
 return {
  id,identityId:String(canon.id||''),name:String(name||id),sex,secondary:abo,source:{sex:sex!=='unknown'?'card':'unknown',secondary:secondary!=='unknown'?'card':'unset'},
  locks:{},anatomy:canon.anatomy||anatomyDefault(sex,abo),anatomyDetail:canon.anatomyDetail||'',inseminationOrgan:canon.inseminationOrgan||'',
  presentation:{pheromoneScent:canon.pheromoneScent||'',contactStyle:canon.contactStyle||'',vocalStyle:canon.vocalStyle||'',speechStyle:canon.speechStyle||''},
  cycle:{enabled:['alpha','omega'].includes(abo),mode:abo==='unknown'?'unset':abo==='beta'?'absent':'enabled',intervalHours:interval*24,prodromeHours:prodrome,activeHours:active,recoveryHours:recovery,anchorHour:interval*24, phase:'quiet',ovulationHour:null},
  menstruation:{enabled:omegaMale||sex==='female',days:pickInt(seed,`${id}:menses`,3,7),
    // Explicit opening-period evidence, unlike menstruation eligibility, sets a current period.
    ...(openingMenstruationEvidence(canon.openingMenstruationText||canon.card)?{anchorHour:0,source:'opening'}:{})},
  fertile:{gestate:(abo==='omega'||sex==='female'&&['alpha','beta'].includes(abo)),impregnate:abo==='alpha'||(sex==='male'&&abo==='beta')},
  vitalBaseline:{condition:vitalBaseline.condition,emission:vitalBaseline.emission,source:vitalBaseline.source,reasons:vitalBaseline.reasons},
  vitalObservation:null,
  body:{condition:vitalBaseline.condition,fatigue:20,desire:25,sensitivity:35,emission:vitalBaseline.emission,stress:20,resistance:50,instinct:50},
  pheromone:{emission:vitalBaseline.emission,sensitivity:50,control:50,pressure:50},
  medication:[],tolerance:{},adverse:[], preferences:canon.preferences?structuredClone(canon.preferences):{confirmed:[],latent:[],attitude:'curious'},
  awareness:{pregnancy:'unaware'},bondWith:null,bondPartners:[],permanentMark:null,
  pregnancy:{status:'none',conceivedAt:null,implantAt:null,dueAt:null,deliveryAt:null},
  scene:{posture:'',contact:'',vocal:'',speech:'',play:[]},recentScenes:[]
 };
}
export function initialState(seed,canon={},config={}){
 return {schema:VERSION,seed,clockHours:0,
 people:{char:person('char',canon.char?.name||'CHAR',canon.char?.id?`${seed}:${canon.char.id}`:seed,canon.char),user:person('user',canon.user?.name||'USER',seed,canon.user)},
 bonds:[],affinity:{},windows:{},events:[],alerts:[],config:{...DEFAULT_CONFIG,...config,rate:{...DEFAULT_CONFIG.rate,...(config.rate||{})}}};
}
export function areCompatible(source,target){
 if(source===target)return false;
 const a=`${source.sex}_${source.secondary}`;
 const b=`${target.sex}_${target.secondary}`;
 if(source.sex==='unknown'||target.sex==='unknown')return false;
 return !!(COMPATIBLE[a]||[]).includes(b) && source.fertile.impregnate && target.fertile.gestate;
}
export function rangeProbability(offset,conf){
 if(!Number.isFinite(offset))return 0;
 if(offset < -72 || offset>=24)return 0;
 if(offset< -48)return conf.rate.rise;
 if(offset< -24)return conf.rate.fertile;
 if(offset<12)return conf.rate.peak;
 return conf.rate.fall;
}
function stoppedCycleWindow(c,time){
 if(!Number.isFinite(c.endedHour)||!Number.isFinite(c.resumeHour)||time<c.endedHour||time>=c.resumeHour)return null;
 const quietAt=Math.min(c.resumeHour,c.endedHour+c.recoveryHours);
 return {quietAt,prodromeAt:Math.max(quietAt,c.resumeHour-c.prodromeHours),nextStart:c.resumeHour};
}
export function phaseAt(c,t){
 if(!c?.enabled||!Number.isFinite(c.intervalHours)||c.intervalHours<=0)return'quiet';
 const stopped=stoppedCycleWindow(c,t);
 if(stopped)return t<stopped.quietAt?'recovery':t>=stopped.prodromeAt?'prodrome':'quiet';
 const remaining=((t-c.anchorHour)%c.intervalHours+c.intervalHours)%c.intervalHours;
 if(t<c.anchorHour && t>=c.anchorHour-c.prodromeHours)return'prodrome';
 if(t<c.anchorHour)return'quiet';
 if(remaining<c.activeHours)return'active';
 if(remaining<c.activeHours+c.recoveryHours)return'recovery';
 if(c.intervalHours-remaining<=c.prodromeHours)return'prodrome';
 return 'quiet';
}
/** Read-only forecast: story hours only; does not modify a profile or infer elapsed time. */
export function cycleForecast(p, time, seed=''){
 const mode=cycleMode(p), c=p?.cycle||{}, m=p?.menstruation||{};
 const pregnancy=p?.pregnancy?.status||'none';
 const paused=['conception_pending','pregnant_unaware','pregnant_suspected','pregnant_confirmed','due','postpartum'].includes(pregnancy);
 const result={mode,phase:paused?'paused':phaseForPerson(p,time),currentEndHours:null,nextProdromeHours:null,nextActiveHours:null,nextRecoveryHours:null,nextQuietHours:null,nextMenstruationHours:null,menstruationEndHours:null,menstruationStatus:m.enabled?'unknown':'absent',paused};
 if(mode==='enabled'&&!paused&&Number.isFinite(c.intervalHours)&&c.intervalHours>0){
  const interval=c.intervalHours, active=Math.max(0,Number(c.activeHours)||0), recovery=Math.max(0,Number(c.recoveryHours)||0),prodrome=Math.max(0,Number(c.prodromeHours)||0);
  const n=Math.ceil((time-c.anchorHour)/interval);
  let next=c.anchorHour+n*interval;
  if(next<time-1e-7)next+=interval;
  const starts=[next-interval,next,next+interval];
  const nextAt=(shift)=>{const arr=starts.filter(x=>x>=c.anchorHour-1e-7).map(x=>x+shift).filter(x=>x>=time-1e-7);return arr.length?Math.max(0,Math.min(...arr)-time):null;};
  result.nextActiveHours=nextAt(0);
  result.nextRecoveryHours=nextAt(active);
  result.nextQuietHours=nextAt(active+recovery);
  result.nextProdromeHours=nextAt(-prodrome);
  const current=result.phase;
  if(current==='prodrome')result.currentEndHours=result.nextActiveHours;
  else if(current==='active')result.currentEndHours=result.nextRecoveryHours;
  else if(current==='recovery')result.currentEndHours=result.nextQuietHours;
  else if(current==='quiet')result.currentEndHours=result.nextProdromeHours;
  const stopped=stoppedCycleWindow(c,time);
  if(stopped){
   result.nextActiveHours=stopped.nextStart-time;
   result.nextRecoveryHours=stopped.nextStart+active-time;
   result.nextQuietHours=time<stopped.quietAt?stopped.quietAt-time:stopped.nextStart+active+recovery-time;
   result.nextProdromeHours=time<stopped.prodromeAt?stopped.prodromeAt-time:stopped.nextStart+interval-prodrome-time;
   result.currentEndHours=current==='recovery'?stopped.quietAt-time:current==='quiet'?stopped.prodromeAt-time:stopped.nextStart-time;
  }
  if(c.inducedUntil>time){result.phase='active';result.currentEndHours=Math.max(0,c.inducedUntil-time);}
 }
 if(!m.enabled){result.menstruationStatus='absent';return result;}
 if(paused){result.menstruationStatus='paused';return result;}
 const days=Math.max(1,Number(m.days)||1)*24;
 // A real described start (opening/manual) takes priority over inferred ovulation.
 // The end event can stop an ongoing period even without a story-time advance.
 if(Number.isFinite(m.anchorHour)){
  const interval=Number(m.intervalHours)>0?Number(m.intervalHours):Number(c.intervalHours)>0?Number(c.intervalHours):28*24;
  const elapsed=time-m.anchorHour;
  if(elapsed<0){result.menstruationStatus='waiting';result.nextMenstruationHours=-elapsed;return result;}
  const index=Math.floor(elapsed/interval);
  const start=m.anchorHour+index*interval;
  const manuallyEnded=Number.isFinite(m.endedHour)&&m.endedHour>=start&&m.endedHour<=time;
  if(time<start+days&&!manuallyEnded){
   result.menstruationStatus='active';result.menstruationEndHours=start+days-time;
  }else result.menstruationStatus='waiting';
  result.nextMenstruationHours=start+interval-time;
  return result;
 }
 let first=null,interval=null;
 if(p.secondary==='beta'&&p.sex==='female'){
  interval=Number(m.intervalHours)>0?Number(m.intervalHours):28*24;
  first=Number.isFinite(m.anchorHour)?m.anchorHour:28*24; // independent of heat/rut
 }else if(mode==='enabled'&&Number.isFinite(c.intervalHours)&&c.intervalHours>0){
  interval=c.intervalHours;
  const luteal=pickInt(seed,`${p.id}:luteal`,11,16)*24;
  if(p.secondary==='omega') first=c.anchorHour+c.activeHours/2+luteal;
  else if(p.sex==='female'&&p.secondary==='alpha')first=c.anchorHour+(c.ovulationSide==='post'?c.activeHours+12:-12)+luteal;
 }
 if(first===null||!Number.isFinite(interval)||interval<=0){result.menstruationStatus='unknown';return result;}
 const k=Math.max(0,Math.floor((time-first)/interval)),start=first+k*interval;
 if(time>=start&&time<start+days){result.menstruationStatus='active';result.menstruationEndHours=start+days-time;result.nextMenstruationHours=start+interval-time;}
 else{result.menstruationStatus='waiting';result.nextMenstruationHours=(time<first?first:start+interval)-time;}
 return result;
}
export function ovulationHour(p,time){
 if(Number.isFinite(p.cycle.ovulationHour))return p.cycle.ovulationHour;
 if(p.secondary==='omega' && p.cycle.enabled){
  const c=p.cycle;
  const k=Math.round((time-(c.anchorHour+c.activeHours/2))/c.intervalHours);
  return c.anchorHour+Math.max(0,k)*c.intervalHours+c.activeHours/2;
 }
 if(p.sex==='female'&&p.secondary==='alpha'&&p.cycle.enabled){
  const c=p.cycle,k=Math.round((time-c.anchorHour)/c.intervalHours);
  const start=c.anchorHour+Math.max(0,k)*c.intervalHours;
  return start+(p.cycle.ovulationSide==='post'?c.activeHours+12:-12);
 }
 if(p.sex==='female'&&p.secondary==='beta'){
  const days=28*24, k=Math.round((time-14*24)/days);return 14*24+Math.max(0,k)*days;
 }
 return null;
}
export function encounterChance(single,n){
 const p=CLAMP(single,0,1), count=CLAMP(Number(n)||1,1,30);
 if(count===1)return p;
 return 1-Math.pow(1-p,1+.5*(1-Math.exp(-.9*(count-1))));
}
export function pairMultiplier(donor,gestator,clock){
 const dp=phaseAt(donor.cycle,clock), gp=phaseAt(gestator.cycle,clock);
 if(donor.secondary==='alpha'&&gestator.secondary==='omega'){
  if(dp==='active'&&gp==='active')return 1.8;
  if(dp==='active'||gp==='active')return 1.4;
  return 1.1;
 }
 if(donor.secondary==='alpha'&&gestator.secondary==='alpha'&&donor.sex==='female'&&gestator.sex==='female'&&dp==='active'&&gp==='active')return 1.1;
 return 1.1; // ovulation-stage small elevation, never stacks with other multipliers
}
export function activeContraceptionFactor(state,gestator,time=state.clockHours){
 const p=state.people[gestator];if(!p)return 1;
 const effectiveness=CLAMP(Number(state.config.oralContraceptiveEffectiveness??.85),0,1);
 // Only a confirmed NORMAL dose with an active simulated protection interval counts.
 // Doses mentioned in dialogue but not confirmed are never added to medication[].
 return p.medication.some(m=>m.drug==='oral_contraceptive'&&m.mode==='normal'&&m.at<=time&&m.until>time)
  ? 1-effectiveness : 1;
}
export function eventChance(state,event){
 if(state.config.pregnancyEnabled===false)return {p:0,reason:'pregnancy_disabled'};
 const g=state.people[event.gestator],d=state.people[event.donor];
 if(!g||!d||!areCompatible(d,g)||event.penetration!==true||event.deposition!==true)return {p:0,reason:'gate_failed'};
 if(g.pregnancy.status!=='none')return {p:0,reason:'already_pregnant'};
 const ov=ovulationHour(g,state.clockHours);
 const offset=Number.isFinite(ov)?state.clockHours-ov:NaN;
 const base=rangeProbability(offset,state.config);
 if(!base)return {p:0,reason:Number.isFinite(ov)?'outside_fertile_window':'ovulation_unknown'};
 const personF=CLAMP(Number(event.gestatorFertility)||1,0,3)*CLAMP(Number(event.donorFertility)||1,0,3);
 const contraceptive=CLAMP(Number.isFinite(event.contraceptiveFactor)?event.contraceptiveFactor:1,0,1)*activeContraceptionFactor(state,event.gestator);
 if(g.cycle.ovulationBlockedUntil>=state.clockHours)return {p:0,reason:'ovulation_suppressed'};
 const p=CLAMP(base*pairMultiplier(d,g,state.clockHours)*personF*contraceptive,0,1);
 return {p:encounterChance(p,event.depositions||1),reason:'qualified',ov};
}
/** Only enabled heat/rut profiles have an ABO cycle. Stored numeric timings may
 * remain in older chats for compatibility but are not an active cycle. */
export function cycleDisplay(p){
 const enabled=p?.cycle?.enabled===true;
 return {
  enabled,
  phase:enabled?(p.cycle.phase||'quiet'):'none',
  intervalDays:enabled?p.cycle.intervalHours/24:null,
  prodromeHours:enabled?p.cycle.prodromeHours:null,
  activeDays:enabled?p.cycle.activeHours/24:null,
  recoveryHours:enabled?p.cycle.recoveryHours:null
 };
}
export function phaseForPerson(p,time){
 if(!p.cycle?.enabled)return 'quiet';
 if(['conception_pending','pregnant_unaware','pregnant_suspected','pregnant_confirmed','due'].includes(p.pregnancy.status))return 'suspended';
 if(p.pregnancy.status==='postpartum'&&time<p.cycle.anchorHour)return 'recovery';
 if(p.cycle.inducedUntil>time)return 'active';
 return phaseAt(p.cycle,time);
}
export function menstruationPhase(p,time,seed){
 const status=cycleForecast(p,time,seed).menstruationStatus;
 return status==='active'?'menstruating':status==='waiting'?'not_menstruating':status==='unknown'?'unknown':'none';
}
export function sideEffectChance(drug,conf={}){return CLAMP((DRUGS[drug]?.adverse||0)*(conf.sideEffectScale??1),0,1);}
export function adverseSymptoms(seed,event){
 const list=ADVERSE_SYMPTOMS[event.drug]||[];
 return list.length?[list[pickInt(seed,`symptom:${event.id}:${event.drug}`,0,list.length-1)]]:[];
}
export function toleranceChange(seed,event){
 if(event.use_mode==='normal')return 0;
 const [lo,hi]=event.use_mode==='misuse'?[6,10]:event.use_mode==='unlicensed'?[7,14]:[0,0];
 return pickInt(seed,`${event.id}:tolerance`,lo,hi);
}
export function instinctChance(p,phase,{nearBond=false,separatedFromBond=false}={}){
 const base=PHASE_RATES[phase]??.10;
 const sensitivity=(CLAMP(p.body.instinct,0,100)-50)/500;
 const resistance=(50-CLAMP(p.body.resistance,0,100))/500;
 const bonded=p.bondWith && (separatedFromBond?.12:nearBond?.08:0);
 return CLAMP(base+sensitivity+resistance+(bonded||0),0,1);
}
export const BOND_EFFECTS=Object.freeze({partnerScentSensitivity:20,otherScentSensitivity:-30,otherScentDiscomfort:15,heatSeparationStress:20});
export function cycleMode(p){
 const mode=p?.cycle?.mode;
 if(['enabled','disabled','absent','unset'].includes(mode))return mode;
 return p?.cycle?.enabled===true?'enabled':'disabled'; // backward compatibility
}
export function bondSeparationStress(state,id,{separated=false}={}){
 const p=state.people[id],effects=bondEffects(state,id);
 if(!p||!effects?.active||!separated)return {base:0,cycle:0,total:0};
 const partnerActive=effects.partners.some(pid=>{
   const q=state.people[pid];return q&&cycleMode(q)==='enabled'&&q.cycle.phase==='active';
 });
 const selfActive=cycleMode(p)==='enabled'&&p.cycle.phase==='active';
 const base=Number(state.config.bondBaseSeparationStress??10);
 const cycle=(selfActive||partnerActive)?Number(state.config.bondCycleSeparationStress??20):0;
 return {base,cycle,total:base+cycle}; // heat/rut bonus never stacks twice
}
export function effectivePheromoneResponse(state,id){
 const p=state.people[id];if(!p)return null;
 const effect=bondEffects(state,id);
 return {partnerSensitivity:CLAMP(p.pheromone.sensitivity+(effect?.partnerScentSensitivity||0),0,100),
 otherSensitivity:CLAMP(p.pheromone.sensitivity+(effect?.otherScentSensitivity||0),0,100),
 otherDiscomfort:effect?.otherScentDiscomfort||0};
}

export function bondEffects(state,id){
 const p=state.people[id];if(!p)return null;
 const partners=(state.bonds||[]).filter(b=>b.includes(id)).map(b=>b.find(v=>v!==id));
 if(!partners.length)return null;
 const applies=!state.config.asymmetricBond||p.secondary==='omega';
 return {partners,active:applies,...Object.fromEntries(Object.entries(BOND_EFFECTS).map(([k,v])=>[k,applies?v:0]))};
}
function refreshBondLinks(state){
 for(const person of Object.values(state.people)){
  const partners=state.bonds.filter(pair=>pair.includes(person.id)).map(pair=>pair.find(id=>id!==person.id));
  person.bondPartners=partners;person.bondWith=partners[0]||null;
  const former=person.permanentMark;person.permanentMark=person.secondary==='omega'&&partners.length?{alpha:partners[0],location:'nape',at:former?.alpha===partners[0]?former.at:state.clockHours}:null;
 }
}
export function allowedInstincts(p){return Object.entries(INSTINCTS).filter(([key,list])=>list.includes(p.secondary)&&(key!=='bond_partner_seek'||!!p.bondWith)).map(([key])=>key);}
export function pressureScore(source,target,state=null){const bond=state?.bonds?.some(pair=>pair.includes(source.id)&&pair.includes(target.id));const response=state?effectivePheromoneResponse(state,target.id):null;const hierarchy=source.secondary==='alpha'&&target.secondary==='omega'?15:0;return CLAMP(source.pheromone.pressure-target.body.resistance+hierarchy+(bond&&response?Math.round((response.partnerSensitivity-target.pheromone.sensitivity)/5):0),0,100);}
const normEvent=(e)=>({...e,id:String(e.id||'unknown').slice(0,100)});
function updateCycles(state){
 for(const p of Object.values(state.people)){
  p.cycle.phase=phaseForPerson(p,state.clockHours);
  p.menstruation.phase=menstruationPhase(p,state.clockHours,state.seed);
  if(state.config.pregnancyEnabled===false)continue;
  if(p.pregnancy.status==='conception_pending'&&state.clockHours>=p.pregnancy.implantAt){p.pregnancy.status='pregnant_unaware';}
  if(p.pregnancy.status==='postpartum'&&state.clockHours>=p.cycle.anchorHour){p.pregnancy.status='ended';}
  if(p.pregnancy.status.startsWith('pregnant')&&Number.isFinite(p.pregnancy.dueAt)&&state.clockHours>=p.pregnancy.dueAt){p.pregnancy.status='due';}
 }
 // Independent of the pregnancy toggle; refresh both protagonists and registered NPCs.
 for(const p of Object.values(state.people))recalculateVitals(p,state.clockHours);
}
function updateWindow(state,gestator,ovulation){
 if(state.config.pregnancyEnabled===false)return;
 const key=`${gestator}:${ovulation}`;
 const w=state.windows[key]||{id:key,gestator,ovulation,roll:dice(state.seed,state.people[gestator]?.identityId?`fertile:${state.people[gestator].identityId}:${key}`:`fertile:${key}`),exposures:[],total:0};
 state.windows[key]=w;
 let chance=0;
 for(const x of w.exposures){chance=1-(1-chance)*(1-CLAMP(x.p*x.emergencyFactor,0,1));}
 w.total=CLAMP(chance,0,state.config.windowCap??.85);
 const p=state.people[gestator];
 const passed=state.clockHours>=Math.max(...w.exposures.map(e=>e.t+72),-Infinity);
 if(p.pregnancy.status==='none'&&w.roll<w.total && passed){
   let rolling=0,early=w.exposures.at(-1)?.t??state.clockHours;
   for(const exposure of w.exposures){rolling=1-(1-rolling)*(1-CLAMP(exposure.p*exposure.emergencyFactor,0,1));if(w.roll<CLAMP(rolling,0,state.config.windowCap??.85)){early=exposure.t;break;}}
   const implantation=pickInt(state.seed,`implant:${key}`,5,10)*24;
   const term=pickInt(state.seed,`term:${key}`,120,180)*24;
   p.pregnancy={status:state.clockHours>=early+implantation?'pregnant_unaware':'conception_pending',conceivedAt:early,implantAt:early+implantation,dueAt:early+term,deliveryAt:null};
   state.alerts.push(`${p.name}: internally confirmed conception (character awareness remains separate)`);
 }
}
function applyPreference(p,e){
 const id=String(e.preference||'').slice(0,80);if(!id)return;
 const label=(typeof e.label==='string'&&/[가-힣]/u.test(e.label))?e.label.trim().slice(0,80):'';
 const levels=['latent','liked','strongly_liked','disliked','restricted'];
 if(!levels.includes(e.level))return;
 const all=[...p.preferences.confirmed,...p.preferences.latent];
 const old=all.find(x=>x.id===id);
 if(old?.locked)return;
 if(e.level==='latent'){
  if(old)return;
  if(p.preferences.latent.length<5)p.preferences.latent.push({id,...(label?{label}:{}),level:e.level,source:e.source||'event',evidence:[e.id]});
  return;
 }
 const direct=e.direct===true;
 const evidences=[...new Set([...(old?.evidence||[]),e.sceneId||e.id])];
 if(!direct&&evidences.length<2){
  if(!old&&p.preferences.latent.length<5)p.preferences.latent.push({id,...(label?{label}:{}),level:'latent',source:'observed',evidence:evidences});
  else if(old){old.evidence=evidences;if(label)old.label=label;}
  return;
 }
 p.preferences.latent=p.preferences.latent.filter(x=>x.id!==id);
 p.preferences.confirmed=p.preferences.confirmed.filter(x=>x.id!==id);
 p.preferences.confirmed.push({id,...(label?{label}:{...(old?.label?{label:old.label}:{})}),level:e.level,source:e.source||'event',evidence:evidences});
}
export function applyEvent(state,input){
 const e=normEvent(input),p=state.people[e.person];
 if(state.events.some(x=>x.id===e.id))return;
 if(state.events.length>600)state.events.shift();
 switch(e.kind){
 case 'time_advance':{
  const hours=Number(e.hours);
  if(Number.isFinite(hours)&&hours>=0&&hours<=8760){state.clockHours+=hours;for(const w of Object.values(state.windows))updateWindow(state,w.gestator,w.ovulation);}
  break;
 }
 case 'menstruation_start':{
  if(p?.menstruation?.enabled){
   p.menstruation.anchorHour=state.clockHours;
   p.menstruation.endedHour=null;
   p.menstruation.source='manual';
  }
  break;
 }
 case 'menstruation_end':{
  if(p?.menstruation?.enabled&&cycleForecast(p,state.clockHours,state.seed).menstruationStatus==='active'){
   p.menstruation.endedHour=state.clockHours;
  }
  break;
 }
 case 'heat_start':case 'rut_start':{
  if(p&&p.cycle.enabled){
   p.cycle.anchorHour=state.clockHours;p.cycle.ovulationHour=null;
   delete p.cycle.endedHour;delete p.cycle.resumeHour;
  }
  break;
 }
 case 'heat_end':case 'rut_end':{
  if(p?.cycle.enabled&&phaseForPerson(p,state.clockHours)==='active'){
   const c=p.cycle;
   // Finish only this episode; keep the next scheduled start and all past events.
   c.endedHour=state.clockHours;
   c.resumeHour=c.anchorHour+Math.max(0,Math.floor((state.clockHours-c.anchorHour)/c.intervalHours)+1)*c.intervalHours;
   c.inducedUntil=null;
  }
  break;
 }
 case 'ovulation':if(p?.fertile.gestate)p.cycle.ovulationHour=state.clockHours;break;
 case 'npc_register':{
  const key=String(e.person||'');
  if(!/^npc:[a-z0-9_-]{2,48}$/i.test(key)||state.people[key])break;
  if(!['alpha','omega','beta'].includes(e.secondary)||typeof e.name!=='string'||!e.name.trim())break;
  state.people[key]=person(key,e.name.slice(0,80),`${state.seed}:${key}`,{secondary:e.secondary,sex:'unknown',id:key});
  break;
 }
 case 'bond':{
  // Strict role direction and bite location; reject ambiguous or swapped participants.
  const a=state.people[e.actor||e.person],b=state.people[e.target||e.partner];
  // A permanent bite at an Omega's pheromone-sensitive nape establishes the bond.
  // Consent is not a mechanical prerequisite; narrative agency remains governed by RP rules.
  if(!a||!b||a===b)break;
  const alpha=a.secondary==='alpha'?a:null;
  const omega=b.secondary==='omega'?b:null;
  if(e.biteLocation!=='pheromone_nape'||e.biteConfirmed!==true)break;
  if(!alpha||!omega)break;
  if(state.bonds.some(pair=>pair.includes(alpha.id)&&pair.includes(omega.id)))break;
  // Omega always has one Alpha; OFF also limits Alpha to one Omega.
  if(state.bonds.some(pair=>pair.includes(omega.id)))break;
  if(!(e.allowMultipleAtCreation===true||state.config.asymmetricBond)&&state.bonds.some(pair=>pair.includes(alpha.id)))break;
  state.bonds.push([alpha.id,omega.id]);refreshBondLinks(state);
  break;
 }
 case 'bond_loss':{
  // A surgery or documented drug side effect can sever a bond, never an ordinary time advance.
  if(!['surgery','drug_adverse','death'].includes(e.cause))break;
  const a=state.people[e.person],b=state.people[e.partner];if(!a||!b)break;
  state.bonds=state.bonds.filter(pair=>!(pair.includes(a.id)&&pair.includes(b.id)));
  refreshBondLinks(state);break;
 }
 case 'medication':{
  if(!p||!DRUGS[e.drug])break;
  const c=toleranceChange(state.seed,e),old=p.tolerance[e.drug]||0;
  p.tolerance[e.drug]=CLAMP(old+c,0,100);
  const adverse=dice(state.seed,`adverse:${e.id}`)<sideEffectChance(e.drug,state.config);
  const duration=pickInt(state.seed,`duration:${e.id}`,...DRUGS[e.drug].duration);
  p.medication.push({id:e.id,drug:e.drug,mode:e.use_mode||'normal',at:state.clockHours,until:state.clockHours+duration,adverse});
  if(adverse)p.adverse.push({id:e.id,drug:e.drug,at:state.clockHours,until:state.clockHours+Math.max(12,Math.min(duration||24,72)),type:'general',symptoms:adverseSymptoms(state.seed,e)});
  if(e.drug==='long_suppressant'&&dice(state.seed,`ovulation:block:${e.id}`)<CLAMP(Number(state.config.longSuppressantSuccess??.90),0,1)){p.cycle.ovulationHour=null;p.cycle.ovulationBlockedUntil=state.clockHours+duration;}
  const reboundChances={oral_suppressant:.02,long_suppressant:.05,unlicensed_mixture:.25};
  const drugRisk=reboundChances[e.drug]??0;
  if(drugRisk&&dice(state.seed,`induced-adverse:${e.id}`)<drugRisk){
   p.cycle.inducedUntil=state.clockHours+pickInt(state.seed,`induced-length:${e.id}`,12,48);
   p.adverse.push({id:`${e.id}:induced`,drug:e.drug,at:state.clockHours,type:'unexpected_heat_or_rut'});
  }
  if(['symptom_inducer','cycle_inducer'].includes(e.drug)){
   if(e.drug==='cycle_inducer'&&p.cycle.enabled){p.cycle.anchorHour=state.clockHours;p.cycle.ovulationHour=null;delete p.cycle.endedHour;delete p.cycle.resumeHour;}
   p.cycle.inducedUntil=state.clockHours+duration;
  }
  if(e.drug==='emergency_contraceptive'){
   for(const w of Object.values(state.windows)){
    if(w.gestator!==e.person)continue;
    for(const x of w.exposures)if(state.clockHours-x.t<=72&&state.clockHours>=x.t)x.emergencyFactor=1-CLAMP(Number(state.config.emergencyContraceptiveReduction??.75),0,1);
    updateWindow(state,e.person,w.ovulation);
   }
  }
  break;
 }
 case 'exposure':{
  const out=eventChance(state,e);if(out.p<=0){state.alerts.push(`Exposure not rolled: ${out.reason}`);break;}
  const key=`${e.gestator}:${out.ov}`,w=state.windows[key]||{id:key,gestator:e.gestator,ovulation:out.ov,roll:dice(state.seed,state.people[e.gestator]?.identityId?`fertile:${state.people[e.gestator].identityId}:${key}`:`fertile:${key}`),exposures:[],total:0};
  if(!w.exposures.some(x=>x.id===e.id))w.exposures.push({id:e.id,t:state.clockHours,p:out.p,emergencyFactor:1,depositions:CLAMP(Number(e.depositions)||1,1,30)});
  state.windows[key]=w;updateWindow(state,e.gestator,out.ov);
  break;
 }
 case 'pregnancy_reveal':{
  if(state.config.pregnancyEnabled===false)break;
  if(p&&['char','user'].includes(e.knower)&&['suspected','confirmed'].includes(e.level)){
   state.people[e.knower].awareness.pregnancy=e.level;
  }
  break;
 }
 case 'delivery':{
  if(state.config.pregnancyEnabled===false)break;
  if(p&&p.pregnancy.status!=='none'){
   p.pregnancy.status='postpartum';p.pregnancy.deliveryAt=state.clockHours;
   p.cycle.anchorHour=state.clockHours+pickInt(state.seed,`recover:${e.id}`,28,42)*24;
  }break;
 }
 case 'pregnancy_end':if(p&&state.config.pregnancyEnabled!==false){p.pregnancy.status='ended';p.cycle.anchorHour=state.clockHours+pickInt(state.seed,`recover:${e.id}`,28,42)*24;}break;
 case 'vital_observation':if(p){
   const cond=Object.hasOwn(CONDITION_OBSERVATIONS,e.condition)?e.condition:null;
   const pher=Object.hasOwn(PHEROMONE_OBSERVATIONS,e.emission)?e.emission:null;
   if(cond!==null||pher!==null){
    p.vitalObservation={at:state.clockHours,condition:cond,emission:pher};
   }
   break;
 }
 case 'preference':if(p)applyPreference(p,e);break;
 case 'scene':if(p){
   // A scene observation is a complete snapshot, never a merge with an old pose.
   const previous=p.scene||{};
   const next={posture:'',contact:'',vocal:'',speech:'',play:[]};
   for(const f of ['posture','contact','vocal','speech'])if(typeof e[f]==='string')next[f]=e[f].slice(0,90);
   if(Array.isArray(e.play))next.play=e.play.filter(x=>typeof x==='string').slice(0,8);
   if(e.completed===true){
    const finished=Object.values(next).some(v=>Array.isArray(v)?v.length:!!v)?next:previous;
    if(Object.values(finished).some(v=>Array.isArray(v)?v.length:!!v)){
     p.recentScenes.push({at:state.clockHours,...finished});p.recentScenes=p.recentScenes.slice(-3);
    }
    p.scene={...next,verified:false,posture:'',contact:'',vocal:'',speech:'',play:[]};
   }else p.scene={...next,verified:true};
   break;
 }
 case 'scene_unverified':if(p){
   // Preserve saved history; do not represent an old snapshot as a current fact.
   p.scene={posture:'',contact:'',vocal:'',speech:'',play:[],verified:false};
   break;
 }
 }
 state.events.push({id:e.id,kind:e.kind,person:e.person||null,at:state.clockHours,...(e.kind==='time_advance'&&Number.isFinite(Number(e.hours))?{hours:Number(e.hours)}:{})});
 updateCycles(state);
}
export function replay(seed,canon,config,rows,overrides={}){
 const s=initialState(seed,canon,config);
 // Apply manual overrides BEFORE replaying events. This is essential: fertility gates
 // and cycle eligibility must be computed from the user's corrected canonical facts.
 for(const [who,changes] of Object.entries(overrides)){
  const p=s.people[who];if(!p)continue;
  for(const [k,v] of Object.entries(changes||{})){
   if(k==='sex')p.sex=normalizeSex(v);
   else if(k==='secondary')p.secondary=normalizeABO(v);
   else if(k==='anatomy'&&['combined','vaginal_only','male_only','female_only','female_alpha_combined','custom'].includes(v))p.anatomy=v;
   else if(k==='anatomyDetail'||k==='inseminationOrgan')p[k]=String(v).slice(0,1200);
   else if(['pheromoneScent','contactStyle','vocalStyle','speechStyle'].includes(k))p.presentation[k]=String(v).slice(0,220);
   else if(k==='name')p.name=String(v).slice(0,100);
   else if(k==='cycleMode'&&['enabled','disabled','absent','unset'].includes(v)){p.cycle.mode=v;p.cycle.enabled=v==='enabled';}
   else if(k==='cycleEnabled'){p.cycle.enabled=!!v;p.cycle.mode=v?'enabled':'disabled';}
   else if(k==='gestate')p.fertile.gestate=!!v;
   else if(k==='impregnate')p.fertile.impregnate=!!v;
   else if(k==='menstruationEnabled')p.menstruation.enabled=!!v;
   else if(k==='baseCondition'&&validVitalNumber(v)){p.vitalBaseline.condition=Math.round(v);p.vitalBaseline.source='Настройка пользователя / профиля';}
   else if(k==='basePheromone'&&validVitalNumber(v)){p.vitalBaseline.emission=Math.round(v);p.vitalBaseline.source='Настройка пользователя / профиля';}
  }
  // An older provisional ABO roll must not determine baseline emission after
  // a user selects another ABO category. Recalculate against the final identity.
  const rebased=initialVitalBaseline(canon[who]||{},p.secondary,p.name);
  p.vitalBaseline={...rebased,
   condition:validVitalNumber(changes?.baseCondition)?Math.round(changes.baseCondition):rebased.condition,
   emission:validVitalNumber(changes?.basePheromone)?Math.round(changes.basePheromone):rebased.emission,
   source:validVitalNumber(changes?.baseCondition)||validVitalNumber(changes?.basePheromone)?'Настройка пользователя / профиля':rebased.source};
  if(!Object.hasOwn(changes,'gestate'))p.fertile.gestate=p.secondary==='omega'||p.sex==='female'&&['alpha','beta'].includes(p.secondary);
  if(!Object.hasOwn(changes,'impregnate'))p.fertile.impregnate=p.secondary==='alpha'||p.sex==='male'&&p.secondary==='beta';
  if(!Object.hasOwn(changes,'menstruationEnabled'))p.menstruation.enabled=p.secondary==='omega'||p.sex==='female';
  if(!Object.hasOwn(changes,'cycleEnabled')&&!Object.hasOwn(changes,'cycleMode')){p.cycle.enabled=['alpha','omega'].includes(p.secondary);p.cycle.mode=p.secondary==='unknown'?'unset':p.cycle.enabled?'enabled':'absent';}
  if(!Object.hasOwn(changes,'anatomy'))p.anatomy=anatomyDefault(p.sex,p.secondary);
  const timing=readCycleTiming(changes?.cycleTiming);
  if(timing){Object.assign(p.cycle,timing);p.cycle.anchorHour=timing.intervalHours;}
 }
 for(const row of rows){for(const evt of row.events||[])applyEvent(s,evt);}
 updateCycles(s);return s;
}
export function sortedRecords(chat,ledger){
 return chat.map((m,i)=>({i,key:uniqKey(m,i),m})).filter(x=>ledger[x.key]).map(x=>({index:x.i,...ledger[x.key]}));
}
export function formatPrompt(s,hideTruth=false){
 const out=['[ABO TRACKER — CONTINUITY / NOT CHARACTER KNOWLEDGE]',`Story clock: D${Math.floor(s.clockHours/24)} ${Math.floor(s.clockHours%24)}h. Treat time as story time, not real time.`];
 if(s.config.pregnancyEnabled===false)out.push('PREGNANCY TRACKING OFF for this chat: do not introduce tracker-generated pregnancy, conception outcomes, pregnancy symptoms or due dates.');
 for(const [id,p] of Object.entries(s.people)){
  const cycle=cycleDisplay(p);
  if(cycle.enabled)out.push(`${id.toUpperCase()} cycle timing (story hours): interval between starts=${p.cycle.intervalHours}; active=${p.cycle.activeHours}; prodrome=${p.cycle.prodromeHours}; recovery=${p.cycle.recoveryHours}. Current phase=${p.cycle.phase}; next active phase in ${cycleForecast(p,s.clockHours,s.seed).nextActiveHours??'unknown'} story hours.`);
  const bondData=bondEffects(s,id);if(bondData)out.push(`${id.toUpperCase()} bond effects: partners=${bondData.partners.join(',')}; active=${bondData.active}; partner pheromone sensitivity ${bondData.partnerScentSensitivity>0?'+':''}${bondData.partnerScentSensitivity}; others sensitivity ${bondData.otherScentSensitivity}; others discomfort +${bondData.otherScentDiscomfort}; cycle separation stress +${bondData.heatSeparationStress} (max once if heat or rut is active), baseline separated stress +${s.config.bondBaseSeparationStress??10}. Asymmetric bond mode=${s.config.asymmetricBond?'ON (Omega effects only)':'OFF (both partners affected)'}.`);
  out.push(`${id.toUpperCase()} ${p.name}: sex=${p.sex}; ABO=${p.secondary}; anatomy=${p.anatomy||'not specified'}; cycle=${cycleMode(p)} (${cycle.enabled?cycle.phase:'no active cycle'}); menses=${p.menstruation.phase}; bond=${(p.bondPartners||[]).join(',')||'none'}; simulated condition=${p.body.condition}/100, pheromone emission=${p.pheromone.emission}/100, sensitivity=${p.body.sensitivity}, stress=${p.body.stress}; recent meds=${p.medication.filter(m=>m.until>=s.clockHours).map(m=>m.drug).join(',')||'none'}.`);
  if(p.anatomyDetail||p.inseminationOrgan)out.push(`${id.toUpperCase()} anatomical notes=${(p.anatomyDetail||'').slice(0,240)}; insemination anatomy=${(p.inseminationOrgan||'').slice(0,240)}.`);
  const prs=p.presentation||{};if(Object.values(prs).some(Boolean))out.push(`${id.toUpperCase()} interaction profile: scent=${prs.pheromoneScent||'unknown'}; contact=${prs.contactStyle||'unknown'}; voice=${prs.vocalStyle||'unknown'}; speech=${prs.speechStyle||'unknown'}.`);
  const pref=p.preferences||{};
  const fmtPref=x=>`${String(x.label||x.id||'').slice(0,55)} (${x.level||'latent'})`;
  if(pref.confirmed?.length||pref.latent?.length)out.push(`${id.toUpperCase()} established preferences=${(pref.confirmed||[]).slice(0,8).map(fmtPref).join(', ')||'none'}; latent possibilities (NOT confirmed or mandated)=${(pref.latent||[]).slice(0,5).map(fmtPref).join(', ')||'none'}.`);
  const symptoms=(p.adverse||[]).filter(x=>x.until===undefined||x.until>=s.clockHours).slice(-3);
  if(symptoms.length)out.push(`${id.toUpperCase()} observed fictional medication reactions=${symptoms.map(x=>(x.symptoms||[x.type||'unspecified']).join('/')).join(', ')}. These are NOT proof of tolerance or pregnancy.`);
  if(p.recentScenes?.length)out.push(`${id.toUpperCase()} recent scenes (continuity only)=${p.recentScenes.slice(-3).map(x=>(x.play||[]).slice(0,3).join('/')||x.contact||x.vocal||'scene').join(' > ')}.`);
  const pr=p.pregnancy;
  if(s.config.pregnancyEnabled===false)continue;
  if(!hideTruth&&pr.status!=='none')out.push(`INTERNAL PHYSIOLOGY for ${p.name}: pregnancy=${pr.status}, elapsed=${pr.conceivedAt===null?'?':Math.floor((s.clockHours-pr.conceivedAt)/24)} days. Do not disclose this as knowledge unless in-story discovery established. Subject awareness=${p.awareness.pregnancy}.`);
  else out.push(`${p.name} awareness of pregnancy=${p.awareness.pregnancy}.`);
 }
 out.push('Character knowledge ≠ objective physiology. Respect established boundaries and user agency. Vary dialogue, contact, and vocal responses according to individual character personality and explicit preferences rather than repeating a universal script. Latent preferences are hypotheses, not consent, confirmed facts, or required play. Do not script USER decisions, dialogue, bodily consent, or actions. World Info/card canon overrides unknown defaults. This is continuity data, not an instruction to trigger events.');
 return out.join('\n');
}
