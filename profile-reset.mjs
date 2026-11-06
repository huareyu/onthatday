/* Profile reset helpers; only profile overrides/setup choices, never RP events. */
export const RESETTABLE_FIELDS=Object.freeze([
 'sex','secondary','anatomy','anatomyDetail','inseminationOrgan','gestate','impregnate',
 'menstruationEnabled','cycleEnabled','cycleMode','pheromoneScent','contactStyle',
 'vocalStyle','speechStyle','baseCondition','basePheromone','name'
]);
const SETUP_SOURCES=new Set(['user_approved_setup','user_added_setup']);
export function discardSetupChoices(preferences){
 if(!preferences||typeof preferences!=='object')return preferences;
 return {
  ...preferences,
  confirmed:(preferences.confirmed||[]).filter(item=>!SETUP_SOURCES.has(item.source)),
  latent:(preferences.latent||[]).filter(item=>!SETUP_SOURCES.has(item.source)),
  // Attitude may have been selected during setup; without provenance reset to neutral.
  attitude:'curious',
 };
}
export function resetProfileChoices(meta,{role='both',field=null,target=null}={}){
 if(!meta)throw new Error('Нет настроек чата');
 if(!['char','user','both'].includes(role))throw new Error('Неверная роль');
 if(field!==null&&!RESETTABLE_FIELDS.includes(field))throw new Error('Неверное поле для открепления');
 const roles=role==='both'?['char','user']:[role];
 let count=0;
 for(const r of roles){
  const owner=r==='char'&&target?target:meta.overrides;
  if(r==='char'&&target){target.overrides??={};}
  else {meta.overrides??={char:{},user:{}};meta.overrides[r]??={};}
  const locked=r==='char'&&target?target.overrides:meta.overrides[r];
  if(field!==null){if(Object.hasOwn(locked,field)){delete locked[field];count++;}}
  else{
   count+=Object.keys(locked).length;
   if(r==='char'&&target)target.overrides={};else meta.overrides[r]={};
   if(r==='char'&&target)target.preferences=discardSetupChoices(target.preferences);
   else if(meta.canon?.[r])meta.canon[r].preferences=discardSetupChoices(meta.canon[r].preferences);
  }
 }
 if(field===null){
  meta.profileInitialized=false;
  meta.initialProposal=null;
  // Synchronize active persona cache where it already exists. Other personas are untouched.
  if(roles.includes('user')&&meta.userPersonaIdentity&&meta.personaProfiles?.[meta.userPersonaIdentity]){
   meta.personaProfiles[meta.userPersonaIdentity]={
    ...meta.personaProfiles[meta.userPersonaIdentity],
    overrides:{},
    preferences:structuredClone(meta.canon?.user?.preferences),
    profileInitialized:false,
   };
  }
 }
 return count;
}
