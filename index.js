import {recoverHistoryTime,applyHistorySync,syncedHistoryEventCount} from './time-sync.mjs';
import {collectHistorySources,historySnapshot,buildHistoryCandidates,appendHistorySelections,countHistoryStateEvents,matchingRecordedEvents,eventIdentity} from './history-state.mjs';
import {DEFAULT_CONFIG, VERSION,hash,uniqKey,sortedRecords,replay,inferExplicit,formatPrompt,cycleDisplay,cycleForecast,cycleMode,bondEffects,bondSeparationStress,effectivePheromoneResponse,pressureScore,clamp} from './core.mjs';
import {ANALYZER_SYSTEM,parseModelOutput,buildAnalyzerUserPrompt} from './analyzer.mjs';
import {PROFILE_SYSTEM,PROFILE_FIELDS,SetupJsonFormatError,normalizeSetupProposal,completeInitialIdentityProposal,alignInitialPhysiologyProposal,missingInitialSecondaryRoles,mergeSelectedPreferences,anatomyChoices,anatomyDefault} from './profile.mjs';
import {user_avatar} from '/scripts/personas.js';
import {ConnectionManagerRequestService} from '/scripts/extensions/shared.js';
import {requestUsingProfile,extractedText,readableProfileError,profileErrorHint,redactErrorSecrets} from './connection.mjs';
import {OPTION_CANDIDATES} from './profile.mjs';
import {preferenceLabel,preferenceDisplayLabel,preferenceIdFromEdit,preferenceLevelLabel,attitudeLabel,cyclePhaseLabel,pregnancyLabel,sceneDisplayLabel,sceneRecordSummary,cycleModeLabel,drugLabel,adverseLabel,rateLabel,eventKindLabel,personRoleLabel} from './preference-labels.mjs';
import {readCurrentPersona,personaIdentity,syncPersonaProfile,filterRowsByPersona} from './persona-sync.mjs';
import {normalizeSetupOutputTokens,MIN_SETUP_OUTPUT_TOKENS,MAX_SETUP_OUTPUT_TOKENS} from './setup-options.mjs';
import {buildProfileSetupInput} from './profile-setup-input.mjs';
import {MAIN_TARGET,npcCanon,discoverNpcProfilesDetailed,mergeNpcCandidates,makeNpcReviewBatches,buildNpcReviewPrompt,parseNpcAiSuggestions,NPC_AI_SYSTEM,namedTarget,sharedEvent,combineNpcRecords} from './npc-tracking.mjs';
import {getRequestHeaders,saveSettingsDebounced} from '/script.js';
import {extension_settings} from '/scripts/extensions.js';
import {ensureSharedAnalysisSettings,setSharedAnalysisSetting} from './global-analysis-settings.mjs';
import {mountExtensionLaunchers} from './menu-launcher.mjs';
import {BUNDLED_WORLDINFO_DRUG_CATALOG} from './worldinfo-drug-catalog.mjs';
import {PREFERENCE_LOCALIZATION_SYSTEM,localizationItems,localizationPrompt,parseLocalizationOutput} from './preference-localization.mjs';
import {POSTPROCESS_SCOPES,DEFAULT_POSTPROCESS,normalizedPostprocessSettings,displayCacheText,collectDisplayCandidates,choosePostprocessCandidates,postprocessKey,ruleDisplayText,batchPostprocess,postprocessPrompt,parsePostprocessReply,DISPLAY_POSTPROCESS_SYSTEM} from './display-postprocess.mjs';
import {sceneHasDetails,hasUsableScene,hasSceneHistory} from './scene-visibility.mjs';
import {openingMenstruationEvidence} from './menstruation-evidence.mjs';
import {RESETTABLE_FIELDS,resetProfileChoices} from './profile-reset.mjs';
const STORAGE='abo_pixel_tracker_independent_v1';
const PROMPT='ABO_PIXEL_TRACKER_CONTINUITY_V1';
const S=()=>SillyTavern.getContext();
let active=false, working=false, state=null, status='Готово',panelOpen=false, tab='status', lastKey='';
let timeSyncPreview=null,historyStatePreview=null,historyScanCancelled=false;
let postprocessBusy=false,postprocessCancel=false,postprocessPending=false;
const autoPostprocessFailures=new Set();
let sessionApiKey=''; // Never serialized or persisted. Cleared on page reload.
let npcCandidates=[], npcScanChatId='', npcSearch='', npcReviewEntries=[], npcScanStats=null, npcPreviewId='', npcAiBatchOffset=0;
const html=x=>String(x??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const el=(id)=>document.getElementById(id);
const fmt=(n)=>Number.isFinite(n)?Math.round(n*10)/10:0;
function log(...v){console.log('[Дела того дня]',...v);}
function displayAlertKo(message,hideTruth=false){
 const raw=String(message??'');
 const confirmed=raw.match(/^(.+): internally confirmed conception \(character awareness remains separate\)$/);
 if(confirmed)return hideTruth?'':`${confirmed[1]}: Зачатие подтверждено внутренним расчётом (осведомлённость персонажа учитывается отдельно)`;
 const reason=raw.match(/^Exposure not rolled: (.+)$/);
 if(reason){
  const reasons={pregnancy_disabled:'Симуляция беременности отключена',gate_failed:'Обязательные условия не выполнены',already_pregnant:'Беременность уже наступила',ovulation_suppressed:'Овуляция подавлена'};
  return `Расчёт вероятности беременности пропущен · ${reasons[reason[1]]||reason[1]}`;
 }
 return raw;
}
function eventHiddenByPrivacy(kind,config){return config?.hideTruth===true&&['exposure','pregnancy_reveal','pregnancy_end','delivery'].includes(kind);}
function eventSummaryKo(e){
 const person=personRoleLabel(e.person);
 const kind=e.kind==='vital_observation'?'Изменение состояния тела и феромонов':localizedText('events','shared','kind',String(e.kind||''),eventKindLabel(e.kind));
 if(e.kind==='time_advance'&&Number.isFinite(e.hours))return `${kind} · ${fmt(e.hours)} ч`;
 return e.person?`${person} · ${kind}`:kind;
}

// Display-only reference compiled from the World Info included in this release.
// No separate browser request to extension .json assets is needed.
function worldInfoDrugReferenceHtml(){
  const catalog=BUNDLED_WORLDINFO_DRUG_CATALOG;
  const headline=`Препараты из комплектной книги мира · ${catalog.count} типов`;
  const groups=catalog.groups.map(group=>`<div class="abop-drug-group"><h4>${html(group.name)} <small>${html(group.source)}${group.disabled?' · запись отключена':''}</small></h4>${group.items.map(item=>`<div class="abop-drug-line"><b>${html(item.title)}</b><p>${html(item.description)}</p></div>`).join('')}</div>`).join('');
  return `<details class="abop-drug-reference"><summary>${headline}</summary>${groups||'<p class="abop-muted">Категории препаратов не найдены.</p>'}</details>`;
}

function sharedAnalysisSettings(){
 const legacy=meta(false)?.config||{};
 const {shared,created}=ensureSharedAnalysisSettings(extension_settings,legacy,DEFAULT_CONFIG);
 if(created)saveSettingsDebounced();
 return shared;
}
function analysisConfig(){return {...(meta(false)?.config||DEFAULT_CONFIG),...sharedAnalysisSettings()};}
function saveSharedAnalysisSetting(key,value){
 setSharedAnalysisSetting(extension_settings,key,value,meta(false)?.config||{},DEFAULT_CONFIG);
 saveSettingsDebounced();
}
function connectionValue(config){return String(config?.analysisConnection||'');} // empty = current connection
function supportedProfiles(){
 try{return ConnectionManagerRequestService.getSupportedProfiles()||[];}
 catch(e){console.debug('[Дела того дня] profile listing unavailable',readableProfileError(e));return [];}
}
function connectionOptions(config){
 const current=connectionValue(config), profiles=supportedProfiles();
 let htmlOptions='<option value="" '+(!current?'selected':'')+'>Текущее подключение (по умолчанию)</option>';
 for(const p of [...profiles].sort((a,b)=>String(a.name).localeCompare(String(b.name)))){
  const v=`profile:${p.id}`;
  htmlOptions+=`<option value="${html(v)}" ${current===v?'selected':''}>Сохранено · ${html(p.name||p.id)} (${html(p.model||p.api||'')})</option>`;
 }
 if(current.startsWith('profile:')&&!profiles.some(p=>`profile:${p.id}`===current))htmlOptions+=`<option value="${html(current)}" selected>Выбранный профиль не найден</option>`;
 htmlOptions+=`<option value="custom" ${current==='custom'?'selected':''}>Прямое подключение к API (совместимому с OpenAI)</option>`;
 return htmlOptions;
}
function postprocessConnectionOptions(current){
 let result=`<option value="same" ${current==='same'?'selected':''}>Использовать подключение анализа</option><option value="current" ${current==='current'?'selected':''}>Текущее подключение SillyTavern</option>`;
 for(const p of [...supportedProfiles()].sort((a,b)=>String(a.name).localeCompare(String(b.name)))){
  const id=`profile:${p.id}`;
  result+=`<option value="${html(id)}" ${current===id?'selected':''}>Другой профиль · ${html(p.name||p.id)}</option>`;
 }
 if(current.startsWith('profile:')&&!supportedProfiles().some(p=>`profile:${p.id}`===current))result+=`<option value="${html(current)}" selected>Выбранный профиль перевода не найден</option>`;
 return result;
}
function directEndpoint(raw){
 const url=new URL(String(raw).trim());
 if(!['https:','http:'].includes(url.protocol))throw new Error('Разрешены только адреса API по http(s)');
 if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.origin!==location.origin)throw new Error('Для защиты ключа API используйте HTTPS для удалённого сервера');
 const path=url.pathname.replace(/\/+$/,'');
 url.pathname=/\/chat\/completions$/.test(path)?path:`${path||''}/chat/completions`;
 return url.toString();
}
async function analysisRequest(systemPrompt,prompt,maxTokens=2200,connectionOverride=null){
 const config=analysisConfig(), chosen=connectionOverride===null?connectionValue(config):connectionOverride;
 if(!chosen){
  if(typeof S().generateRaw!=='function')throw new Error('У текущего подключения SillyTavern отсутствует generateRaw');
  return extractedText(await S().generateRaw({systemPrompt,prompt,responseLength:maxTokens}));
 }
 if(chosen.startsWith('profile:')){
  const id=chosen.slice(8);
  if(!supportedProfiles().some(p=>p.id===id))throw new Error('Выбранный сохранённый профиль отсутствует или не поддерживается');
  return await requestUsingProfile(ConnectionManagerRequestService,id,systemPrompt,prompt,maxTokens);
 }
 if(chosen==='custom'){
  if(!config.customApiUrl||!config.customModel)throw new Error('Укажите адрес API и название модели');
  const endpoint=directEndpoint(config.customApiUrl);
  const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(sessionApiKey?{'Authorization':`Bearer ${sessionApiKey}`}:{})},body:JSON.stringify({model:config.customModel,stream:false,temperature:0.1,max_tokens:maxTokens,messages:[{role:'system',content:systemPrompt},{role:'user',content:prompt}]})});
  if(!r.ok)throw new Error(`Ошибка прямого API · HTTP ${r.status} (проверьте CORS браузера и настройки модели)`);
  const j=await r.json();
  const content=extractedText(j);
  if(typeof content!=='string'||!content.trim())throw new Error('Прямое API не вернуло текстовый ответ');
  return content;
 }
 throw new Error('Неизвестная настройка подключения анализа');
}
function postprocessSettings(){
 const shared=sharedAnalysisSettings();
 return normalizedPostprocessSettings({mode:shared.postprocessMode,connection:shared.postprocessConnection,scopes:shared.postprocessScopes});
}
function localizedText(scope,role,field,source,fallback){
 const m=meta(false),opt=postprocessSettings();
 if(opt.mode==='none'||!opt.scopes.includes(scope))return fallback;
 const ruled=ruleDisplayText(scope,field,source,fallback);
 if(opt.mode==='rules')return ruled;
 return displayCacheText(m?.displayPostprocessCache,scope,role,field,source,ruled);
}
function localizedPreference(pref,m,role){
 const base=preferenceDisplayLabel(pref,m.preferenceTranslations||{});
 if(['custom','user_added_setup'].includes(pref?.source))return base;
 return localizedText('preference',role,`preference:${pref.id}`,pref.label||pref.id,base);
}
function localizedScene(scope,role,field,raw){
 return localizedText(scope,role,field,raw,sceneDisplayLabel(raw));
}
function localizedSceneSummary(scene,role){
 if(!scene||typeof scene!=='object')return 'Нет записей';
 const pieces=['posture','contact','vocal','speech'].filter(k=>scene[k]).map(k=>localizedScene('history',role,k,scene[k]));
 for(const play of (Array.isArray(scene.play)?scene.play:[]))pieces.push(localizedScene('history',role,'play',play));
 return [...new Set(pieces.filter(Boolean))].join(' · ')||'Нет подробностей';
}
function postprocessMatches(m,origin){
 return S()?.chatId===origin.chatId&&meta(false)===m&&m.userPersonaIdentity===origin.persona&&selectedNpcId(m)===origin.target;
}
async function runDisplayPostprocess({automatic=false}={}){
 if(postprocessBusy){if(automatic)postprocessPending=true;return;}
 if(working||!state)return;
 const m=meta(false);if(!m)return;
 const settings=postprocessSettings();
 if(['none','rules'].includes(settings.mode)){
  if(!automatic)setStatus('Обработка через ИИ отключена. Выберите в настройках автоматический перевод или редактирование с ИИ.');
  return;
 }
 const list=choosePostprocessCandidates(state,m.displayPostprocessCache||{},m.preferenceTranslations||{},settings)
  .filter(x=>!(x.scope==='events'&&eventHiddenByPrivacy(x.source,m.config)))
  .filter(x=>!automatic||!autoPostprocessFailures.has(`${S().chatId}:${x.scope}:${x.role}:${x.field}:${x.source}`));
 // The explicit button uses consecutive batches; auto-mode only considers the latest state.
 if(!list.length){if(!automatic)setStatus('Новых элементов для перевода на русский нет.');return;}
 if(!automatic&&!window.confirm(`Перевести на русский ${list.length} элементов с помощью ИИ? Возможны дополнительные расходы на API. Исходные записи сохраняются.`))return;
 const origin={chatId:S().chatId,persona:m.userPersonaIdentity,target:selectedNpcId(m)};
 const connection=settings.connection==='same'?null:settings.connection==='current'?'':settings.connection;
 const batches=batchPostprocess(list);
 postprocessBusy=true;postprocessCancel=false;
 if(!automatic){setStatus(`Перевод на русский: 0/${list.length} `);render();}
 let changed=0,failed=0,processed=0;
 try{
  for(const chunk of batches){
   if(postprocessCancel)break;
   if(!postprocessMatches(m,origin))throw new Error('Чат, персона или NPC изменились: перевод остановлен');
   try{
    const raw=await analysisRequest(DISPLAY_POSTPROCESS_SYSTEM,postprocessPrompt(chunk),Math.min(3200,Math.max(800,chunk.length*175)),connection);
    if(!postprocessMatches(m,origin))throw new Error('Изменился чат, персона или NPC');
    const translated=parsePostprocessReply(raw,chunk);
    if(Object.keys(translated).length){
     const previous=m.displayPostprocessCache||{};
     m.displayPostprocessCache=Object.fromEntries(Object.entries({...previous,...translated}).slice(-1500));
     if(!await persist()){m.displayPostprocessCache=previous;throw new Error('Не удалось сохранить кэш перевода');}
     changed+=Object.keys(translated).length;
    }
    failed+=chunk.length-Object.keys(translated).length;
    if(automatic)for(const entry of chunk)if(!Object.hasOwn(translated,postprocessKey(entry)))autoPostprocessFailures.add(`${origin.chatId}:${entry.scope}:${entry.role}:${entry.field}:${entry.source}`);
   }catch(err){
    if(!postprocessMatches(m,origin))throw err;
    console.warn('[Дела того дня] Russian postprocessing skipped batch',err);
    failed+=chunk.length;
    if(automatic)for(const entry of chunk)autoPostprocessFailures.add(`${origin.chatId}:${entry.scope}:${entry.role}:${entry.field}:${entry.source}`);
   }
   processed+=chunk.length;
   if(!automatic)setStatus(`Перевод на русский ${processed}/${list.length} · применено ${changed} · не обработано ${failed}`);
  }
  if(!automatic)setStatus(`${postprocessCancel?'Перевод остановлен':'Перевод завершён'} · переведено: ${changed} · не обработано ${failed} (исходные данные сохранены)`);
  else if(failed){console.warn('[Дела того дня] postprocessing skipped',failed,'items');setStatus(`Анализ завершён · не переведено на русский: ${failed} (исходный текст сохранён)`);}
 }catch(err){if(!automatic)setStatus(`Перевод на русский прерван: ${err.message}`);}
 finally{postprocessBusy=false;postprocessCancel=false;if(postprocessMatches(m,origin))refresh();if(postprocessPending){postprocessPending=false;void runDisplayPostprocess({automatic:true});}}
}
function meta(create=true){
 const c=S(); if(!c?.chatId||!c.chatMetadata)return null;
 if(!c.chatMetadata[STORAGE]&&create){
  const seed=(globalThis.crypto?.randomUUID?.()||`${Date.now()}:${Math.random()}`).replace(/-/g,'');
  const canon=readCanon();
  c.chatMetadata[STORAGE]={schema:VERSION,seed,config:structuredClone(DEFAULT_CONFIG),canon,ledger:{},overrides:{char:{},user:{}},profileInitialized:false,initialProposal:null,userPersonaIdentity:personaIdentity(canon.user),personaProfiles:{}};
  c.saveMetadata?.();
 }
 return c.chatMetadata[STORAGE]||null;
}
function npcTracking(m){
 if(!m.npcTracking)m.npcTracking={mode:'single',activeId:MAIN_TARGET,targets:{},ledgers:{},pending:{}};
 return m.npcTracking;
}
function selectedNpcId(m){const t=npcTracking(m);return t.mode==='multi'?t.activeId:MAIN_TARGET;}
function selectedNpc(m){const id=selectedNpcId(m);return id===MAIN_TARGET?null:npcTracking(m).targets[id]||null;}
function effectiveCanon(m){const t=selectedNpc(m);return t?{char:npcCanon(t),user:m.canon.user}:m.canon;}
function effectiveOverrides(m){const t=selectedNpc(m);return t?{char:t.overrides||{},user:m.overrides.user||{}}:m.overrides;}
function currentRoleOverrides(m,role){if(role==='char'){const t=selectedNpc(m);if(t)return t.overrides??={};}m.overrides[role]??={};return m.overrides[role];}
function currentCharLedger(m){const t=selectedNpc(m);return t?(npcTracking(m).ledgers[t.id]??={}):m.ledger;}
function clearProposalOnTargetChange(m,nextId){
 const t=npcTracking(m),current=selectedNpcId(m);
 if(m.initialProposal)t.pending[current]=m.initialProposal;
 t.activeId=nextId;
 m.initialProposal=t.pending[nextId]||null;
}
function currentNpcReady(m){return npcTracking(m).mode!=='multi'||!!selectedNpc(m);}
async function readWorldBook(name){
 const res=await fetch('/api/worldinfo/get',{method:'POST',headers:getRequestHeaders(),body:JSON.stringify({name}),cache:'no-cache'});
 if(!res.ok)throw new Error(`${name}: HTTP ${res.status}`);
 return res.json();
}
async function scanNpcSources(){
 const c=S(),m=meta(),chatId=c.chatId;
 if(!m||working)return;
 working=true;setStatus('Поиск NPC в книгах мира персонажа и чата…');render();
 try{
  const ch=c.characters?.[c.characterId]||c.characters?.[c.this_chid]||{};
  const data=ch.data||{},sources=[];
  for(const [label,book] of [['Встроенная книга мира персонажа',data.character_book||ch.character_book],['Встроенная книга мира текущего чата',c.chatMetadata?.character_book]]){
   if(book)sources.push({name:label,data:book});
  }
  const nameSources=[c.chatMetadata?.world_info,data.extensions?.world,ch.extensions?.world,data.extensions?.worlds,ch.extensions?.worlds];
  const names=nameSources.flat(Infinity).filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim());
  let failed=[];
  for(const name of [...new Set(names)]){
   try{sources.push({name,data:await readWorldBook(name)});}catch(e){failed.push(`${name}: ${e.message}`);}
  }
  if(S().chatId!==chatId)return setStatus('Чат изменился: результаты поиска NPC отброшены');
  const result=discoverNpcProfilesDetailed(sources);
  npcCandidates=result.profiles;npcReviewEntries=result.reviewEntries;npcScanStats=result.stats;npcScanChatId=chatId;npcSearch='';npcPreviewId='';npcAiBatchOffset=0;
  setStatus(!sources.length?'Нет подключённой или доступной для чтения книги мира':`Первый поиск · кандидатов NPC: ${npcCandidates.length}  · Записей для поиска с ИИ: ${npcReviewEntries.length} записей${failed.length?` · не удалось прочитать книг мира: ${failed.length} `:''}`);
  if(failed.length)console.warn('[Дела того дня] NPC book read warnings:',failed);
 }catch(e){console.error('[Дела того дня] NPC discovery failed',e);setStatus(`Ошибка поиска NPC: ${e.message}`);}finally{working=false;render();}
}
/** Stage 2 never runs automatically: using the current analysis model may incur fees. */
async function scanNpcWithAI(){
 const c=S(),chatId=c.chatId,m=meta();
 if(!m||working)return;
 if(npcScanChatId!==chatId)return setStatus('Сначала выполните первый этап поиска по книге мира');
 if(!npcReviewEntries.length)return setStatus('Дополнительный поиск с ИИ не требуется');
 const plan=makeNpcReviewBatches(npcReviewEntries,Number.MAX_SAFE_INTEGER);
 const start=npcAiBatchOffset;
 const currentBatches=plan.batches.slice(start,start+8);
 if(!currentBatches.length)return setStatus(start?'Дополнительный поиск с ИИ завершён':'Нет подходящих записей книги мира для анализа ИИ');
 working=true;let added=0,rejected=0,errors=0,completed=0;
 try{
  for(let i=0;i<currentBatches.length;i++){
   if(S().chatId!==chatId){setStatus('Чат изменился: дополнительный поиск с ИИ остановлен');return;}
   const batch=currentBatches[i];
   setStatus(`Поиск NPC с ИИ ${start+i+1}/${plan.totalBatches} · возможны дополнительные расходы на API`);render();
   try{
    const answer=await analysisRequest(NPC_AI_SYSTEM,buildNpcReviewPrompt(batch),2400);
    if(S().chatId!==chatId){setStatus('Чат изменился: результаты поиска с ИИ отброшены');return;}
    const result=parseNpcAiSuggestions(answer,batch,npcCandidates);
    added+=result.profiles.length-npcCandidates.length;
    rejected+=result.rejected;
    npcCandidates=result.profiles;completed++;
   }catch(e){errors++;console.warn('[Дела того дня] Ошибка поиска NPC с ИИ:',readableProfileError(e));}
  }
  if(npcScanChatId===chatId){
   npcAiBatchOffset=start+currentBatches.length;
   const more=npcAiBatchOffset<plan.totalBatches?` · осталось ${plan.totalBatches-npcAiBatchOffset} пакетов (нажмите ещё раз для продолжения)`:'';
   setStatus(`Всего NPC: ${npcCandidates.length}  (добавлено ИИ: ${added}) · проверено ${completed}/${currentBatches.length} пакетов · исключено без подтверждения: ${rejected} ${errors?` · Ошибка ${errors} пакетов`:''}${more}`);
  }
 }finally{working=false;render();}
}
async function switchNpc(targetId){
 const m=meta(),t=npcTracking(m);if(working)return setStatus('Дождитесь окончания анализа, прежде чем менять отслеживаемого персонажа');
 if(targetId!==MAIN_TARGET&&!t.targets[targetId])return setStatus('NPC не найден. Повторите поиск');
 clearProposalOnTargetChange(m,targetId);t.mode=targetId===MAIN_TARGET?'single':'multi';
 await persist();refresh();setStatus(targetId===MAIN_TARGET?'Включено отслеживание одного персонажа':`CHAR Отслеживаемый персонаж: ${t.targets[targetId].name}`);
}
function renderNpcTarget(){
 const m=meta(false);if(!m)return '';
 const t=npcTracking(m),active=selectedNpc(m),candidateOptions=npcCandidates.filter(x=>npcSearch&&!(x.name.toLowerCase().includes(npcSearch.toLowerCase())||(x.sources||[x.source]).some(source=>source.toLowerCase().includes(npcSearch.toLowerCase())))?false:true);
 const registered=Object.values(t.targets).sort((a,b)=>Number(b.id===active?.id)-Number(a.id===active?.id));
 // Prefer the active saved record if older versions saved the same NPC twice.
 // Preserve existing saved target IDs; collapse duplicate discovery hits only in the selector.
 const options=mergeNpcCandidates(registered,candidateOptions);
 const preview=options.find(x=>x.id===npcPreviewId)||null;
 return `<section class="abop-frame abop-npc"><header>◇ CHAR · Отслеживаемый персонаж <small>Персона USER сохраняется</small></header>
 <p class="abop-muted">В ботах с несколькими персонажами {{char}} может быть рассказчиком. Выберите NPC, чтобы CHAR обозначал только его настройки и события.</p>
 <div class="abop-actions"><button type="button" data-action="singleNpc" ${t.mode==='single'?'disabled':''}>Один персонаж</button><button type="button" data-action="multiNpc" ${t.mode==='multi'?'disabled':''}>Несколько персонажей</button></div>
 ${t.mode==='multi'?`<div class="abop-npc-controls"><p class="abop-muted">Текущий персонаж: <b>${html(active?.name||'Не выбран')}</b> ${active?`· ${html(active.source||'')}`:''}</p>
 <div class="abop-actions"><button type="button" data-action="scanNPCs" ${working?'disabled':''}>1. Найти NPC</button><button type="button" data-action="scanNPCsAI" ${working||npcScanChatId!==S().chatId||!npcReviewEntries.length?'disabled':''}>2. Дополнить поиск с ИИ</button></div>
 <p class="abop-muted">${npcScanChatId===S().chatId?`Кандидатов NPC: ${npcCandidates.length} · доступно записей: ${npcReviewEntries.length} / всего ${npcScanStats?.entryCount||0} `:'Поиск ещё не выполнен'} · Поиск с ИИ запускается вручную и может повлечь расходы на API. Проверьте исходные данные, прежде чем выбирать кандидатов ИИ.</p>
 <label class="abop-fieldlabel">Поиск по имени<input type="search" id="abop-npc-search" data-npc-search value="${html(npcSearch)}" placeholder="Имя или название книги мира" /></label>
 <label class="abop-fieldlabel">Найденные и сохранённые персонажи<select id="abop-npc-select"><option value="">Выберите NPC…</option>${options.map(x=>`<option value="${html(x.id)}" ${(npcPreviewId||active?.id)===x.id?'selected':''}>${html(x.name)} · ${html(x.source||'Добавлено вручную')}${x.sources?.length>1?` (+${x.sources.length-1} источников)`:''}${t.targets[x.id]?' · Сохранено':x.needsReview?' · кандидат ИИ (нужна проверка)':''}</option>`).join('')}</select></label>
 ${preview?`<details class="abop-advanced"><summary>Сведения о выбранном кандидате${preview.needsReview?' · Кандидат ИИ':''}</summary><p class="abop-muted">Источник: ${html((preview.sources?.length?preview.sources:[preview.source]).join(' / '))} · проверьте содержимое перед выбором</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow-y:auto">${html(String(preview.card||'').slice(0,2200))}</pre></details>`:''}
 <div class="abop-actions"><button type="button" class="abop-primary" data-action="selectNpc">Отслеживать этого NPC</button></div>
 <details><summary>＋ Добавить NPC вручную</summary><label class="abop-fieldlabel">Имя<input id="abop-npc-name" maxlength="100" placeholder="Имя персонажа" /></label>
 <label class="abop-fieldlabel">Другие имена и обращения (через запятую)<input id="abop-npc-aliases" placeholder="Имя на английском, прозвище" /></label>
 <label class="abop-fieldlabel">Описание профиля (необязательно)<textarea id="abop-npc-description" rows="6" placeholder="Введите сведения, которых нет в книге мира, или свои исправления"></textarea></label>
 <button type="button" data-action="addNpc">Добавить NPC и отслеживать</button></details></div>`:''}
 <p class="abop-muted">Настройки и результаты анализа каждого NPC сохраняются в метаданных чата. Книга мира сохраняется без изменений. Одновременно отслеживается один NPC; объединение беременности и отношений с несколькими партнёрами пока не поддерживается.</p></section>`;
}
async function persist(){try{if(typeof S().saveMetadata!=='function')throw new Error('SillyTavern Функция сохранения метаданных недоступна');await S().saveMetadata();return true;}catch(e){console.warn('[Дела того дня] Metadata saving failed',e);setStatus('Ошибка сохранения: проверьте консоль разработчика');return false;}}
function readCanon(){
 const c=S(), character=c.characters?.[c.characterId]||c.characters?.[c.this_chid]||{};
 const cd=character.data||{};
 const card=[cd.description||character.description,cd.personality||character.personality,cd.scenario||character.scenario].filter(Boolean).join('\n');
 const user=readCurrentPersona(c,user_avatar,inferExplicit);
 const a=inferExplicit(card);
 return {char:{...a,name:character.name||cd.name||c.name2||'CHAR',card:card.slice(0,7000)},user};
}
/** SillyTavern can auto-switch the active persona AFTER CHAT_CHANGED. Refresh
 * canon from the live persona source, not only from chat metadata creation. */
