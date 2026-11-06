import test from 'node:test';
import assert from 'node:assert/strict';
import {replay,initialState,applyEvent,cycleForecast,phaseAt,formatPrompt} from '../core.mjs';
import {cycleTimingError,readCycleTiming} from '../cycle-settings.mjs';
import {resetProfileChoices} from '../profile-reset.mjs';
import {combineNpcRecords,sharedEvent} from '../npc-tracking.mjs';
import {uniqKey} from '../core.mjs';

const canon={char:{name:'Омега',sex:'male',secondary:'omega'},user:{name:'Альфа',sex:'male',secondary:'alpha'}};
const timing={intervalHours:240,activeHours:48,prodromeHours:12,recoveryHours:24};
const row=events=>[{events:events.map((event,i)=>({id:`event-${i}`,...event}))}];
const replayWith=events=>replay('cycle-tests',canon,{},row(events),{char:{cycleTiming:timing}});

test('saved timings are per person, validated atomically and applied before historical events',()=>{
 const baseline=replay('cycle-tests',canon,{},[]);
 const state=replayWith([{kind:'time_advance',hours:250}]);
 assert.equal(state.people.char.cycle.phase,'active');
 assert.equal(state.people.char.cycle.intervalHours,240);
 assert.equal(cycleForecast(state.people.char,250).currentEndHours,38);
 assert.equal(state.people.user.cycle.intervalHours,baseline.people.user.cycle.intervalHours);
 assert.deepEqual(readCycleTiming({...timing,unknown:'ignored'}),timing);
 for(const value of [null,{}, {...timing,activeHours:0},{...timing,intervalHours:NaN},{...timing,recoveryHours:-1},{...timing,activeHours:8761},{...timing,activeHours:'48'},{...timing,intervalHours:60}])
  assert.notEqual(cycleTimingError(value),'');
 assert.equal(cycleTimingError({...timing,prodromeHours:0,recoveryHours:0}),'');
 const invalid=replay('cycle-tests',canon,{},[],{char:{cycleTiming:{...timing,intervalHours:0}}});
 assert.equal(invalid.people.char.cycle.intervalHours,baseline.people.char.cycle.intervalHours);
});

test('manual early end starts recovery now and preserves the next scheduled cycle',()=>{
 const state=replayWith([{kind:'heat_start',person:'char'},{kind:'time_advance',hours:10},{kind:'heat_end',person:'char'}]);
 const p=state.people.char;
 assert.equal(state.clockHours,10);
 assert.equal(p.cycle.phase,'recovery');
 assert.equal(p.cycle.anchorHour,0);
 assert.equal(cycleForecast(p,10).currentEndHours,24);
 assert.equal(cycleForecast(p,10).nextActiveHours,230);
 assert.equal(phaseAt(p.cycle,34),'quiet');
 assert.equal(phaseAt(p.cycle,228),'prodrome');
 assert.equal(phaseAt(p.cycle,240),'active');
 assert.equal(cycleForecast(p,240).currentEndHours,48);
 assert.equal(p.cycle.activeHours,48,'ending an episode never rewrites its configured duration');
 assert.match(formatPrompt(state),/cycle timing \(story hours\): interval between starts=240/);
 assert.match(formatPrompt(state),/Current phase=recovery/);
 assert.equal(state.events.at(-1).kind,'heat_end');
 assert.deepEqual(state,replayWith([{kind:'heat_start',person:'char'},{kind:'time_advance',hours:10},{kind:'heat_end',person:'char'}]));
});

test('natural cycles, instant end and a later manual restart have correct boundaries',()=>{
 const natural=replayWith([{kind:'time_advance',hours:250},{kind:'heat_end',person:'char'}]);
 assert.equal(natural.people.char.cycle.resumeHour,480);
 assert.equal(cycleForecast(natural.people.char,250).currentEndHours,24);
 const instant=replayWith([{kind:'heat_start',person:'char'},{kind:'heat_end',person:'char'}]);
 assert.equal(instant.people.char.cycle.phase,'recovery');
 const restart=replayWith([{kind:'heat_start',person:'char'},{kind:'time_advance',hours:10},{kind:'heat_end',person:'char'},{kind:'time_advance',hours:1},{kind:'heat_start',person:'char'}]);
 assert.equal(restart.people.char.cycle.phase,'active');
 assert.equal(restart.people.char.cycle.anchorHour,11);
 assert.equal(restart.people.char.cycle.endedHour,undefined);
 assert.equal(cycleForecast(restart.people.char,11).currentEndHours,48);
});

