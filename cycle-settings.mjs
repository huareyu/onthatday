/** Per-person story-cycle timings. Stored in chat overrides, never shared globally. */
export const CYCLE_TIMING_FIELDS=Object.freeze(['intervalHours','activeHours','prodromeHours','recoveryHours']);
export function cycleTimingError(value){
 if(!value||typeof value!=='object')return 'Укажите параметры цикла.';
 for(const key of CYCLE_TIMING_FIELDS){
  const min=['intervalHours','activeHours'].includes(key)?1:0;
  if(typeof value[key]!=='number'||!Number.isFinite(value[key])||value[key]<min||value[key]>8760)
   return 'Интервал и активная фаза: от 1 до 8760 часов. Предвестники и восстановление: от 0 до 8760 часов.';
 }
 if(value.prodromeHours+value.activeHours+value.recoveryHours>value.intervalHours+1e-7)
  return 'Интервал должен вмещать предвестники, активную фазу и восстановление.';
 return '';
}
export function readCycleTiming(value){
 if(cycleTimingError(value))return null;
 return Object.fromEntries(CYCLE_TIMING_FIELDS.map(key=>[key,value[key]]));
}