function syncCanon(){
 const m=meta(false);if(!m)return false;
 const live=readCanon();
 const previousChar=m.canon.char||{};
 const result=syncPersonaProfile(m,live.user);
 // Edited character cards are also refreshed; manual overrides remain authoritative.
 const charUpdated=previousChar.name!==live.char.name||previousChar.card!==live.char.card;
 if(charUpdated){
  const prefs=m.canon.char.preferences;
  m.canon.char={...live.char,...(prefs?{preferences:prefs}:{})};
  m.initialProposal=null;
 }
 if(result.changed){
  setStatus(`USER Синхронизация персоны: ${live.user.name}`);
  log('Active persona changed:',live.user.name);
 }
 if(result.updated || charUpdated){
  void persist();
 }
 return result.changed;
}
function setStatus(s){status=redactErrorSecrets(s);const node=el('abop-statusline');if(node)node.textContent=status;}
function branchState(){
 const m=meta(false);if(!m)return null;
 const chat=S().chat||[];
 const t=selectedNpc(m);
 const rows=t?combineNpcRecords(chat,m.ledger||{},currentCharLedger(m),m.userPersonaIdentity):filterRowsByPersona(sortedRecords(chat,m.ledger||{}),m.userPersonaIdentity);
 const canon=effectiveCanon(m);
 // Only the opening message is eligible; later roleplay does not silently reset a period.
 const opening=chat.find(message=>message&&!message.is_user&&!message.is_system&&String(message.mes||'').trim());
 if(opening&&openingMenstruationEvidence(opening.mes)&&!openingMenstruationEvidence(canon.char?.card)){
  canon.char={...canon.char,openingMenstruationText:String(opening.mes).slice(0,6000)};
 }
 return replay(m.seed,canon,m.config||DEFAULT_CONFIG,rows,effectiveOverrides(m));
}
function updatePrompt(){
 try{
  const c=S();if(typeof c.setExtensionPrompt!=='function')return;
  const m=meta(false);
  const body=state&&m?.config?.enabled&&m?.config?.injectState&&currentNpcReady(m)?formatPrompt(state,false):'';
  c.setExtensionPrompt(PROMPT,body,0,0,false,0);
 }catch(e){console.warn('[Дела того дня] prompt injection unavailable',e);}
}
function refresh(){meta();syncCanon();state=branchState();updatePrompt();render();}
function eventIDFor(messageKey,i){return `${messageKey}/e${i}`;}
function sourceForCurrent(){
 const c=S(),chat=c.chat||[];
 for(let i=chat.length-1;i>=0;i--){
  const m=chat[i];if(!m||m.is_system||m.is_user||!String(m.mes||'').trim())continue;
  const pair=chat[i-1]?.is_user?chat[i-1]:null;
  return {m,i,key:uniqKey(m,i),userText:String(pair?.mes||''),assistantText:String(m.mes||'')};
 }return null;
}
async function analyzeLatest({force=false}={}){
 if(working)return;
 let analyzeSucceeded=false;
 const m=meta();syncCanon();const src=sourceForCurrent();if(!m||!src)return setStatus('Нет сообщений для анализа: CHAR сообщений нет');
 if(!m.config.enabled)return setStatus('Расширение отключено');
 if(!force&&!m.config.autoAnalyze)return;
 if(!currentNpcReady(m))return setStatus('Сначала выберите NPC для отслеживания CHAR');
 const originTarget=selectedNpcId(m), ledger=currentCharLedger(m);
 if(ledger[src.key]?.analyzed&&ledger[src.key]?.personaId===m.userPersonaIdentity&&!force)return;
 const originChat=S().chatId, originKey=src.key, originPersona=m.userPersonaIdentity;
 const c=S();
 working=true;setStatus('Анализ событий отдельной моделью……');render();
 try{
  const last=branchState();
  const ec=effectiveCanon(m);
  const prompt=buildAnalyzerUserPrompt({charName:ec.char.name,charAliases:ec.char.aliases||[],multiNpc:originTarget!==MAIN_TARGET,userName:ec.user.name,charCard:ec.char.card,userPersona:ec.user.card,userText:src.userText,assistantText:src.assistantText,existingState:last?{clockHours:last.clockHours,people:Object.fromEntries(Object.entries(last.people).map(([k,p])=>[k,{name:p.name,sex:p.sex,secondary:p.secondary,phase:p.cycle.phase,pregnancy:p.pregnancy.status}]))}:null});
  const reply=await analysisRequest(ANALYZER_SYSTEM,prompt,2200);
  syncCanon();
  if(S().chatId!==originChat||m.userPersonaIdentity!==originPersona||selectedNpcId(m)!==originTarget||!sourceForCurrent()||sourceForCurrent().key!==originKey){setStatus('Результаты отброшены: изменился чат, персона или ответ');return;}
  const events=parseModelOutput(reply,src.userText,src.assistantText).map((e,i)=>({...e,id:eventIDFor(originKey,i),sceneId:e.sceneId||originKey,...(e.kind==='bond'?{allowMultipleAtCreation:m.config.asymmetricBond===true}:{})}));
  // A newly analyzed CHAR response without a scene snapshot must not leave a stale
  // earlier posture/activity visible as the current scene.
  // Each analyzed speaker's scene snapshot must have fresh evidence. In particular,
  // a previous USER pose must not linger as the current scene when the new USER turn
  // contains no supported scene event.
  for(const role of ['char',...(src.userText.trim()?['user']:[])]){
   if(!events.some(e=>e.kind==='scene'&&e.person===role))events.push({
    id:eventIDFor(originKey,events.length),kind:'scene_unverified',person:role,
    sceneId:originKey
   });
  }
  const existing=ledger[originKey]||{};
  if(existing.personaId&&existing.personaId!==originPersona){setStatus('Этот ответ относится к прежней USER персоне. Повторите анализ на новом ответе.');return;}
  if(originTarget===MAIN_TARGET){
   ledger[originKey]={analyzed:true,events:[...events,...(existing.manual||[])],manual:existing.manual||[],personaId:originPersona,at:Date.now()};
  }else{
   const charEvents=events.filter(e=>!sharedEvent(e)), userEvents=events.filter(sharedEvent);
   ledger[originKey]={analyzed:true,events:[...charEvents,...(existing.manual||[])],manual:existing.manual||[],personaId:originPersona,at:Date.now()};
   const common=m.ledger[originKey]||{};
   if(!common.personaId||common.personaId===originPersona){
    const oldEvents=common.events||[];
    const signature=e=>`${e.kind}|${e.person||''}|${e.evidence||''}|${e.hours||''}`;
    const seen=new Set(oldEvents.map(signature));
    const additional=userEvents.filter(e=>{const k=signature(e);if(seen.has(k))return false;seen.add(k);return true;});
    m.ledger[originKey]={...common,events:[...oldEvents,...additional],personaId:originPersona,at:Date.now()};
   }
  }
  if(!await persist())throw new Error('Не удалось сохранить результаты анализа');setStatus(`Анализ завершён · подтверждённых событий: ${events.length} `);refresh();analyzeSucceeded=true;
 }catch(e){console.error('[Дела того дня] generation error',e);setStatus(`Ошибка анализа: ${e.message||'Проверьте модель и подключение API'}`);}finally{working=false;render();if(analyzeSucceeded)void runDisplayPostprocess({automatic:true});}
}
/** An opt-in, never-auto-applied, chronological historical scan.
 * All model responses remain in memory until an explicit preview confirmation. */
