/* Character-specific fictional baselines and replayable, evidence-driven changes.
 * Values are narrative simulation indices, not clinical measurements.
 * This file does not read conversation turns or infer elapsed time.
 */
const clamp=(x)=>Math.max(0,Math.min(100,Math.round(x)));
const hash=(input)=>{let h=2166136261;for(const c of String(input)){h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;}return h>>>0;};
const matches=(text,expressions)=>expressions.some(re=>re.test(text));
export const CONDITION_OBSERVATIONS=Object.freeze({exhausted:-27,tired:-13,strained:-8,neutral:0,rested:9,energized:15});
export const PHEROMONE_OBSERVATIONS=Object.freeze({surge:24,strong:14,neutral:0,faint:-16,suppressed:-27});
export function validVitalNumber(value){return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100;}
export function initialVitalBaseline(canon={},secondary='unknown',name=''){
 const desc=String(canon.card||canon.description||'').slice(0,10000);
 const key=`${canon.id||canon.personaId||name}:${desc.slice(0,180)}`;
 // Stable, bounded individual variation is only a provisional world baseline.
 // Narrative traits and explicit overrides take precedence.
 let condition=72+(hash(key+':constitution')%15)-7;
 let emission=({alpha:61,omega:55,beta:20,unknown:44})[secondary]??44;
 emission+=(hash(key+':scent')%17)-8;
 const signals=[];
 if(matches(desc,[/체력(?:이|은)?\s*(?:약|부족|낮)/,/허약|병약|쇠약|만성\s*피로|몸이\s*약|frail|poor\s*stamina|chronically\s*(?:ill|tired)/i])){condition-=17;signals.push('Низкая выносливость');}
 if(matches(desc,[/체력(?:이|은)?\s*(?:좋|강)|튼튼|건강한\s*체질|강인한\s*체력|운동선수|athletic|excellent\s*stamina|robust/i])){condition+=12;signals.push('Хорошая выносливость');}
 if(matches(desc,[/페로몬.{0,20}(?:강|진하|짙|폭발|넘치)|(?:strong|intense|overpowering)\s*pheromon/i])){emission+=22;signals.push('Сильные феромоны по описанию');}
 if(matches(desc,[/페로몬.{0,24}(?:약|희미|미약|거의\s*없|잘\s*느껴지지)|(?:weak|faint|subtle)\s*pheromon/i])){emission-=20;signals.push('Слабые феромоны по описанию');}
 if(matches(desc,[/페로몬.{0,22}(?:억제|차단|봉인)|pheromone\s*suppress/i])){emission-=23;signals.push('Постоянное подавление феромонов по описанию');}
 return {condition:clamp(condition),emission:clamp(emission),source:signals.length?'Оценка по карточке и персоне':'Индивидуальная базовая оценка',reasons:signals};
}
export function recalculateVitals(person,storyHours){
 const base=person.vitalBaseline||{condition:72,emission:45};
 let condition=base.condition,emission=base.emission;
 const phase=person.cycle?.enabled?person.cycle.phase:'quiet';
 if(phase==='prodrome'){condition-=5;emission+=9;}
 if(phase==='active'){condition-=13;emission+=19;}
 if(phase==='recovery'){condition-=6;emission+=6;}
 if(Number(person.cycle?.inducedUntil)>storyHours){condition-=8;emission+=16;}
 for(const m of person.medication||[]){
  if(!(m.at<=storyHours&&m.until>storyHours))continue;
  if(['oral_suppressant','long_suppressant','emergency_suppressant'].includes(m.drug))emission-=18;
  if(m.drug==='scent_blocker')emission-=31;
  if(['symptom_inducer','cycle_inducer'].includes(m.drug))emission+=16;
 }
 const adverse=(person.adverse||[]).filter(a=>a.at<=storyHours&&((a.until??(a.at+72))>storyHours));
 if(adverse.length)condition-=Math.min(22,adverse.length*9);
 const o=person.vitalObservation||{};
 // Short-lived observations expire by explicit story time, never by turn count.
 if(Number.isFinite(o.at)&&storyHours-o.at>=0&&storyHours-o.at<24){
  if(Object.hasOwn(CONDITION_OBSERVATIONS,o.condition))condition+=CONDITION_OBSERVATIONS[o.condition];
  if(Object.hasOwn(PHEROMONE_OBSERVATIONS,o.emission))emission+=PHEROMONE_OBSERVATIONS[o.emission];
 }
 person.body.condition=clamp(condition);
 person.pheromone.emission=clamp(emission);
 person.body.emission=person.pheromone.emission; // legacy alias; prevent contradictory values
 return {condition:person.body.condition,emission:person.pheromone.emission};
}
