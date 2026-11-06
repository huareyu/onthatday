import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

async function fixture(){
 let source=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
 const globals={console:{...console,warn:()=>{}},structuredClone,URL,Set,Map,Date,Math,Number,String,Object,JSON,crypto:webcrypto,setTimeout:()=>0,clearTimeout:()=>{}};
 const imports=[...source.matchAll(/^import \{([^}]+)\} from '([^']+)';\r?\n/gm)];
 for(const [,names,moduleName] of imports){
  const exports=moduleName.startsWith('./')?await import(new URL('../'+moduleName.slice(2),import.meta.url)):{user_avatar:'persona.png',ConnectionManagerRequestService:{getSupportedProfiles:()=>[]},getRequestHeaders:()=>({}),saveSettingsDebounced:()=>{},extension_settings:{}};
  for(const name of names.split(',').map(x=>x.trim()))globals[name]=exports[name];
 }
 source=source.replace(/^import \{[^}]+\} from '[^']+';\r?\n/gm,'');
 source=source.replace("if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();",'');
 const root={innerHTML:'',dataset:{},classList:{toggle:()=>{}},style:{setProperty:()=>{}},querySelector:()=>({scrollTop:0})};
 const nodes=new Map([['abop-panel',root]]);
 let failSave=false;
 const ctx={chatId:'cycle-ui',chatMetadata:{},chat:[{mes:'Opening scene',is_user:false}],name1:'Пользователь',name2:'Персонаж',characterId:0,
  characters:[{name:'Омега',description:'sex: male\nABO: omega'}],powerUserSettings:{persona_description:'sex: male\nABO: alpha'},
  saveMetadata:async()=>{if(failSave)throw new Error('save failed');},setExtensionPrompt:()=>{}};
 globals.SillyTavern={getContext:()=>ctx};
 globals.document={getElementById:id=>nodes.get(id)||null};
 globals.window={innerWidth:1280,innerHeight:900,matchMedia:()=>({matches:false})};
 const sandbox=vm.createContext(globals);
 source+=`\nglobalThis.ui={meta,branchState,handlePanelClick,handlePanelChange,currentRoleOverrides,renderTab(id){tab=id;refresh();return document.getElementById('abop-panel').innerHTML},getStatus(){return status;}};`;
 vm.runInContext(source,sandbox);
 const ui=sandbox.ui;
 ui.renderTab('settings');
 function setInputs(role,values){
  nodes.set('abop-cycle-settings-'+role,{querySelector:selector=>{
   const field=selector.match(/data-cycle-timing="([^"]+)"/)[1];return {value:String(values[field]??'')};
  }});
 }
 async function click(action,role='char'){
  const button={dataset:{action,role}};
  await ui.handlePanelClick({target:{closest:()=>button}});
 }
 return {ui,ctx,root,setInputs,click,fail(value){failSave=value;}};
}

test('settings render both profiles and only enable the applicable heat/rut control',async()=>{
 const f=await fixture();
 const html=f.ui.renderTab('settings');
 assert.match(html,/Настройки цикла/);
 assert.match(html,/data-cycle-settings="char"/);
 assert.match(html,/data-cycle-settings="user"/);
 assert.match(html,/data-action="startCycle" data-role="char" >Начать течку/);
 assert.match(html,/data-action="endCycle" data-role="char" disabled>Завершить течку/);
 assert.match(html,/Начать гон/);
 assert.match(f.ui.renderTab('cycles'),/Настроить цикл/);
 assert(!/[가-힣]/u.test(html));
});