function matchingHistoryExists(ledger,npcLedger,multi,item){
 return [...matchingRecordedEvents(ledger[item.key],npcLedger[item.key],multi),
 ...(item.parentKey!==item.key?matchingRecordedEvents(ledger[item.parentKey],npcLedger[item.parentKey],multi):[])].some(e=>eventIdentity(e)===item.identity);
}
async function previewHistoryState(){
 if(working)return;
 const m=meta();syncCanon();
 if(!m?.config?.enabled)return setStatus('Включите расширение для повторного анализа');
 if(!currentNpcReady(m))return setStatus('Сначала выберите NPC для отслеживания CHAR');
 const c=S(),target=selectedNpcId(m),personaId=m.userPersonaIdentity;
 const chat=c.chat||[],sources=collectHistorySources(chat);
 if(!sources.length)return setStatus('В истории нет сообщений для повторного анализа');
 if(!window.confirm(`Отправить ${sources.length} сообщений истории в ИИ по порядку для повторного анализа? Каждый запрос может повлечь расходы на API. На этом этапе записи не меняются.`))return;
 const chatId=c.chatId,fingerprint=historySnapshot(chat),canonFingerprint=JSON.stringify(effectiveCanon(m)),bondMode=m.config.asymmetricBond===true;
 const existingShared=structuredClone(m.ledger||{}),existingNpc=structuredClone(target===MAIN_TARGET?{}:currentCharLedger(m));
 let results={};
 historyStatePreview=null;historyScanCancelled=false;
 working=true;setStatus(`Повторный анализ истории · 0/${sources.length} `);render();
 try{
  const ec=effectiveCanon(m),multi=target!==MAIN_TARGET;
  for(let i=0;i<sources.length;i++){
   if(historyScanCancelled)throw new Error('Анализ отменён пользователем');
   if(S().chatId!==chatId||historySnapshot(S().chat||[])!==fingerprint||meta(false)!==m||m.userPersonaIdentity!==personaId||selectedNpcId(m)!==target||JSON.stringify(effectiveCanon(m))!==canonFingerprint)throw new Error('Анализ остановлен: изменился чат, сообщения, персона или выбранный персонаж');
   const src=sources[i];
   try{
    // Do not feed future messages into the historical state context.
    const earlierChat=chat.slice(0,src.index);
    const cand=buildHistoryCandidates(sources.slice(0,i),results,existingShared,existingNpc,multi,personaId);
    const tempShared=structuredClone(existingShared),tempNpc=structuredClone(existingNpc);
    appendHistorySelections({ledger:tempShared,npcLedger:tempNpc,multiNpc:multi,personaId,targetId:target,config:m.config,
      candidates:cand.pending,selectedIds:new Set(cand.pending.map(item=>`${item.key}#${item.ordinal}`))});
    const rows=multi?combineNpcRecords(earlierChat,tempShared,tempNpc,personaId):filterRowsByPersona(sortedRecords(earlierChat,tempShared),personaId);
    const prior=replay(m.seed,ec,m.config||DEFAULT_CONFIG,rows,effectiveOverrides(m));
    const existingState={clockHours:prior.clockHours,people:Object.fromEntries(Object.entries(prior.people).map(([id,person])=>[id,{name:person.name,sex:person.sex,secondary:person.secondary,phase:person.cycle.phase,pregnancy:person.pregnancy.status,condition:person.body.condition,pheromoneEmission:person.pheromone.emission}]))};
    const prompt=buildAnalyzerUserPrompt({charName:ec.char.name,charAliases:ec.char.aliases||[],multiNpc:multi,
      userName:ec.user.name,charCard:ec.char.card,userPersona:ec.user.card,
      userText:src.userText,assistantText:src.assistantText,existingState});
    const raw=await analysisRequest(ANALYZER_SYSTEM,prompt,2600);
    // An invalid JSON reply is a failed scan, not a confirmed zero-event message.
    const envelope=String(raw||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'');
    const decoded=JSON.parse(envelope.slice(envelope.indexOf('{'),envelope.lastIndexOf('}')+1));
    if(!Array.isArray(decoded?.events))throw new Error('Модель не вернула массив events');
    const events=parseModelOutput(raw,src.userText,src.assistantText).map(e=>{
     if(src.userKey&&e.evidence&&src.userText.includes(e.evidence)&&(e.person==='user'||e.kind==='time_advance'||!src.assistantText.includes(e.evidence)))
      return {...e,__sourceKey:src.userKey,__sourceIndex:src.userIndex};
     return e;
    });
    results[src.key]={events,capped:decoded.events.length>=12};
   }catch(err){
    results[src.key]={error:String(err?.message||err).slice(0,200)};
    console.warn('[Дела того дня] Historical message analysis failed',src.index+1,err);
   }
   setStatus(`Повторный анализ истории · ${i+1}/${sources.length} · можно отменить`);
   if(i%3===2||i===sources.length-1)render();
  }
  if(historyScanCancelled)throw new Error('Анализ отменён пользователем');
  if(S().chatId!==chatId||historySnapshot(S().chat||[])!==fingerprint||meta(false)!==m||m.userPersonaIdentity!==personaId||selectedNpcId(m)!==target||JSON.stringify(effectiveCanon(m))!==canonFingerprint)throw new Error('Результаты отброшены: изменился чат, персона или выбранный персонаж');
  const reviewed=buildHistoryCandidates(sources,results,existingShared,existingNpc,target!==MAIN_TARGET,personaId);
  historyStatePreview={chatId,fingerprint,canonFingerprint,bondMode,personaId,target,reviewed,total:sources.length,capped:Object.values(results).filter(r=>r.capped).length,createdAt:new Date().toISOString()};
  setStatus(`Анализ завершён · новых кандидатов: ${reviewed.pending.length} / повторов: ${reviewed.duplicates.length} / ошибок: ${reviewed.errors.length} · проверьте перед применением`);
 }catch(err){historyStatePreview=null;setStatus(`Результаты повторного анализа не применены: ${err.message}`);}
 finally{working=false;historyScanCancelled=false;render();}
}
async function initialProfileAnalyze(){
 const m=meta();syncCanon();if(!m||working)return;
 if(!currentNpcReady(m))return setStatus('Сначала выберите NPC для отслеживания CHAR');
 const targetId=selectedNpcId(m);
 working=true;tab='setup';setStatus('CHAR·USER Подготовка предложений для профиля…');render();
 const chatId=S().chatId, originalPersona=m.userPersonaIdentity;
 try{
  const setupInput=buildProfileSetupInput(effectiveCanon(m),effectiveOverrides(m));
  const setupMax=normalizeSetupOutputTokens(sharedAnalysisSettings().setupMaxTokens);
  let draft;
  try{
   const result=await analysisRequest(PROFILE_SYSTEM,setupInput,setupMax);
   draft=normalizeSetupProposal(result,chatId);
   completeInitialIdentityProposal(draft,{canon:effectiveCanon(m),overrides:effectiveOverrides(m),seed:`${m.seed}:${targetId}:${originalPersona}`});
  }catch(firstError){
   // Only malformed model output gets a format retry; API failures must retain their actual cause.
   if(!(firstError instanceof SetupJsonFormatError))throw firstError;
   setStatus('Неверный формат начального анализа · повтор с кратким JSON (одна попытка)…');render();
   const brief='FORMAT RETRY: Preserve the same role fields, confirmed/latent evidence rules and candidate counts. Output a COMPLETE valid JSON object only; no markdown or trailing prose. Write values, reasons and candidate labels in natural Russian, keep machine IDs and enums in English. Keep each reason under 65 Russian characters. Omit unsupported fields rather than adding filler.\n'+PROFILE_SYSTEM;
   try{
    const retry=await analysisRequest(brief,setupInput,setupMax);
    draft=normalizeSetupProposal(retry,chatId);
    completeInitialIdentityProposal(draft,{canon:effectiveCanon(m),overrides:effectiveOverrides(m),seed:`${m.seed}:${targetId}:${originalPersona}`});
   }catch(secondError){
    if(secondError instanceof SetupJsonFormatError)throw new Error(`Начальный анализ дважды вернул неполный результат. Проверьте лимит вывода модели и подключение. (Повтор: ${secondError.message})`,{cause:secondError});
    throw secondError;
   }
  }
  syncCanon();
  if(S().chatId!==chatId||m.userPersonaIdentity!==originalPersona||selectedNpcId(m)!==targetId){setStatus('Результаты отброшены: изменился чат или персона');return;}
  // AI secondary choice is preserved; compatible anatomy is assigned from the permitted pool.
  draft.personaIdentity=originalPersona;draft.targetId=targetId;
  // Models can be wrong. Explicit manual settings always start unchecked/locked.
  for(const role of ['char','user']){
   const locked=effectiveOverrides(m)?.[role]||{};
   for(const field of draft.roles[role].fields)if(Object.hasOwn(locked,field.key))field.checked=false;
  }
  m.initialProposal=draft;await persist();
  setStatus('Предложения готовы · отметьте нужные и примените');refresh();
 }catch(e){console.error('[Дела того дня] initial proposal failed',e);setStatus(`Не удалось подготовить предложения для профиля: ${readableProfileError(e)}`);}
 finally{working=false;render();}
}
const PROPOSAL_SELECT={
 sex:[['male','Мужской'],['female','Женский'],['nonbinary','Другое']],
 secondary:[['alpha','Альфа'],['beta','Бета'],['omega','Омега']],
};
const LEVELS=[['latent','Возможный интерес'],['liked','Нравится'],['strongly_liked','Очень нравится'],['disliked','Не нравится'],['restricted','Граница']];
const choiceHTML=(arr,chosen)=>arr.map(([v,label])=>`<option value="${html(v)}" ${String(chosen)===String(v)?'selected':''}>${html(label)}</option>`).join('');
function renderSetup(){
 const m=meta(false);if(!m)return '';
 const draft=m.initialProposal;
 const hint='<p class="abop-muted">Факты из карточки и персоны отделены от предположений по характеру. В профиль попадут только отмеченные пункты. Закреплённые вручную значения защищены.</p>';
 const owns=effectiveOverrides(m),roleReset=['char','user'].map(r=>{
  const list=Object.keys(owns?.[r]||{}).filter(k=>RESETTABLE_FIELDS.includes(k));
  return `<div class="abop-reset-row"><b>${r.toUpperCase()} · Закреплено вручную ${list.length} </b><div class="abop-actions"><select id="abop-clear-field-${r}" aria-label="${r} Поле для открепления"><option value="">Выберите закреплённое поле</option>${list.map(k=>`<option value="${html(k)}">${html(({sex:'Пол',secondary:'Альфа · Бета · Омега',anatomy:'Тип тела',menstruationEnabled:'Наличие менструации',cycleEnabled:'Течка / гон',cycleMode:'Режим течки / гона',baseCondition:'Базовое самочувствие',basePheromone:'Базовые феромоны'})[k]||k)}</option>`).join('')}</select><button data-action="clearFixedField" data-role="${r}" ${list.length?'':'disabled'}>Открепить выбранное</button><button data-action="resetInitialProfile" data-role="${r}">Сбросить профиль</button></div></div>`;
 }).join('');
 const resetBlock=`<section class="abop-frame"><header>◇ Сброс профиля · текущий чат</header><p class="abop-muted">Открепляет поля или перезапускает начальную настройку. История RP, события анализа и циклов сохраняются. Полный сброс затрагивает CHAR и текущую персону USER.</p>${roleReset}<div class="abop-actions"><button data-action="resetInitialProfile" data-role="both">Сбросить CHAR + USER</button></div></section>`;
 if(!draft||draft.chatId!==S().chatId||draft.personaIdentity!==m.userPersonaIdentity||draft.targetId!==selectedNpcId(m))return `<section class="abop-frame"><header>◇ Начальная настройка профиля</header><h3 class="abop-title">Комплексный анализ профиля</h3>${hint}<p>Предлагает анатомию, репродуктивные возможности, феромоны, особенности прикосновений, голоса, речи и близости. Если вторичный пол не задан в карточке или вручную, он предлагается по характеру и предпочтениям; анатомия выбирается из совместимых вариантов. Изменения вступят в силу только после выбора и применения.</p><button data-action="init">Создать предложения для CHAR + USER</button></section>${resetBlock}`;
 const missingABO=missingInitialSecondaryRoles(draft,{canon:effectiveCanon(m),overrides:effectiveOverrides(m)});
 if(missingABO.length)return `<section class="abop-frame"><header>◇ Предложения для начального профиля <small>Требуется обновление</small></header>${hint}<p>В прежнем черновике отсутствует ${missingABO.map(x=>x.toUpperCase()).join(' · ')} вторичный пол. Применение заблокировано. Повторный анализ предложит ABO и соответствующие настройки репродукции и цикла.</p><button data-action="init" class="abop-primary">Повторить анализ CHAR + USER</button></section>${resetBlock}`;
 let out=`<section class="abop-frame"><header>◇ Предложения для начального профиля <small>Неприменённый черновик</small></header>${hint}
 <div class="abop-actions"><button data-action="init">Повторить анализ</button><button data-action="discardProposal">Отбросить предложения</button></div></section>`;
 for(const role of ['char','user']){
  const d=draft.roles[role],own=effectiveOverrides(m)?.[role]||{};
  out+=`<section class="abop-frame"><header>◇ ${role.toUpperCase()} · ${html(effectiveCanon(m)[role]?.name||'')}</header>
  <p class="abop-muted">Галочка слева = применить поле · значения можно редактировать.</p><div class="abop-proposal-fields">`;
  for(const [i,f] of d.fields.entries()){
   const disabled=Object.hasOwn(own,f.key),checked=f.checked&&!disabled;
   const inferredSex=own.sex||d.fields.find(x=>x.key==='sex')?.value||state?.people[role]?.sex||'unknown';
   const inferredABO=own.secondary||d.fields.find(x=>x.key==='secondary')?.value||state?.people[role]?.secondary||'unknown';
   const choices=f.key==='anatomy'?anatomyChoices(inferredSex,inferredABO):PROPOSAL_SELECT[f.key];
   const options=choices&&choices.some(([v])=>v===f.value)?choices:choices?[...choices,[f.value,'Предложено: '+f.value]]:null;
   const edit=typeof f.value==='boolean'?`<select data-proposal-value="${role}" data-i="${i}">${choiceHTML([['true','Да'],['false','Нет']],f.value)}</select>`:
    typeof f.value==='number'?`<input type="number" min="0" max="100" step="1" data-proposal-value="${role}" data-i="${i}" value="${fmt(f.value)}" />`:
    options?`<select data-proposal-value="${role}" data-i="${i}">${choiceHTML(options,f.value)}</select>`:
    `<input type="text" data-proposal-value="${role}" data-i="${i}" value="${html(f.value)}" />`;
   out+=`<div class="abop-proposal-row"><label class="abop-check abop-proposal-check"><input type="checkbox" data-proposal-check="${role}" data-i="${i}" ${checked?'checked':''} ${disabled?'disabled':''}/><span class="abop-sr-only">${html(f.label)} Применить</span></label>
    <div class="abop-proposal-content"><div class="abop-rowhead"><b>${html(f.label)}</b><span class="abop-basis ${f.basis}">${f.basis==='explicit'?'Указано в карточке':f.source==='arbitrary'?'Выбрано из вариантов':f.source==='abo_default'?'По правилам ABO':'По характеру и предпочтениям'}</span>${disabled?'<span class="abop-basis">Закреплено вручную</span>':''}</div>${edit}<small>${html(f.reason||'Анализ карточки и персоны')}</small></div></div>`;
  }
  out+=`</div><h3 class="abop-setup-subtitle">Близость и возможные предпочтения <span>3–5 возможных интересов · подтверждённые отдельно</span></h3>`;
  for(const [kind,list] of [['confirmed',d.confirmed],['latent',d.latent]]){
   for(const [i,pref] of list.entries()){
    out+=`<div class="abop-proposal-row"><label class="abop-check abop-proposal-check"><input type="checkbox" data-pref-check="${role}" data-kind="${kind}" data-i="${i}" ${pref.checked?'checked':''}/><span class="abop-sr-only">${html(preferenceDisplayLabel(pref,m.preferenceTranslations||{}))} Применить</span></label>
     <div class="abop-proposal-content"><div class="abop-rowhead"><b>${kind==='confirmed'?'Подтверждено карточкой':pref.source==='optional'?'Вариант на выбор':'Возможное предпочтение'}</b><span class="abop-basis ${kind==='confirmed'?'explicit':'suggested'}">${kind==='confirmed'?'Подтверждённое предпочтение':pref.source==='optional'?'Вариант на выбор':pref.source==='custom'?'Добавлено вручную':'Предполагаемое предпочтение'}</span></div>
     <input data-pref-id="${role}" data-kind="${kind}" data-i="${i}" type="text" value="${html(preferenceDisplayLabel(pref,m.preferenceTranslations||{}))}" title="Исходный ID: ${html(pref.id)}" aria-label="Название предпочтения" />
     ${kind==='confirmed'?`<select data-pref-level="${role}" data-i="${i}">${choiceHTML(LEVELS.filter(x=>x[0]!=='latent'),pref.level)}</select>`:''}
     <small>${html(pref.reason||'Предложение по характеру и описанию персонажа')}</small></div></div>`;
   }
  }
  out+=`<div class="abop-pref-add"><label>Добавить свой вариант<input id="abop-newpref-${role}" type="text" placeholder="Например: забота после близости, ролевая игра, эксгибиционизм" maxlength="80" /></label><button data-action="addPref" data-role="${role}" type="button">+ Добавить вариант</button></div><p class="abop-muted">Это общие варианты для выбора. Применяются только отмеченные.</p>`;
  out+=`<div class="abop-rowhead abop-attitude"><label class="abop-check"><input type="checkbox" data-pref-attitude-check="${role}" ${d.useAttitude?'checked':''}/> Применить отношение к близости</label>
   <select data-pref-attitude="${role}">${choiceHTML([['open','Открытость'],['reserved','Сдержанность'],['curious','Только любопытство']],d.attitude)}</select></div></section>`;
 }
 return out+`<section class="abop-frame abop-applybar"><p class="abop-muted">До применения не влияет на книгу мира, расчёт беременности и RP.</p><button data-action="applyProposal" class="abop-primary">✓ Применить выбранные предложения</button></section>${resetBlock}`;
}
async function applyProfileProposal(){
 const m=meta(),draft=m?.initialProposal;
 syncCanon();
 if(!draft||draft.chatId!==S().chatId||draft.personaIdentity!==m.userPersonaIdentity||draft.targetId!==selectedNpcId(m))return setStatus('Персона изменилась: прежние предложения применить нельзя');
 const missingABO=missingInitialSecondaryRoles(draft,{canon:effectiveCanon(m),overrides:effectiveOverrides(m)});
 if(missingABO.length)return setStatus(`${missingABO.join('·').toUpperCase()} В прежнем анализе отсутствует вторичный пол. Повторите анализ.`);
 // Physiological defaults are contingent on an applied, explicit, or manually
 // fixed ABO type. Never commit them against a hidden provisional STATUS roll.
 for(const role of ['char','user']){
  const rec=draft.roles?.[role],canon=effectiveCanon(m)?.[role]||{},own=effectiveOverrides(m)?.[role]||{};
  const approved=['alpha','beta','omega'].includes(own.secondary)||['alpha','beta','omega'].includes(canon.secondary)||rec?.fields?.some(f=>f.key==='secondary'&&f.checked);
  if(!approved&&rec?.fields?.some(f=>f.checked&&['anatomy','gestate','impregnate','menstruationEnabled','cycleEnabled'].includes(f.key))){
   return setStatus(`${role.toUpperCase()} Сначала отметьте вторичный пол, чтобы применить связанные предложения анатомии, репродукции и цикла.`);
  }
 }
 let applied=0;
 for(const role of ['char','user']){
  const rec=draft.roles?.[role];if(!rec)continue;
  const own=currentRoleOverrides(m,role);
  for(const f of rec.fields){
   if(!f.checked||Object.hasOwn(own,f.key))continue;
   own[f.key]=f.value;applied++;
  }
  const chosen=[...(rec.confirmed||[]),...(rec.latent||[])].some(p=>p.checked);
  if(chosen||rec.useAttitude){
   const target=role==='char'?selectedNpc(m):null;
   if(target)target.preferences=mergeSelectedPreferences(target.preferences,rec);
   else m.canon[role].preferences=mergeSelectedPreferences(m.canon[role].preferences,rec);
   applied += [...(rec.confirmed||[]),...(rec.latent||[])].filter(p=>p.checked).length;
  }
 }
 m.profileInitialized=true;m.initialProposal=null;
 await persist();tab='status';refresh();setStatus(`Выбранных предложений: ${applied} · применено`);
}
/** Do not present dormant interval timings as an active heat/rut cycle.
 * Non-ABO menstruation is a separate flag (e.g. female Beta). */