test('rut uses its own person and disabled or paused cycles cannot be manually ended',()=>{
 const state=replayWith([{kind:'rut_start',person:'user'},{kind:'rut_end',person:'user'}]);
 assert.equal(state.people.user.cycle.phase,'recovery');
 assert.equal(state.people.char.cycle.phase,'quiet');
 const disabled=replay('cycle-tests',canon,{},row([{kind:'heat_start',person:'char'},{kind:'heat_end',person:'char'}]),{char:{cycleMode:'disabled'}});
 assert.equal(disabled.people.char.cycle.endedHour,undefined);
 const paused=initialState('cycle-tests',canon);
 paused.people.char.pregnancy.status='pregnant_confirmed';
 applyEvent(paused,{id:'paused-end',kind:'heat_end',person:'char'});
 assert.equal(paused.people.char.cycle.endedHour,undefined);
});

test('ending induced heat before the first natural cycle clears the effect',()=>{
 const state=replayWith([{kind:'medication',person:'char',drug:'symptom_inducer',use_mode:'normal'},{kind:'heat_end',person:'char'}]);
 assert.equal(state.people.char.cycle.phase,'recovery');
 assert.equal(state.people.char.cycle.inducedUntil,null);
 assert.equal(cycleForecast(state.people.char,0).nextActiveHours,240);
 const inducedAgain=replayWith([{kind:'heat_start',person:'char'},{kind:'heat_end',person:'char'},{kind:'time_advance',hours:1},{kind:'medication',person:'char',drug:'cycle_inducer',use_mode:'normal'}]);
 assert.equal(inducedAgain.people.char.cycle.endedHour,undefined);
 assert.equal(inducedAgain.people.char.cycle.anchorHour,1);
});

test('zero recovery and prodrome do not leave a phantom active phase',()=>{
 const state=replay('zero',canon,{},row([{kind:'heat_start',person:'char'},{kind:'heat_end',person:'char'}]),{char:{cycleTiming:{...timing,recoveryHours:0,prodromeHours:0}}});
 assert.equal(state.people.char.cycle.phase,'quiet');
 assert.equal(cycleForecast(state.people.char,0).currentEndHours,240);
 assert.equal(phaseAt(state.people.char.cycle,240),'active');
});

test('cycle timing reset respects the selected NPC and current persona',()=>{
 const meta={overrides:{char:{cycleTiming:timing},user:{cycleTiming:timing}},canon:{char:{},user:{}},userPersonaIdentity:'current',personaProfiles:{other:{overrides:{cycleTiming:timing}}}};
 const npc={overrides:{cycleTiming:timing}};
 assert.equal(resetProfileChoices(meta,{role:'char',field:'cycleTiming',target:npc}),1);
 assert.equal(npc.overrides.cycleTiming,undefined);
 assert.deepEqual(meta.overrides.char.cycleTiming,timing);
 assert.deepEqual(meta.overrides.user.cycleTiming,timing);
 assert.deepEqual(meta.personaProfiles.other.overrides.cycleTiming,timing);
});

test('heat/rut end events follow the same selected-NPC and user-ledger routing as starts',()=>{
 assert.equal(sharedEvent({kind:'heat_end',person:'char'}),false);
 assert.equal(sharedEvent({kind:'rut_end',person:'user'}),true);
 const chat=[{mes:'current scene'}],key=uniqKey(chat[0],0);
 const main={[key]:{events:[{id:'u',kind:'rut_end',person:'user'}]}};
 const selected={[key]:{events:[{id:'c',kind:'heat_end',person:'char'}]}};
 assert.deepEqual(combineNpcRecords(chat,main,selected)[0].events.map(x=>x.id),['u','c']);
 assert.deepEqual(combineNpcRecords(chat,main,{})[0].events.map(x=>x.id),['u']);
});