test('saving, invalid input and reset work through the actual panel handlers',async()=>{
 const f=await fixture();
 f.setInputs('char',{intervalDays:10,activeHours:48,prodromeHours:12,recoveryHours:24});
 await f.click('saveCycleSettings');
 assert.equal(f.ui.branchState().people.char.cycle.intervalHours,240);
 assert.equal(f.ui.meta().overrides.char.cycleTiming.activeHours,48);
 const before=JSON.stringify(f.ui.meta().overrides.char.cycleTiming);
 f.setInputs('char',{intervalDays:1,activeHours:48,prodromeHours:12,recoveryHours:24});
 await f.click('saveCycleSettings');
 assert.equal(JSON.stringify(f.ui.meta().overrides.char.cycleTiming),before);
 assert.match(f.ui.getStatus(),/Интервал должен вмещать/);
 f.setInputs('char',{intervalDays:10,activeHours:'',prodromeHours:12,recoveryHours:24});
 await f.click('saveCycleSettings');
 assert.equal(JSON.stringify(f.ui.meta().overrides.char.cycleTiming),before);
 await f.click('resetCycleSettings');
 assert.equal(f.ui.meta().overrides.char.cycleTiming,undefined);
});

test('start/end are durable events and a trailing user-message clock is respected',async()=>{
 const f=await fixture();
 f.ctx.chat.push({mes:'12 hours later',is_user:true});
 const key=f.ui.meta().ledger;
 const {uniqKey}=await import('../core.mjs');
 key[uniqKey(f.ctx.chat[1],1)]={events:[{id:'skip',kind:'time_advance',hours:12}],manual:[]};
 await f.click('startCycle');
 assert.equal(f.ui.branchState().clockHours,12);
 assert.equal(f.ui.branchState().people.char.cycle.anchorHour,12);
 assert.equal(f.ui.branchState().people.char.cycle.phase,'active');
 const activeHTML=f.ui.renderTab('cycles');
 assert.match(activeHTML,/data-action="startCycle" data-role="char" disabled/);
 assert.match(activeHTML,/data-action="endCycle" data-role="char" >Завершить течку/);
 await f.click('endCycle');
 assert.equal(f.ui.branchState().people.char.cycle.phase,'recovery');
 assert.equal(f.ui.branchState().people.char.cycle.endedHour,12);
 const events=Object.values(f.ui.meta().ledger).flatMap(x=>x.events);
 assert.equal(events.filter(x=>x.kind==='heat_start').length,1);
 assert.equal(events.filter(x=>x.kind==='heat_end').length,1);
 await f.click('endCycle');
 assert.equal(Object.values(f.ui.meta().ledger).flatMap(x=>x.events).filter(x=>x.kind==='heat_end').length,1);
});

test('save failures restore settings and manual event ledgers',async()=>{
 const f=await fixture();
 const original=JSON.stringify(f.ui.meta().overrides.char);
 f.setInputs('char',{intervalDays:10,activeHours:48,prodromeHours:12,recoveryHours:24});
 f.fail(true);
 await f.click('saveCycleSettings');
 assert.equal(JSON.stringify(f.ui.meta().overrides.char),original);
 const ledger=JSON.stringify(f.ui.meta().ledger);
 await f.click('startCycle');
 assert.equal(JSON.stringify(f.ui.meta().ledger),ledger);
 assert.equal(f.ui.branchState().people.char.cycle.phase,'quiet');
});

test('cycle settings target the selected NPC rather than the main card',async()=>{
 const f=await fixture(),m=f.ui.meta();
 m.npcTracking={mode:'multi',activeId:'selected',targets:{selected:{id:'selected',name:'NPC',card:'ABO: omega',secondary:'omega',sex:'male',overrides:{}}},ledgers:{},pending:{}};
 f.setInputs('char',{intervalDays:20,activeHours:72,prodromeHours:12,recoveryHours:24});
 await f.click('saveCycleSettings');
 assert.equal(m.npcTracking.targets.selected.overrides.cycleTiming.intervalHours,480);
 assert.equal(m.overrides.char.cycleTiming,undefined);
 await f.click('startCycle');
 assert.equal(f.ui.branchState().people.char.cycle.phase,'active');
 assert(Object.values(m.npcTracking.ledgers.selected).some(x=>x.events.some(e=>e.kind==='heat_start')));
 assert(!Object.values(m.ledger).some(x=>x.events.some(e=>e.kind==='heat_start')));
});