function remainingLabel(hours){
 if(!Number.isFinite(hours))return 'Невозможно рассчитать';
 const minutes=Math.max(0,Math.ceil(hours*60));if(minutes===0)return 'Сейчас';
 const d=Math.floor(minutes/1440),h=Math.floor((minutes%1440)/60),min=minutes%60;
 return [d?`${d} дн.`:'',h?`${h} ч`:'',min?`${min} мин.`:''].filter(Boolean).join(' ')+' осталось';
}
function cycleOverview(p,clock,seed,hideTruth=false){
 const f=cycleForecast(p,clock,seed);const m=f.mode;
 const category=p.secondary==='omega'?'Течка':p.secondary==='alpha'?'Гон':'Течка / гон';
 const fertility=`<p class="abop-muted">Отслеживание менструации: ${p.menstruation.enabled?'Включено':'Отключено'} · Способность вынашивать: ${p.fertile.gestate?'Да':'Нет'}</p>`;
 const label={enabled:'Включено',disabled:'Отслеживание отключено',absent:'Цикл отсутствует',unset:'Не задано'}[m]||'Не задано';
 const row=(name,h)=>`<div class="abop-line"><span>${name}</span> <b>${html(remainingLabel(h))}</b></div>`;
 let lines=`<p>Текущее состояние: <b>${f.paused?(hideTruth?'Цикл приостановлен (причина скрыта)':'Цикл приостановлен из-за беременности или родов'):m==='enabled'?cyclePhaseLabel(f.phase):label}</b></p>`;
 if(m==='enabled'&&!f.paused){
  lines+=row('Конец текущей фазы',f.currentEndHours);
  lines+=row('Следующие предвестники',f.nextProdromeHours);
  lines+=row(`Следующая фаза: ${category}`,f.nextActiveHours);
  lines+=row(`${category} завершится · начало восстановления`,f.nextRecoveryHours);
  lines+=row('Восстановление завершится · начало покоя',f.nextQuietHours);
 }else if(m!=='enabled')lines+=`<p class="abop-muted">${label} — ${category} — оставшееся время не рассчитывается.</p>`;
 if(f.menstruationStatus==='active')lines+=`<p class="abop-menstruating"><b>● Менструация</b>${p.menstruation.source==='opening'?' · по вступлению':p.menstruation.source==='manual'?' · записано вручную':''}</p>${row('Конец текущей менструации',f.menstruationEndHours)}${row('Следующая менструация',f.nextMenstruationHours)}`;
 else if(f.menstruationStatus==='waiting')lines+=row('Следующая менструация',f.nextMenstruationHours);
 else if(f.menstruationStatus==='paused')lines+=hideTruth?'<p>Менструация: приостановлена (причина скрыта)</p>':'<p>Менструация: приостановлена из-за беременности или родов (дата возобновления неизвестна)</p>';
 else if(f.menstruationStatus==='unknown')lines+='<p>Следующая менструация: исходная дата не определена</p>';
 else lines+='<p>Следующая менструация: неприменимо</p>';
 lines+=fertility;
 if(m==='enabled')lines+=`<details><summary>Параметры цикла</summary><p>Интервал: ${fmt(p.cycle.intervalHours/24)} дн. · предвестники: ${fmt(p.cycle.prodromeHours)} ч · активная фаза: ${fmt(p.cycle.activeHours/24)} дн. · восстановление: ${fmt(p.cycle.recoveryHours)} ч</p></details>`;
 return lines;
}
function projectedHistoryStateHtml(m,selectedIds){
 try{
  const preview=historyStatePreview;
  if(!preview||!state)return '<p class="abop-muted">Не удалось рассчитать ожидаемое состояние.</p>';
  const target=selectedNpcId(m),multi=target!==MAIN_TARGET;
  const shared=structuredClone(m.ledger||{}),npc=multi?structuredClone(currentCharLedger(m)):{};
  const selected=preview.reviewed.pending.filter(x=>selectedIds.has(`${x.key}#${x.ordinal}`));
  const count=appendHistorySelections({ledger:shared,npcLedger:npc,multiNpc:multi,personaId:m.userPersonaIdentity,
   targetId:target,config:m.config,candidates:selected,selectedIds});
  const chat=S().chat||[],rows=multi?combineNpcRecords(chat,shared,npc,m.userPersonaIdentity):filterRowsByPersona(sortedRecords(chat,shared),m.userPersonaIdentity);
  const next=replay(m.seed,effectiveCanon(m),m.config||DEFAULT_CONFIG,rows,effectiveOverrides(m));
  const parts=Object.entries(state.people).map(([id,person])=>{
   const after=next.people[id];if(!after)return '';
   return `${id.toUpperCase()} Самочувствие ${fmt(person.body.condition)} → ${fmt(after.body.condition)}, Феромоны ${fmt(person.pheromone.emission)} → ${fmt(after.pheromone.emission)}`;
  });
  return `<p class="abop-muted">Выбранных новых событий: ${count} · прогноз сюжетного времени: ${fmt(state.clockHours)} → ${fmt(next.clockHours)} ч</p><p class="abop-muted">${parts.map(html).join('<br>')}</p>`;
 }catch(e){return `<p class="abop-muted">Ошибка расчёта ожидаемых показателей: ${html(e.message)}</p>`;}
}
function renderHistoryStatePreview(m){
 const saved=m.historyStateReviewInfo;
 const last=saved?`<p class="abop-muted">Последний применённый повторный анализ: ${html(saved.appliedAt||'Неизвестно')} · ${Number(saved.count)||0} </p>`:'';
 const p=historyStatePreview;
 if(!p||p.chatId!==S().chatId||p.target!==selectedNpcId(m)||p.personaId!==m.userPersonaIdentity)return last;
 const {pending,duplicates,errors}=p.reviewed,hideTruth=m.config.hideTruth===true;
 const label=e=>`${e.person?`${personRoleLabel(e.person)} · `:''}${e.kind==='vital_observation'?'Изменение тела и феромонов':eventKindLabel(e.kind)}${e.kind==='time_advance'&&Number.isFinite(e.hours)?` · +${fmt(e.hours)} ч`:''}`;
 const concealed=e=>hideTruth&&['exposure','pregnancy_reveal','pregnancy_end','delivery'].includes(e.kind);
 return `<section class="abop-frame"><header>Повторный анализ состояния в истории · предпросмотр</header>
 <p>Просмотрено сообщений: ${p.total} · новых кандидатов: ${pending.length} · повторов записей: ${duplicates.length} · ошибок анализа: ${errors.length} · ранее добавленных событий: ${countHistoryStateEvents(m.ledger,selectedNpcId(m)===MAIN_TARGET?{}:currentCharLedger(m))} </p>
 ${p.capped?`<p class="abop-muted">В сообщениях: ${p.capped} достигнут лимит в 12 событий. Часть событий могла остаться нераспознанной.</p>`:''}
 <p class="abop-muted">По умолчанию выбраны только новые кандидаты. Синхронизация времени, ручные и прежние записи сохраняются. Время не выводится из количества ходов без прямых указаний в тексте.</p>
 <div id="abop-history-projection">${projectedHistoryStateHtml(m,new Set(pending.map(x=>`${x.key}#${x.ordinal}`)))}</div>
 ${pending.length?`<div class="abop-sync-results">${pending.map(item=>`<label class="abop-line"><input type="checkbox" data-history-state="${html(`${item.key}#${item.ordinal}`)}" checked> Сообщение ${item.index+1} · ${html(concealed(item.event)?'Событие со скрытым состоянием':label(item.event))} — ${html(concealed(item.event)?'основание скрыто по настройкам':(item.event.evidence||'Нет основания').slice(0,220))}</label>`).join('')}</div>`:'<p>Нет новых кандидатов для применения.</p>'}
 ${duplicates.length?`<p class="abop-muted">Уже записанных событий: ${duplicates.length} · повторное применение исключено.</p>`:''}
 ${errors.slice(0,12).map(x=>`<p class="abop-muted">Исключено из анализа · сообщение ${x.index+1}: ${html(x.message)}</p>`).join('')}
 ${errors.length>12?`<p class="abop-muted">Других ошибок анализа: ${errors.length-12} </p>`:''}
 <div class="abop-actions"><button data-action="applyHistoryState" ${pending.length?'':'disabled'}>Применить выбранные события</button><button data-action="cancelHistoryState">Отбросить результат</button></div></section>${last}`;
}
function renderTimeSyncPreview(m){
 const saved=m.timeSyncInfo;
 const note=saved?`<p class="abop-muted">Последнее применение: ${html(saved.appliedAt||'Неизвестно')} · ${Number(saved.count)||0} </p>`:'';
 const p=timeSyncPreview;
 if(!p||p.chatId!==S().chatId)return note;
 const r=p.result,items=r.matches;
 return `<section class="abop-frame"><header>Предпросмотр синхронизации</header>
 <p>Кандидатов: ${items.length} · время требует проверки: ${(r.uncertain||[]).length} / просмотрено сообщений: ${r.scanned} · прежних записей синхронизации: ${syncedHistoryEventCount(m.ledger)} </p>
 <p class="abop-muted">Ниже приведены кандидаты, найденные по текстовым шаблонам. Среди них могут быть реплики, воспоминания и повторы. Снимите отметки с неподходящих записей.</p>
 ${items.length?`<div class="abop-sync-results">${items.map((x,i)=>`<label class="abop-line"><input type="checkbox" data-sync-index="${i}" checked> Сообщение ${x.index+1} · ${html(x.speaker)} · ${html(x.kind==='time_advance'?`+${x.hours} ч`:`${personRoleLabel(x.person)} ${eventKindLabel(x.kind)}`)} — ${html(x.evidence)}</label>`).join('')}</div>`:'<p>Однозначных указаний времени не найдено. Прежние записи сохраняются.</p>'}
 ${(r.uncertain||[]).slice(0,25).map(x=>`<p class="abop-muted">Время требует проверки · сообщение ${x.index+1}: ${html(x.evidence)} — ${html(x.reason)}</p>`).join('')}
 ${r.warnings.slice(0,15).map(w=>`<p class="abop-muted">Внимание: ${html(w)}</p>`).join('')}
 ${r.warnings.length>15?`<p class="abop-muted">Дополнительных замечаний: ${r.warnings.length-15} </p>`:''}
 <div class="abop-actions"><button data-action="applyTimeSync" ${items.length?'':'disabled'}>Применить выбранное</button><button data-action="cancelTimeSync">Отмена</button></div>
 <p class="abop-muted">Ручные и автоматические события сохраняются. Проверьте время перед применением: уже записанные события могут привести к двойному учёту.</p></section>${note}`;
}
function sceneDetailRows(scene,role){
 const fields=[['Поза','posture',scene.posture],['Контакт','contact',scene.contact],['Звуки и голос','vocal',scene.vocal],['Реплики','speech',scene.speech]];
 if(Array.isArray(scene.play)&&scene.play.length)for(const raw of scene.play)fields.push(['Другие действия','play',raw]);
 return fields.filter(([,field,value])=>String(value??'').trim()).map(([name,field,value])=>`<div class="abop-line"><span class="abop-scene-key">${name}</span><span>${html(localizedScene('scene',role,field,value))}</span></div>`).join('');
}
// CHAR is the primary scene view. USER scenes are shown only when they have
// independently supported current details or stored completed scenes.
function renderSceneHistory(person,role){
 const recent=Array.isArray(person?.recentScenes)?person.recentScenes:[];
 return `<hr/><p class="abop-muted">Завершённых сцен:: ${recent.length} (хранятся последние 3)</p>${recent.length?`<details class="abop-scene-history"><summary>Показать завершённые сцены</summary>${recent.slice().reverse().map((scene,i)=>`<div class="abop-line"><small>${i+1}.</small> ${html(localizedSceneSummary(scene,role))}</div>`).join('')}</details>`:'<p class="abop-muted">Нет завершённых сцен</p>'}`;
}
function renderCurrentScene(person,role){
 if(person?.scene?.verified===false)return '<p class="abop-muted">Последнее повествование не подтверждает текущую сцену.</p>';
 return hasUsableScene(person)?`<div class="abop-scene-details">${sceneDetailRows(person.scene,role)}</div>`:'<p class="abop-muted">Нет подтверждённых данных о позе и контакте.</p>';
}
function renderSceneTab(people){
 const char=people.find(([id])=>id==='char')?.[1];
 const user=people.find(([id])=>id==='user')?.[1];
 const primary=char?`<section class="abop-frame abop-scene-primary"><header>CHAR · Текущая сцена</header><div class="abop-title">${html(char.name)}</div>${renderCurrentScene(char,'char')}${renderSceneHistory(char,'char')}</section>`:'';
 // Avoid an equally-sized empty USER card. Do not invent USER scene evidence
 // from the assistant's narration; the event parser protects USER agency.
 const supplemental=user&&(hasUsableScene(user)||hasSceneHistory(user))?`<details class="abop-frame abop-scene-user"><summary>USER · ${html(user.name)} · Показать историю сцен</summary>${hasUsableScene(user)?`<div class="abop-scene-details">${sceneDetailRows(user.scene,'user')}</div>`:''}${renderSceneHistory(user,'user')}</details>`:'';
 return `<div class="abop-scenes-char-first">${primary}${supplemental}</div>`;
}
function selectedSection(){
 const m=meta(false);if(!state||!m)return `<p class="abop-muted">Откройте чат, чтобы пользоваться расширением.</p>`;
 const people=Object.entries(state.people);
 if(!currentNpcReady(m)&&tab!=='settings')return renderNpcTarget()+'<section class="abop-frame"><p class="abop-muted">В режиме нескольких персонажей сначала выберите NPC. До выбора рассказчик не анализируется как CHAR.</p></section>';
 if(tab==='setup')return renderSetup();
 if(tab==='status')return `${renderNpcTarget()}<div class="abop-people">${people.map(([id,p])=>personCard(id,p,m)).join('')}</div>
  <section class="abop-frame"><header>◈ Сюжетное время и события</header><p class="abop-meta">${Math.floor(state.clockHours/24)} дн. · ${fmt(state.clockHours%24)} ч / записей: ${state.events.length} </p>
  <div class="abop-actions"><button data-action="registerBondNpc">Добавить NPC для связи</button><button data-action="manualBond">Записать связь / утрату связи</button></div>
  <div class="abop-actions"><button data-action="previewTimeSync" ${working?'disabled':''}>Синхронизировать время по истории</button></div>
  <p class="abop-muted">Ручной запуск · поиск явного течения времени и начала циклов · неясное время исключается · предпросмотр перед применением</p>
  ${renderTimeSyncPreview(m)}
  <div class="abop-actions"><button data-action="previewHistoryState" ${working?'disabled':''}>Повторно проанализировать историю</button>${working?'<button data-action="cancelHistoryScan">Остановить анализ</button>':''}</div>
  <p class="abop-muted">Ручной запуск · ИИ анализирует историю от старых сообщений к новым (возможны расходы на API) · повторы исключаются · изменения после подтверждения</p>
  ${renderHistoryStatePreview(m)}
  <div class="abop-actions"><input id="abop-hours" type="number" min="0" step="1" placeholder="Прошло времени(h)" aria-label="Прошло времени"/><button data-action="advance">Применить время</button><button data-action="rebuild">Пересчитать</button></div>
  ${state.alerts.slice(-3).map(x=>displayAlertKo(x,m.config.hideTruth===true)).filter(Boolean).map(x=>`<p class="abop-note">${html(x)}</p>`).join('')}
  <details><summary>Последние события</summary>${state.events.slice(-14).reverse().map(e=>`<div class="abop-line">${Math.floor(e.at/24)} дн. · ${html(eventHiddenByPrivacy(e.kind,m.config)?'Событие со скрытым состоянием':eventSummaryKo(e))}</div>`).join('')||'Нет записей'}</details></section>`;
 if(tab==='cycles')return `<div class="abop-people">${people.map(([id,p])=>`<section class="abop-frame"><header>${id.toUpperCase()} · ${p.cycle.enabled?'Состояние цикла':p.menstruation.enabled?'Менструация и препараты':`${cycleModeLabel(cycleMode(p))} · Препараты`}</header><p class="abop-title">${html(p.name)}</p>${cycleOverview(p,state.clockHours,state.seed,m.config.hideTruth===true)}<div class="abop-actions"><button data-action="recordMenstruationStart" data-role="${id}" ${!p.menstruation.enabled?'disabled':''}>Записать начало менструации</button><button data-action="recordMenstruationEnd" data-role="${id}" ${cycleForecast(p,state.clockHours,state.seed).menstruationStatus!=='active'?'disabled':''}>Записать конец менструации</button></div><p class="abop-muted">Записывайте только подтверждённые в сюжете события. Явное указание менструации во вступлении автоматически учитывается в начальном состоянии.</p>
 <details><summary>Препараты · побочные эффекты · толерантность</summary><p class="abop-muted">Приём ${p.medication.length} · записей побочных эффектов: ${p.adverse.length} </p>
 ${(p.adverse||[]).slice(-4).map(x=>`<div class="abop-line">${html(drugLabel(x.drug))} · ${html((x.symptoms||[x.type||'Другое']).map(adverseLabel).join(', '))}${Number.isFinite(x.until)&&x.until<state.clockHours?' (прошло)':''}</div>`).join('')||'<p class="abop-muted">Нет записей побочных эффектов</p>'}
 <p class="abop-muted">Толерантность: ${html(Object.entries(p.tolerance||{}).map(([k,v])=>`${drugLabel(k)} ${v}`).join(' · ')||'Нет записей')}</p>
 <div class="abop-actions"><select id="abop-drug-${id}" aria-label="${id} Тип препарата">${[['oral_suppressant','Пероральный подавитель'],['long_suppressant','Подавитель длительного действия'],['emergency_suppressant','Экстренный подавитель'],['scent_blocker','Блокатор феромонов'],['oral_contraceptive','Обычный контрацептив'],['emergency_contraceptive','Экстренный контрацептив'],['symptom_inducer','Индуктор симптомов'],['cycle_inducer','Индуктор цикла'],['unlicensed_mixture','Неодобренная смесь']].map(([v,label])=>`<option value="${v}">${label}</option>`).join('')}</select>
 <select id="abop-drug-mode-${id}" aria-label="${id} Способ применения"><option value="normal">Обычное применение</option><option value="misuse">Неправильное применение</option><option value="unlicensed">Неодобренное применение</option></select>
 <button data-action="recordMedication" data-role="${id}">Записать подтверждённый приём</button></div>
 <p class="abop-muted">Записывайте только подтверждённый приём. Не дублируйте записи автоматического анализа. Вероятности и симптомы определяются вымышленными правилами мира.</p></details></section>`).join('')}</div>`;
 if(tab==='fertility')return `${m.config.pregnancyEnabled===false?'<section class="abop-frame"><header>Симуляция беременности OFF</header><p>Расчёт беременности и передача состояния в RP отключены. Записи сохраняются и пересчитываются после включения.</p></section>':''}<div class="abop-people">${people.map(([id,p])=>`<section class="abop-frame"><header>${id.toUpperCase()} · Фактическое состояние тела</header><div class="abop-title">${html(p.name)}</div><p>Беременность: <b>${m.config.hideTruth?'●●●● (спойлер скрыт)':html(pregnancyLabel(p.pregnancy.status))}</b></p><p>Осведомлённость: ${html(pregnancyLabel(p.awareness.pregnancy))}</p><p>Ожидаемые роды: ${p.pregnancy.dueAt===null?'—':`${Math.floor(p.pregnancy.dueAt/24)} дн. · ${fmt(p.pregnancy.dueAt%24)} ч`}</p><p>Связь: ${html((p.bondPartners||[]).map(pid=>state.people[pid]?.name||pid).join(', ')||'Нет')}</p></section>`).join('')}</div><section class="abop-frame"><header>◈ История фертильности и вероятности беременности</header>${Object.values(state.windows).map(w=>`<div class="abop-line">${html(state.people[w.gestator]?.name||personRoleLabel(w.gestator))} · Эпизодов ${w.exposures.length} · суммарно ${(w.total*100).toFixed(1)}% · ${m.config.hideTruth?'Результат скрыт':`Фиксированное случайное число ${w.roll.toFixed(4)}`}</div>`).join('')||'<p>Нет записей расчёта</p>'}<button data-action="exposure" ${m.config.pregnancyEnabled===false?'disabled title="Симуляция беременности отключена"':''}>Записать возможность зачатия вручную</button></section>`;
 if(tab==='preferences')return `<section class="abop-frame"><div class="abop-actions"><button data-action="translatePreferences" ${working?'disabled':''}>Перевести подписи с помощью ИИ</button></div><p class="abop-muted">Переводит неизвестные английские коды и улучшает формулировки. Выполняется отдельный запрос к ИИ; возможны расходы на API. </p><p class="abop-muted">[Граница]: То, к чему персонаж относится осторожно или с ограничениями. Это отдельная категория от запрета и неприязни.</p></section><div class="abop-people">${people.map(([id,p])=>`<section class="abop-frame"><header>${id.toUpperCase()} · Предпочтения</header><div class="abop-title">${html(p.name)}</div><p class="abop-muted">Отношение: ${html(attitudeLabel(p.preferences.attitude))}</p><h4 class="abop-minihead">Подтверждённые и наблюдавшиеся предпочтения</h4>${p.preferences.confirmed.map(x=>`<div class="abop-line">${html(localizedPreference(x,m,id))} <small>[${html(preferenceLevelLabel(x.level))}]</small></div>`).join('')||'<p class="abop-muted">Нет записей</p>'}<h4 class="abop-minihead">Возможные интересы и варианты</h4>${p.preferences.latent.map(x=>`<div class="abop-line">${html(localizedPreference(x,m,id))} <small>[${html(preferenceLevelLabel(x.level))}]</small></div>`).join('')||'<p class="abop-muted">Нет вариантов</p>'}</section>`).join('')}</div>`;
 if(tab==='scenes')return renderSceneTab(people);
 const shared=sharedAnalysisSettings();
 return `<section class="abop-frame"><header>◈ Настройки</header>
  <div class="abop-title">Оформление</div>
  <label class="abop-fieldlabel">Цветовая тема<select data-theme-choice>${choiceHTML([['auto','Как в системе'],['light','Светлая'],['dark','Тёмная']],m.config.uiTheme||'auto')}</select></label>
  <p class="abop-muted">Тема и параметры симуляции сохраняются для каждого чата. Подключение анализа и лимит токенов общие для всех чатов.</p><hr/>
  <div class="abop-title">Подключение модели анализа</div>
  <label class="abop-fieldlabel">API / сохранённый профиль для анализа
  <select id="abop-connection" data-connection>${connectionOptions(shared)}</select></label>
  <p class="abop-muted">По умолчанию используется текущее подключение SillyTavern. При ошибке проверьте провайдера и учётные данные API в SillyTavern, затем обновите сохранённый профиль.</p>
  ${connectionValue(shared)==='custom'?`<div class="abop-api-fields">
    <label class="abop-fieldlabel">Адрес API, совместимого с OpenAI<input type="url" data-custom="customApiUrl" value="${html(shared.customApiUrl||'')}" placeholder="https://api.example.com/v1" /></label>
    <label class="abop-fieldlabel">Название модели<input type="text" data-custom="customModel" value="${html(shared.customModel||'')}" placeholder="model-id" /></label>
    <label class="abop-fieldlabel">Ключ API (только в памяти)<input type="password" data-secret placeholder="${sessionApiKey?'Указан · введите новый для замены':'Введите ключ API'}" autocomplete="off" /></label>
    <p class="abop-muted">Ключ не сохраняется в чате, настройках и экспорте. После обновления страницы введите его снова. Прямые запросы требуют поддержки CORS провайдером. Если её нет, используйте сохранённый профиль.</p>
    <button data-action="clearKey">Удалить временный ключ API</button>
  </div>`:''}
  <label class="abop-fieldlabel">Лимит выходных токенов начального анализа<input type="number" min="${MIN_SETUP_OUTPUT_TOKENS}" max="${MAX_SETUP_OUTPUT_TOKENS}" step="1" data-custom="setupMaxTokens" value="${html(normalizeSetupOutputTokens(shared.setupMaxTokens))}" /></label>
  <p class="abop-muted">Фактический лимит вывода зависит от модели и провайдера. При использовании текущего подключения в SillyTavern передаётся заданная длина ответа.</p>
  <button data-action="refreshProfiles">Обновить список профилей</button><button data-action="testConnection">Проверить подключение анализа</button><p class="abop-muted">Профиль, адрес API, модель и лимит начального анализа общие для всех чатов. Ключ API хранится только в памяти браузера и удаляется при обновлении страницы.</p>
  <hr/><div class="abop-title">Перевод отображаемого текста на русский</div>
  <label class="abop-fieldlabel">Режим обработки<select data-postprocess="mode">${choiceHTML([['none','Отключено (сохранить текущий текст)'],['rules','Только встроенный словарь · без ИИ'],['auto','Автоматический перевод нужных выражений с ИИ'],['full','Перевод и редактирование с ИИ']],postprocessSettings().mode)}</select></label>
  <label class="abop-fieldlabel">Модель для перевода<select data-postprocess="connection">${postprocessConnectionOptions(postprocessSettings().connection)}</select></label>
  <p class="abop-muted">Можно выбрать отдельный сохранённый профиль. Прямое API использует подключение анализа. Автоперевод выполняется после анализа только для нужных выражений и может повлечь расходы на API.</p>
  <div class="abop-title">Что переводить</div>
  ${[['preference','Предпочтения'],['scene','Текущая сцена'],['history','Завершённые сцены'],['events','Типы последних событий'],['status','Описания состояния']].map(([key,label])=>`<label class="abop-check"><input type="checkbox" data-postprocess-scope="${key}" ${postprocessSettings().scopes.includes(key)?'checked':''}/> ${label}</label>`).join('')}
  <div class="abop-actions"><button data-action="postprocessExisting" ${postprocessBusy?'disabled':''}>Перевести существующие записи чата</button><button data-action="resetPostprocessCache" ${postprocessBusy?'disabled':''}>Очистить кэш перевода</button>${postprocessBusy?'<button data-action="cancelPostprocess">Остановить перевод</button>':''}</div>
  <p class="abop-muted">Кнопка переводит прежние записи пакетами. Перевод кэшируется в текущем чате и используется только на экране. Внутренние ID, события и числовые показатели сохраняются. При ошибке остаётся исходный текст.</p>
  <hr/><label class="abop-check"><input type="checkbox" data-config="enabled" ${m.config.enabled?'checked':''}/> Включить расширение</label><label class="abop-check"><input type="checkbox" data-config="autoAnalyze" ${m.config.autoAnalyze?'checked':''}/> Отдельный анализ каждого ответа (возможны расходы на API)</label><label class="abop-check"><input type="checkbox" data-config="injectState" ${m.config.injectState?'checked':''}/> Передавать внутреннее состояние в следующий RP</label><label class="abop-check"><input type="checkbox" data-config="hideTruth" ${m.config.hideTruth?'checked':''}/> Скрывать результат беременности (модель продолжает его получать)</label>
  <label class="abop-check"><input type="checkbox" data-config="pregnancyEnabled" ${m.config.pregnancyEnabled!==false?'checked':''}/> Включить симуляцию беременности (для текущего чата)</label>
  <label class="abop-check"><input type="checkbox" data-config="asymmetricBond" ${m.config.asymmetricBond?'checked':''}/> Асимметричная связь (выкл.: взаимное влияние альфы и омеги; вкл.: альфа может иметь несколько связей, феромоны и стресс разлуки влияют только на омегу)</label>
  <p class="abop-muted">При отключении вероятность беременности, её развитие и передача состояния в RP не рассчитываются. Записи сохраняются; после включения прежние события пересчитываются с теми же случайными числами. В текущем чате рекомендуется сначала создать резервную копию.</p>
  <hr/><div class="abop-title">Препараты из книги мира</div>
  ${worldInfoDrugReferenceHtml()}
  <hr/><div class="abop-title">Базовая вероятность беременности (%)</div>${Object.entries(m.config.rate).map(([k,v])=>`<label class="abop-number">${html(rateLabel(k))} <input type="number" min="0" max="100" step="1" data-rate="${k}" value="${fmt(v*100)}" /></label>`).join('')}<hr/><div class="abop-title">Вероятности действия препаратов (%)</div>
  <p class="abop-muted">Вымышленные вероятности для игрового мира. Они не описывают действие и применение реальных препаратов.</p>
  ${[['oralContraceptiveEffectiveness','Снижение риска при действии обычного контрацептива'],['emergencyContraceptiveReduction','72 ч: снижение риска от экстренной контрацепции'],['longSuppressantSuccess','Успешное подавление овуляции длительным подавителем']].map(([key,label])=>`<label class="abop-number">${label} <input type="number" min="0" max="100" step="1" data-probability="${key}" value="${fmt((m.config[key]??DEFAULT_CONFIG[key])*100)}" /></label>`).join('')}
  <label class="abop-number">Множитель вероятности побочных эффектов (%) <input type="number" min="0" max="300" step="5" data-probability="sideEffectScale" value="${fmt((m.config.sideEffectScale??1)*100)}" /></label>
  <p class="abop-muted">Базовая вероятность побочных эффектов: пероральный подавитель — 8%, длительный — 12%, экстренный — 10%, блокатор феромонов — 4%, обычный контрацептив — 8%, экстренный — 10%. Множитель применяется к каждому препарату отдельно.</p>
  <hr/><button data-action="openSetup">Открыть начальную настройку профиля</button><button data-action="reanalyze">Повторно проанализировать последний ответ</button><button data-action="export">Экспортировать данные чата</button><p class="abop-muted">Ручные изменения имеют приоритет перед автоматическим анализом. Применяются только события выбранного варианта ответа.</p></section>`;
}
function personCard(id,p,m){
 const own=effectiveOverrides(m)?.[id]||{};
 const options=(val,items)=>items.map(([k,v])=>`<option value="${k}" ${val===k?'selected':''}>${v}</option>`).join('');
 const canonicalABO=effectiveCanon(m)?.[id]?.secondary;
 const displayedABO=own.secondary||(['alpha','beta','omega'].includes(canonicalABO)?canonicalABO:'unknown');
 return `<section class="abop-frame abop-person"><header><span class="abop-icon">${id==='char'?'◇':'◆'}</span> ${id.toUpperCase()} <small>${id==='char'?'Персонаж':'Персона'}</small></header>
 <div class="abop-title">${html(p.name)}</div>
 <div class="abop-fields"><label>Пол<select data-person="${id}" data-field="sex">${options(p.sex,[['unknown','Не задано'],['male','Мужской'],['female','Женский'],['nonbinary','Другое']])}</select></label>
 <label>Альфа · Бета · Омега<select data-person="${id}" data-field="secondary">${options(displayedABO,[['unknown','Не задано · предложить с ИИ'],['alpha','Альфа'],['beta','Бета'],['omega','Омега']])}</select></label>
 <label>Тип тела<select data-person="${id}" data-field="anatomy">${options(p.anatomy||anatomyDefault(p.sex,p.secondary),anatomyChoices(p.sex,p.secondary))}</select></label>
 <label>Состояние гона / течки<select data-person="${id}" data-field="cycleMode">${options(cycleMode(p),[['enabled','Включено · рассчитывать цикл'],['disabled','Отключено · не отслеживать'],['absent','Физиологически отсутствует'],['unset','Не задано · отложить решение']])}</select></label></div>
 <div class="abop-savebar"><small>Изменения сохраняются автоматически. Автоматически назначенный ABO тоже можно подтвердить.</small><button type="button" data-action="saveABO" data-role="${id}">Сохранить ABO</button></div>
 <details class="abop-advanced"><summary>Базовые показатели · ручное редактирование</summary><p class="abop-muted">Текущие показатели учитывают базу, цикл, препараты, побочные эффекты и состояние в сюжете. Общие значения 70/50 из старой версии не закрепляются автоматически.</p><div class="abop-fields"><label>Базовое самочувствие (0–100)<input type="number" min="0" max="100" step="1" data-person="${id}" data-field="baseCondition" value="${fmt(p.vitalBaseline.condition)}" /></label><label>Базовые феромоны (0–100)<input type="number" min="0" max="100" step="1" data-person="${id}" data-field="basePheromone" value="${fmt(p.vitalBaseline.emission)}" /></label></div><p class="abop-muted">Основание оценки: ${html(localizedText('status',id,'baseline',p.vitalBaseline.source||'',p.vitalBaseline.source||'Индивидуальная базовая оценка'))}</p></details>
 <div class="abop-meterlabel">Текущее самочувствие <b>${fmt(p.body.condition)}</b></div><div class="abop-meter"><i style="width:${clamp(p.body.condition,0,100)}%"></i></div>
 <div class="abop-meterlabel">Выделение феромонов <b>${fmt(p.pheromone.emission)}</b></div><div class="abop-meter mint"><i style="width:${clamp(p.pheromone.emission,0,100)}%"></i></div>
 <div class="abop-tagrow"><span>${p.cycle.enabled?html(cyclePhaseLabel(p.cycle.phase)):html(cycleModeLabel(cycleMode(p)))}</span>${p.menstruation.phase==='menstruating'?'<span class="abop-menses-tag">● Менструация</span>':''}<span>${html(({alpha:'Альфа',beta:'Бета',omega:'Омега'})[displayedABO]||'Не задано · ожидается предложение ИИ')}</span><span>${p.bondWith?'Связь ♥':'Без связи'}</span></div>
 <div class="abop-muted">Партнёры по связи: ${html((p.bondPartners||[]).map(pid=>state.people[pid]?.name||pid).join(', ')||'Нет')} · ${html(cycleModeLabel(cycleMode(p)))}</div>
 ${bondEffects(state,id)?`<div class="abop-muted">Феромоны связи: партнёр ${bondEffects(state,id).partnerScentSensitivity>=0?'+':''}${bondEffects(state,id).partnerScentSensitivity} · другие ${bondEffects(state,id).otherScentSensitivity} · Дискомфорт +${bondEffects(state,id).otherScentDiscomfort} · Чувствительность (партнёр / другие) ${effectivePheromoneResponse(state,id).partnerSensitivity}/${effectivePheromoneResponse(state,id).otherSensitivity} · Стресс разлуки (база / текущая течка или гон) ${bondSeparationStress(state,id,{separated:true}).total}</div>`:''}
 <div class="abop-muted">Действующие эффекты: ${p.medication.filter(x=>x.until>=state.clockHours).map(x=>html(drugLabel(x.drug))).join(', ')||'Нет'}</div>
 ${p.anatomy==='custom'?`<label class="abop-fieldlabel">Особая репродуктивная анатомия<textarea data-person="${id}" data-field="anatomyDetail" rows="2" placeholder="Описание анатомии">${html(p.anatomyDetail||'')}</textarea></label>`:''}
 ${p.sex==='female'&&p.secondary==='alpha'?`<details class="abop-advanced"><summary>Женщина-альфа · вымышленный репродуктивный орган</summary><label class="abop-fieldlabel">Описание органа и репродуктивного пути<textarea data-person="${id}" data-field="inseminationOrgan" rows="2" placeholder="Способность к зачатию независимо от внешнего вида">${html(p.inseminationOrgan||'')}</textarea></label></details>`:''}
 </section>`;
}
/** Keep the mobile dialog wholly inside the *visible* viewport. On iOS Safari,
 * 100vh can extend behind browser controls; visualViewport tracks that space. */
function syncTrackerViewport(){
 const node=el('abop-panel');if(!node)return;
 const v=window.visualViewport;
 const width=v?.width||window.innerWidth;
 const height=v?.height||window.innerHeight;
 const left=v?.offsetLeft||0;
 const top=v?.offsetTop||0;
 node.style.setProperty('--abop-viewport-width',`${Math.max(1,Math.round(width))}px`);
 node.style.setProperty('--abop-viewport-height',`${Math.max(1,Math.round(height))}px`);
 node.style.setProperty('--abop-viewport-left',`${Math.max(0,Math.round(left))}px`);
 node.style.setProperty('--abop-viewport-top',`${Math.max(0,Math.round(top))}px`);
}
function render(){
 const root=el('abop-panel');if(!root)return;
 const previousScroll=root.querySelector('.abop-main')?.scrollTop||0;
 root.classList.toggle('abop-visible',panelOpen);
 if(panelOpen)syncTrackerViewport();
 const m=meta(false);
 const theme=m?.config?.uiTheme||'auto';
 root.dataset.theme=theme==='light'||theme==='dark'?theme:(window.matchMedia?.('(prefers-color-scheme: dark)')?.matches?'dark':'light');
 root.innerHTML=`<div class="abop-window"><div class="abop-top"><span class="abop-brandmark" aria-hidden="true"></span><strong>Дела того дня <small>ТРЕКЕР ABO</small></strong><span class="abop-version">v1.0.1</span><button title="Переключить тему" aria-label="Переключить тему" data-action="themeCycle" class="abop-theme-button">◐</button><button title="Закрыть" aria-label="Закрыть" data-action="close">✕</button></div>
 <div class="abop-shell"><nav class="abop-nav">${[['status','Состояние','▦'],['setup','Профиль','◈'],['cycles','Циклы','◷'],['fertility','Зачатие','✦'],['preferences','Интересы','♥'],['scenes','Сцены','▣'],['settings','Настройки','⚙']].map(([id,label,icon])=>`<button data-tab="${id}" class="${tab===id?'selected':''}"><span>${icon}</span><small>${label}</small></button>`).join('')}</nav>
 <main class="abop-main"><div class="abop-subhead"><span>◈ ${({'status':'Состояние','setup':'Начальная настройка','cycles':'Циклы','fertility':'Беременность','preferences':'Предпочтения','scenes':'Сцены','settings':'Настройки'}[tab]||tab.toUpperCase())} / ${html(S()?.chatId?'Текущий чат':'Нет чата')}</span><span class="abop-dot">● ${working?'Анализ…':'Готово'}</span></div>${selectedSection()}</main></div><footer class="abop-statusbar" id="abop-statusline" role="status" aria-live="polite">${html(status)}</footer></div>`;
 const scrollArea=root.querySelector('.abop-main');if(scrollArea)scrollArea.scrollTop=previousScroll;
}
function openTrackerPanel(){
 panelOpen=true;
 syncTrackerViewport();
 refresh();
 requestAnimationFrame(()=>el('abop-panel')?.querySelector('[data-action="close"]')?.focus({preventScroll:true}));
}
function buildUI(){
 // Remove a surviving old floating launcher if extensions hot-reload in place.
 el('abop-open')?.remove();
 if(!el('abop-panel')){
  const panel=document.createElement('div');panel.id='abop-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Дела того дня');panel.addEventListener('click',handlePanelClick);panel.addEventListener('change',handlePanelChange);document.body.appendChild(panel);
 }
 if(!window.__abopViewportListenerInstalled){
  window.__abopViewportListenerInstalled=true;
  window.addEventListener('resize',syncTrackerViewport,{passive:true});
  window.visualViewport?.addEventListener('resize',syncTrackerViewport,{passive:true});
  window.visualViewport?.addEventListener('scroll',syncTrackerViewport,{passive:true});
  document.addEventListener('keydown',event=>{
   if(event.key!=='Escape'||!panelOpen)return;
   panelOpen=false;render();
  });
 }
 syncTrackerViewport();
 const ready=()=>{
  const result=mountExtensionLaunchers(document,openTrackerPanel);
  return result.menu&&result.settings;
 };
 if(ready())return;
 // The host may inject its extension menu after an extension script is loaded.
 // Observe only briefly, to avoid a persistent observer during roleplay.
 if(typeof MutationObserver==='function'){
  const observer=new MutationObserver(()=>{if(ready())observer.disconnect();});
  observer.observe(document.body,{childList:true,subtree:true});
  setTimeout(()=>{observer.disconnect();ready();},15000);
 }else{
  setTimeout(ready,500);
  setTimeout(ready,2000);
 }
}
async function handlePanelChange(e){
 const t=e.target,m=meta();if(!m)return;
 if(t.hasAttribute('data-history-state')){
  const node=el('abop-history-projection');
  if(node)node.innerHTML=projectedHistoryStateHtml(m,new Set([...el('abop-panel').querySelectorAll('[data-history-state]:checked')].map(x=>x.dataset.historyState)));
  return;
 }
 if(t.hasAttribute('data-npc-search')){npcSearch=t.value;render();return;}
 if(t.id==='abop-npc-select'){npcPreviewId=t.value;render();return;}
 if(t.hasAttribute('data-theme-choice')){m.config.uiTheme=t.value;
 }else if(t.dataset.proposalCheck){const field=m.initialProposal?.roles?.[t.dataset.proposalCheck]?.fields?.[Number(t.dataset.i)];if(field)field.checked=t.checked;
 }else if(t.dataset.proposalValue){
  const role=t.dataset.proposalValue,rec=m.initialProposal?.roles?.[role],f=rec?.fields?.[Number(t.dataset.i)];
  if(f){
   if(typeof f.value==='number'){const n=Number(t.value);if(!Number.isFinite(n)||t.value.trim()===''||n<0||n>100)return setStatus('Введите базовое значение от 0 до 100');f.value=Math.round(n);}
   else f.value=typeof f.value==='boolean'?t.value==='true':t.value;
   if(['sex','secondary','anatomy'].includes(f.key)){
    const source=effectiveCanon(m)?.[role]||{},manual=effectiveOverrides(m)?.[role]||{};
    const sex=(['male','female','nonbinary'].includes(manual.sex)?manual.sex:null)||rec.fields.find(x=>x.key==='sex')?.value||source.sex||'unknown';
    const abo=manual.secondary||rec.fields.find(x=>x.key==='secondary')?.value||source.secondary||'unknown';
    const anatomy=rec.fields.find(x=>x.key==='anatomy');
    if(anatomy&&!Object.hasOwn(manual,'anatomy')){
     if(f.key==='anatomy')anatomy.source='user_edited';
     else if(!anatomyChoices(sex,abo).some(([value])=>value===anatomy.value)){
      anatomy.value=anatomyChoices(sex,abo)[0]?.[0]||anatomyDefault(sex,abo);
      anatomy.source='arbitrary';anatomy.reason='После изменения пола и вторичного пола выбран новый совместимый ABO вариант анатомии.';
     }
    }
    alignInitialPhysiologyProposal(rec,{source,manual});
   }
  }
 }else if(t.dataset.prefCheck){const pref=m.initialProposal?.roles?.[t.dataset.prefCheck]?.[t.dataset.kind]?.[Number(t.dataset.i)];if(pref)pref.checked=t.checked;
 }else if(t.dataset.prefId){
  const pref=m.initialProposal?.roles?.[t.dataset.prefId]?.[t.dataset.kind]?.[Number(t.dataset.i)];
  if(pref){
   const original=pref.id, shown=preferenceDisplayLabel(pref,m.preferenceTranslations||{}), edited=String(t.value||'').trim();
   pref.id=edited===shown?original:preferenceIdFromEdit(edited,original,pref.label);
   if(edited!==shown){pref.label=/[А-Яа-яЁё]/u.test(edited)?edited:'';if(m.preferenceTranslations)delete m.preferenceTranslations[original];}
  }
 }else if(t.dataset.prefLevel){const pref=m.initialProposal?.roles?.[t.dataset.prefLevel]?.confirmed?.[Number(t.dataset.i)];if(pref&&LEVELS.some(x=>x[0]===t.value))pref.level=t.value;
 }else if(t.dataset.prefAttitude){const d=m.initialProposal?.roles?.[t.dataset.prefAttitude];if(d)d.attitude=t.value;
 }else if(t.dataset.prefAttitudeCheck){const d=m.initialProposal?.roles?.[t.dataset.prefAttitudeCheck];if(d)d.useAttitude=t.checked;
 }else if(t.dataset.person){
  const id=t.dataset.person,field=t.dataset.field;
  let value=field==='cycleEnabled'?t.value==='true':t.value;
  if(['baseCondition','basePheromone'].includes(field)){
   const n=Number(t.value);if(!Number.isFinite(n)||t.value.trim()===''||n<0||n>100)return setStatus('Введите базовое значение от 0 до 100');value=Math.round(n);
  }
  if(field==='secondary'&&value==='unknown')delete currentRoleOverrides(m,id).secondary;
  else currentRoleOverrides(m,id)[field]=value;
 }else if(t.dataset.config){m.config[t.dataset.config]=!!t.checked;
 }else if(t.dataset.postprocess){
  if(t.dataset.postprocess==='mode')saveSharedAnalysisSetting('postprocessMode',t.value);
  else if(t.dataset.postprocess==='connection')saveSharedAnalysisSetting('postprocessConnection',t.value);
  else return;
 }else if(t.hasAttribute('data-postprocess-scope')){
  const scope=t.dataset.postprocessScope;
  if(!POSTPROCESS_SCOPES.includes(scope))return;
  const previous=postprocessSettings().scopes;
  saveSharedAnalysisSetting('postprocessScopes',t.checked?[...new Set([...previous,scope])]:previous.filter(x=>x!==scope));
 }else if(t.hasAttribute('data-connection')){
  saveSharedAnalysisSetting('analysisConnection',t.value);
 }else if(t.dataset.custom){
  saveSharedAnalysisSetting(t.dataset.custom,t.dataset.custom==='setupMaxTokens'?normalizeSetupOutputTokens(t.value):t.value.trim());
 }else if(t.hasAttribute('data-secret')){
  // Never write keys to metadata, world info, backups, or console logs.
  sessionApiKey=t.value.trim();t.value='';setStatus(sessionApiKey?'Временный API ключ сохранён в памяти':'Временный API ключ не задан');
 }else if(t.dataset.rate){m.config.rate[t.dataset.rate]=clamp(Number(t.value)/100,0,1);
 }else if(t.dataset.probability){const key=t.dataset.probability;if(!['oralContraceptiveEffectiveness','emergencyContraceptiveReduction','longSuppressantSuccess','sideEffectScale'].includes(key))return;const n=Number(t.value),max=key==='sideEffectScale'?300:100;if(!Number.isFinite(n)||n<0||n>max)return setStatus(`Диапазон вероятности: 0~${max}%`);m.config[key]=n/100;
 }else return;
 const saved=(t.hasAttribute('data-connection')||t.dataset.custom||t.dataset.postprocess||t.hasAttribute('data-postprocess-scope'))?true:await persist();refresh();
 if(t.dataset.person)setStatus(saved?`${t.dataset.person.toUpperCase()} ${t.dataset.field==='secondary'?'ABO':'Настройки'} изменения сохранены автоматически`:'Ошибка сохранения настроек чата · проверьте консоль');
}
async function addManualEvents(events){
 const m=meta(),src=sourceForCurrent();syncCanon();if(!m||!src)return setStatus('Сначала начните диалог');
 if(!currentNpcReady(m))return setStatus('Сначала выберите NPC для отслеживания CHAR');
 const key=src.key,target=selectedNpcId(m),ledger=currentCharLedger(m);let rec=ledger[key]||{analyzed:false,events:[],manual:[]};
 if(rec.personaId&&rec.personaId!==m.userPersonaIdentity)return setStatus('Этот ответ относится к прежней USER персоне. Записывайте события после нового ответа.');
 const rows=events.map((e,i)=>({...e,id:`${key}/manual:${Date.now()}:${i}`,...(e.kind==='bond'?{allowMultipleAtCreation:m.config.asymmetricBond===true}:{})}));
 if(target!==MAIN_TARGET){
  const shared=rows.filter(sharedEvent),local=rows.filter(e=>!sharedEvent(e));
  if(shared.length){const base=m.ledger[key]||{events:[],manual:[]};base.events.push(...shared);base.manual.push(...shared);base.personaId=m.userPersonaIdentity;m.ledger[key]=base;}
  rec.manual.push(...local);rec.events.push(...local);
 }else{rec.manual.push(...rows);rec.events.push(...rows);}
 rec.personaId=m.userPersonaIdentity;ledger[key]=rec;await persist();refresh();
}
async function handlePanelClick(e){
 const t=e.target.closest('button');if(!t)return;
 if(t.dataset.tab){tab=t.dataset.tab;render();const a=el('abop-panel')?.querySelector('.abop-main');if(a)a.scrollTop=0;return;}
 const act=t.dataset.action;if(!act)return;
 if(act==='close'){panelOpen=false;render();return;}
 if(act==='themeCycle'){const m=meta();m.config.uiTheme=m.config.uiTheme==='dark'?'light':'dark';await persist();refresh();return;}
 if(act==='singleNpc'){await switchNpc(MAIN_TARGET);return;}
 if(act==='multiNpc'){const m=meta(),t=npcTracking(m);if(m.initialProposal)t.pending[MAIN_TARGET]=m.initialProposal;t.mode='multi';t.activeId=t.activeId===MAIN_TARGET?'':t.activeId;m.initialProposal=t.pending[t.activeId]||null;await persist();refresh();setStatus('Режим нескольких персонажей · NPC выберите или добавьте вручную');return;}
 if(act==='scanNPCs'){await scanNpcSources();return;}
 if(act==='scanNPCsAI'){await scanNpcWithAI();return;}
 if(act==='selectNpc'){
  const id=el('abop-npc-select')?.value,m=meta();if(!id)return setStatus('NPC сначала выберите');
  const t=npcTracking(m),candidate=npcCandidates.find(x=>x.id===id);
  if(!t.targets[id]&&candidate)t.targets[id]={...npcCanon(candidate),overrides:{}};
  await switchNpc(id);return;
 }
 if(act==='addNpc'){
  const m=meta(),name=el('abop-npc-name')?.value,description=el('abop-npc-description')?.value;
  const aliases=(el('abop-npc-aliases')?.value||'').split(',').map(x=>x.trim()).filter(Boolean);
  let target;try{target=namedTarget(name,description,'Добавлено вручную',aliases);}catch(e){return setStatus(e.message);}
  const t=npcTracking(m);if(t.targets[target.id])return setStatus('Уже добавлен NPC. Выберите его в списке');
  t.targets[target.id]={...target,overrides:{}};await switchNpc(target.id);return;
 }
 if(act==='registerBondNpc'){
  const raw=window.prompt('Уникальный ID NPC (латиница, цифры, подчёркивание, дефис; 2–48 символов)','');
  if(raw===null)return;
  if(!/^[a-z0-9_-]{2,48}$/i.test(raw))return setStatus('Недопустимый NPC ID.');
  const personId=`npc:${raw.toLowerCase()}`;
  if(branchState()?.people[personId])return setStatus('Такой ID NPC уже зарегистрирован');
  const name=window.prompt('Имя NPC','');if(!name?.trim())return;
  const secondary=window.prompt('ABO: alpha / omega / beta','omega');
  if(!['alpha','omega','beta'].includes(secondary))return;
  await addManualEvents([{kind:'npc_register',person:personId,name:name.trim(),secondary}]);
  setStatus('NPC добавлен');return;
 }
 if(act==='manualBond'){
  const kind=window.prompt('Событие: bond (связь) / bond_loss (утрата)','bond');
  if(!['bond','bond_loss'].includes(kind))return;
  const actor=window.prompt('ID альфы (char / user / зарегистрированный npc:ID)','char');
  const target=window.prompt('ID омеги (char / user / зарегистрированный npc:ID)','user');
  const s=branchState();
  if(!s.people[actor]||!s.people[target]||actor===target)return setStatus('Введите ID зарегистрированного персонажа');
  if(kind==='bond'){
   if(s.people[actor].secondary!=='alpha'||s.people[target].secondary!=='omega')return setStatus('Связь возможна только от альфы к омеге');
   if(!window.confirm('Альфа действительно укусил феромонную железу на загривке омеги и установил связь?'))return;
   await addManualEvents([{kind:'bond',actor,target,person:actor,partner:target,biteLocation:'pheromone_nape',biteConfirmed:true}]);
  }else{
   const cause=window.prompt('Причина утраты: surgery (операция) / drug_adverse (побочный эффект) / death (смерть)','surgery');
   if(!['surgery','drug_adverse','death'].includes(cause))return;
   if(!window.confirm('Утрата связи действительно произошла в сюжете?'))return;
   await addManualEvents([{kind:'bond_loss',person:actor,partner:target,cause}]);
  }
  setStatus('Событие связи сохранено');return;
 }
 if(act==='clearFixedField'||act==='resetInitialProfile'){
  if(working||postprocessBusy)return setStatus('Дождитесь окончания анализа и перевода перед сбросом.');
  const m=meta(),role=t.dataset.role;
  if(!m||!['char','user','both'].includes(role))return;
  const field=act==='clearFixedField'?el(`abop-clear-field-${role}`)?.value:null;
  if(act==='clearFixedField'&&!field)return setStatus('Выберите поле для открепления.');
  const message=field?`Открепить поле ${field} у ${role.toUpperCase()}?`:`${role==='both'?'CHAR + USER':role.toUpperCase()} — сбросить начальные настройки профиля? RP История и результаты анализа сохраняются.`;
  if(!window.confirm(message))return;
  const before=structuredClone({overrides:m.overrides,canon:m.canon,profileInitialized:m.profileInitialized,initialProposal:m.initialProposal,personaProfiles:m.personaProfiles,npcTracking:m.npcTracking});
  let n=0;
  try{n=resetProfileChoices(m,{role,field,target:selectedNpc(m)});}catch(err){return setStatus(err.message);}
  if(!await persist()){
   Object.assign(m,before);refresh();return setStatus('Сброс не сохранён · прежние настройки восстановлены');
  }
  refresh();setStatus(field?`Поле откреплено · ${role.toUpperCase()} ${field}`:`Начальные настройки профиля сброшены · ${n} полей откреплено`);return;
 }
 if(act==='recordMenstruationStart'||act==='recordMenstruationEnd'){
  if(working)return setStatus('Дождитесь окончания анализа, прежде чем добавлять запись.');
  const role=t.dataset.role,s=branchState();
  if(!['char','user'].includes(role)||!s?.people?.[role]?.menstruation.enabled)return setStatus('Запись доступна только при включённом отслеживании менструации.');
  const isEnd=act==='recordMenstruationEnd';
  if(isEnd&&cycleForecast(s.people[role],s.clockHours,s.seed).menstruationStatus!=='active')return setStatus('Нет записи о текущей менструации.');
  if(!window.confirm(`${role.toUpperCase()} — менструация: ${isEnd?'конец':'начало'} — записать в текущий момент сюжета?`))return;
  await addManualEvents([{kind:isEnd?'menstruation_end':'menstruation_start',person:role}]);
  setStatus(`${role.toUpperCase()} Менструация ${isEnd?'конец':'начало'} событие записано`);return;
 }
 if(act==='resetPostprocessCache'){
  if(postprocessBusy||working)return setStatus('Дождитесь окончания перевода перед сбросом.');
  const m=meta();if(!m)return;
  if(!window.confirm('Очистить кэш перевода этого чата? Исходные события, предпочтения и сцены сохраняются. Повторный перевод может повлечь расходы на API.'))return;
  const backup=m.displayPostprocessCache||{};
  m.displayPostprocessCache={};
  if(!await persist()){m.displayPostprocessCache=backup;return setStatus('Не удалось сохранить очистку кэша');}
  for(const key of [...autoPostprocessFailures])if(key.startsWith(`${S().chatId}:`))autoPostprocessFailures.delete(key);
  refresh();setStatus('Кэш перевода текущего чата очищен');return;
 }
 if(act==='cancelPostprocess'){postprocessCancel=true;setStatus('Перевод остановится после завершения текущего запроса. Исходные данные сохраняются.');return;}
 if(act==='postprocessExisting'){await runDisplayPostprocess();return;}
 if(act==='translatePreferences'){
  const m=meta();if(!m||!state||working)return;
  const sourceChat=S().chatId,sourcePersona=m.userPersonaIdentity,sourceNpc=selectedNpcId(m);
  const prefs=Object.values(state.people).flatMap(p=>[...(p.preferences?.confirmed||[]),...(p.preferences?.latent||[])]);
  const items=localizationItems(prefs,m.preferenceTranslations||{});
  if(!items.length)return setStatus('Нет предпочтений для обработки');
  working=true;setStatus(`Перевод подписей на русский · ${items.length} записей`);render();
  try{
   const translated={};
   for(let i=0;i<items.length;i+=30){
    const chunk=items.slice(i,i+30);
    setStatus(`Перевод подписей на русский · ${Math.min(i+chunk.length,items.length)}/${items.length} `);
    const raw=await analysisRequest(PREFERENCE_LOCALIZATION_SYSTEM,localizationPrompt(chunk),Math.max(900,chunk.length*55));
    Object.assign(translated,parseLocalizationOutput(raw,chunk));
   }
   if(S().chatId!==sourceChat||meta(false)!==m||m.userPersonaIdentity!==sourcePersona||selectedNpcId(m)!==sourceNpc){setStatus('Перевод не применён: изменился чат или персона');return;}
   if(!Object.keys(translated).length)throw new Error('Нет русских подписей, прошедших проверку');
   m.preferenceTranslations={...(m.preferenceTranslations||{}),...translated};
   await persist();setStatus(`Русских подписей: ${Object.keys(translated).length} · обработано, исходные предпочтения и уровни сохранены`);
  }catch(err){setStatus(`Ошибка обработки подписей: ${err.message||'Проверьте подключение модели'}`);}
  finally{working=false;refresh();}
  return;
 }
 if(act==='openSetup'){tab='setup';render();return;}
 if(act==='saveABO'){
  const role=t.dataset.role;if(!['char','user'].includes(role))return;
  const m=meta();const selected=el('abop-panel')?.querySelector(`select[data-person="${role}"][data-field="secondary"]`)?.value;
  if(!['alpha','beta','omega'].includes(selected))return setStatus('Неверное выбранное значение ABO');
  currentRoleOverrides(m,role).secondary=selected;
  const saved=await persist();refresh();setStatus(saved?`${role.toUpperCase()} ABO ${selected.toUpperCase()} выбор сохранён`:'Ошибка сохранения настроек ABO · проверьте консоль');return;
 }
 if(act==='applyProposal'){await applyProfileProposal();return;}
 if(act==='addPref'){
  const role=t.dataset.role;
  if(!['char','user'].includes(role))return;
  const m=meta(),d=m?.initialProposal?.roles?.[role];if(!d)return;
  const input=el(`abop-newpref-${role}`);
  const tag=preferenceIdFromEdit(input?.value||'');
  if(!/^[\p{L}\p{N}_ -]{2,80}$/u.test(tag))return setStatus('Название предпочтения: 2–80 символов, буквы, цифры, пробелы и подчёркивания');
  if([...d.confirmed,...d.latent].some(p=>p.id.toLowerCase()===tag.toLowerCase()))return setStatus('Такое предпочтение уже предложено');
  d.latent.push({id:tag,level:'latent',reason:'Вариант, добавленный пользователем',source:'custom',checked:true});
  await persist();refresh();setStatus(`Добавлен новый вариант предпочтения: ${preferenceLabel(tag)}`);return;
 }

 if(act==='discardProposal'){const m=meta();m.initialProposal=null;await persist();refresh();setStatus('Неприменённые предложения отброшены');return;}
 if(act==='refreshProfiles'){refresh();setStatus('Список профилей подключения обновлён');return;}
 if(act==='clearKey'){sessionApiKey='';setStatus('Временный API ключ удалён');refresh();return;}
 if(act==='testConnection'){
  if(working)return;working=true;setStatus('Проверка подключения модели анализа…');render();
  try{const reply=await analysisRequest('Answer using only the word OK.','Connection test.',64);setStatus(`Подключение работает (${String(reply).trim().slice(0,48)})`);}
  catch(err){console.warn('[Дела того дня] connection test failed',readableProfileError(err));setStatus(`Ошибка подключения: ${readableProfileError(err)} | ${profileErrorHint(err)}`);}
  finally{working=false;render();}return;
 }
 if(act==='cancelHistoryScan'){historyScanCancelled=true;setStatus('Текущее AI анализ остановится после текущего запроса. Прежние данные сохраняются.');return;}
 if(act==='previewHistoryState'){await previewHistoryState();return;}
 if(act==='cancelHistoryState'){historyStatePreview=null;render();setStatus('Результаты повторного анализа отброшены. Прежние данные сохраняются');return;}
 if(act==='applyHistoryState'){
  if(working)return;
  const m=meta(),p=historyStatePreview,c=S();
  if(!m||!p||p.chatId!==c.chatId||p.personaId!==m.userPersonaIdentity||p.target!==selectedNpcId(m)||p.fingerprint!==historySnapshot(c.chat||[])||p.canonFingerprint!==JSON.stringify(effectiveCanon(m))||p.bondMode!==(m.config.asymmetricBond===true))return setStatus('Изменился чат, персона или настройки связи. Создайте предпросмотр анализа заново');
  const selectedIds=new Set([...el('abop-panel').querySelectorAll('[data-history-state]:checked')].map(x=>x.dataset.historyState));
  if(!selectedIds.size)return setStatus('Выберите события для применения');
  const target=selectedNpcId(m),sharedLedger=m.ledger||{},npcLedger=target===MAIN_TARGET?{}:currentCharLedger(m);
  // Guard even if the preview has become stale due to non-chat metadata edits.
  const toApply=p.reviewed.pending.filter(x=>selectedIds.has(`${x.key}#${x.ordinal}`)&&!matchingHistoryExists(sharedLedger,npcLedger,target!==MAIN_TARGET,x));
  if(!toApply.length)return setStatus('Нет новых событий для применения');
  if(!window.confirm(`Выбранных новых событий: ${toApply.length} — добавить в историю текущего чата? Прежние события и ручные записи сохраняются.${p.reviewed.errors.length?` Ошибка анализа ${p.reviewed.errors.length} сообщений будут исключены.`:''}`))return;
  const backupShared=structuredClone(m.ledger||{}),backupNpc=target===MAIN_TARGET?null:structuredClone(npcLedger),prior=m.historyStateReviewInfo;
  try{
   const added=appendHistorySelections({ledger:m.ledger,npcLedger,multiNpc:target!==MAIN_TARGET,
    personaId:m.userPersonaIdentity,targetId:target,config:m.config,candidates:toApply,
    selectedIds:new Set(toApply.map(x=>`${x.key}#${x.ordinal}`))});
   m.historyStateReviewInfo={appliedAt:new Date().toISOString(),count:added,scanned:p.total,failed:p.reviewed.errors.length,chatId:c.chatId,target};
   if(!await persist())throw new Error('Не удалось сохранить метаданные');
   historyStatePreview=null;refresh();setStatus(`Повторный анализ истории · новых событий: ${added} · применено`);
  }catch(err){m.ledger=backupShared;if(backupNpc)npcTracking(m).ledgers[target]=backupNpc;m.historyStateReviewInfo=prior;refresh();setStatus(`Ошибка применения повторного анализа: ${err.message}`);}
  return;
 }
 if(act==='previewTimeSync'){
  const c=S();if(!c?.chatId)return setStatus('Нет текущего чата');
  timeSyncPreview={chatId:c.chatId,result:recoverHistoryTime(c.chat||[])};
  render();setStatus(`Явных указаний времени: ${timeSyncPreview.result.matches.length} · проверьте перед применением`);return;
 }
 if(act==='cancelTimeSync'){timeSyncPreview=null;render();setStatus('Синхронизация отменена. Данные сохраняются');return;}
 if(act==='applyTimeSync'){
  const m=meta(),c=S(),p=timeSyncPreview;
  if(!p||p.chatId!==c.chatId)return setStatus('Текущий чат не совпадает с источником синхронизации');
  const selected=new Set([...el('abop-panel').querySelectorAll('input[data-sync-index]:checked')].map(t=>Number(t.dataset.syncIndex)));
  const matches=p.result.matches.filter((_,i)=>selected.has(i));
  if(!matches.length)return setStatus('Выберите записи для применения');
  // Historical state reanalysis may already have restored this event. Do not
  // count the same message's time skip (or cycle start) a second time.
  const uniqueMatches=matches.filter(x=>{
   const next=(S().chat||[])[x.index+1];
   const adjacentBotKey=next&&!next.is_user&&!next.is_system?uniqKey(next,x.index+1):null;
   const recorded=[...(m.ledger?.[x.key]?.events||[]),...(adjacentBotKey?(m.ledger?.[adjacentBotKey]?.events||[]):[])];
   return !recorded.some(e=>!String(e.id||'').startsWith('history-time-sync:')&&eventIdentity(e)===eventIdentity(x));
  });
  if(!uniqueMatches.length)return setStatus('Выбранные указания уже учтены в событиях. Повторное применение пропущено.');
  const existing=Object.values(m.ledger||{}).flatMap(r=>r?.events||[]).filter(e=>e.kind==='time_advance'&&!String(e.id).startsWith('history-time-sync:'));
  if(existing.length&&!window.confirm(`Уже записано событий течения времени: ${existing.length}. Возможно повторное начисление времени. Продолжить?`))return;
  if(!window.confirm(`Проверенные ${uniqueMatches.length} записей применить вместо прежней синхронизации?${uniqueMatches.length!==matches.length?` повторов: ${matches.length-uniqueMatches.length} · исключено.`:''}`))return;
  const backup=structuredClone(m.ledger||{}),previous=m.timeSyncInfo;
  try{
   applyHistorySync(m.ledger,{matches:uniqueMatches},m.userPersonaIdentity);
   m.timeSyncInfo={count:uniqueMatches.length,appliedAt:new Date().toISOString(),chatId:c.chatId};
   if(!await persist())throw new Error('Не удалось сохранить метаданные');
   timeSyncPreview=null;refresh();setStatus(`Синхронизация времени по истории: ${uniqueMatches.length} · применено`);
  }catch(err){m.ledger=backup;m.timeSyncInfo=previous;refresh();setStatus(`Ошибка синхронизации: ${err.message}`);}
  return;
 }
 if(act==='rebuild'){refresh();setStatus('Состояние выбранной ветки пересчитано');return;}
 if(act==='reanalyze'){await analyzeLatest({force:true});return;}
 if(act==='init'){await initialProfileAnalyze();return;}
 if(act==='advance'){
  const n=Number(el('abop-hours')?.value);
  if(!Number.isFinite(n)||n<=0||n>8760)return setStatus('Введите время больше 0 и не больше 8760 часов');
  await addManualEvents([{kind:'time_advance',hours:n}]);setStatus(`Учтено: +${n} ч`);return;
 }
 if(act==='recordMedication'){
  const role=t.dataset.role;if(!['char','user'].includes(role))return;
  const drug=el(`abop-drug-${role}`)?.value,mode=el(`abop-drug-mode-${role}`)?.value;
  if(!['oral_suppressant','long_suppressant','emergency_suppressant','scent_blocker','oral_contraceptive','emergency_contraceptive','symptom_inducer','cycle_inducer','unlicensed_mixture'].includes(drug))return;
  if(!['normal','misuse','unlicensed'].includes(mode))return;
  await addManualEvents([{kind:'medication',person:role,drug,use_mode:mode}]);setStatus(`${role.toUpperCase()} Приём препарата записан`);return;
 }
 if(act==='exposure'){
  if(meta()?.config?.pregnancyEnabled===false)return setStatus('Симуляция беременности отключена. Включите её в настройках.');
  const gestator=window.prompt('Вынашивающий персонаж: char / user (можно отменить)','char');if(!['char','user'].includes(gestator))return;
  const donor=gestator==='char'?'user':'char';
  const n=Number(window.prompt('Подтверждённое число эякуляций в репродуктивный путь в этой сцене (1–30)','1'));
  if(!Number.isInteger(n)||n<1||n>30)return setStatus('Количество должно быть целым числом от 1 до 30');
  if(!window.confirm('Подтверждены и проникновение, и эякуляция внутрь репродуктивного пути?'))return;
  await addManualEvents([{kind:'exposure',gestator,donor,penetration:true,deposition:true,depositions:n}]);return;
 }
 if(act==='export'){
  const m=meta(false);if(!m)return;
  const blob=new Blob([JSON.stringify(m,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='abo-tracker-chat-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
 }
}
function onEvent(){if(npcScanChatId!==S().chatId){npcCandidates=[];npcReviewEntries=[];npcScanStats=null;npcPreviewId='';npcAiBatchOffset=0;npcScanChatId='';npcSearch='';}refresh();
 // CHAT_CHANGED may precede SillyTavern's persona auto-selection. Recheck after
 // its own synchronous/async persona-lock handlers have finished.
 setTimeout(()=>refresh(),0);
 setTimeout(()=>refresh(),300);
}
function onMessage(){
 refresh();const m=meta(false);if(!m?.config?.autoAnalyze||!m.config.enabled||!currentNpcReady(m))return;
 // Allow the host to finish appending and selecting the final swipe before analysis.
 setTimeout(()=>{analyzeLatest().catch(err=>console.error(err));},350);
}
function subscribe(){
 const c=S(),source=c.eventSource,t=c.event_types||{};if(!source?.on)return;
 for(const name of ['CHAT_CHANGED','CHAT_CREATED','MESSAGE_SWIPED','MESSAGE_EDITED','MESSAGE_DELETED','PERSONA_CHANGED','PERSONA_UPDATED','PERSONA_RENAMED','CHARACTER_EDITED','WORLDINFO_UPDATED','WORLDINFO_SETTINGS_UPDATED'])if(t[name])source.on(t[name],onEvent);
 if(t.MESSAGE_RECEIVED)source.on(t.MESSAGE_RECEIVED,onMessage);
 if(t.GENERATION_STARTED)source.on(t.GENERATION_STARTED,updatePrompt);
}
function boot(){if(active)return;active=true;buildUI();subscribe();refresh();log('Loaded (no third-party dependencies)');}
// Module evaluation occurs after SillyTavern resolves its extension entrypoint.
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
