/* Read-only catalogue of drug CLASSES explicitly described in the bundled World Info.
 * Do not infer trade names, doses, person-specific medication events, or custom drugs.
 */
const GROUPS = Object.freeze([
  {key:'MED-01', title:'Подавление и блокировка', definitions:[
    {needle:/\broutine oral suppressant\s*:/i, title:'Обычный пероральный подавитель', description:'Обычный подавитель симптомов течки / гона.'},
    {needle:/\blong-acting suppressant\s*:/i, title:'Подавитель длительного действия', description:'Смягчает симптомы надолго, может влиять на цикл и беременность.'},
    {needle:/\bemergency suppressant\s*:/i, title:'Экстренный подавитель', description:'Кратковременно облегчает внезапные симптомы.'},
    {needle:/\bpheromone blocker\s*:/i, title:'Блокатор феромонов', description:'Снижает выделение феромонов, воспринимаемых окружающими.'},
  ]},
  {key:'MED-02', title:'Индукторы и неодобренные препараты', definitions:[
    {needle:/\bsymptom[- ](?:only|type)\b/i, title:'Индуктор симптомов, похожих на цикл', description:'Вызывает симптомы, похожие на течку / гон.'},
    {needle:/\b(?:genuine cycle-triggering|cycle-type)\b/i, title:'Индуктор цикла', description:'Может вызвать течку / гон или изменить время цикла.'},
  ]},
  {key:'MED-02', title:'Другие препараты из книги мира', definitions:[
    {needle:/\bunlicensed mixed compound\b/i, title:'Неодобренная смесь', description:'В зависимости от мира и назначения может подавлять, вызывать или нарушать цикл.'},
  ]},
  {key:'FERT-03', title:'Контрацепция', definitions:[
    {needle:/\bemergency contraception is available\b/i, title:'Экстренный контрацептив', description:'Снижает риск зачатия после незащищённого полового контакта.'},
  ]},
]);
function entriesFromWorldInfo(worldInfo){
  if(!worldInfo || typeof worldInfo!=='object')throw new TypeError('Неверный формат книги мира.');
  const entries=worldInfo.entries;
  if(!entries || typeof entries!=='object')throw new TypeError('В книге мира отсутствует entries.');
  return Object.values(entries).filter(e=>e&&typeof e.comment==='string'&&typeof e.content==='string');
}
export function extractDrugClassesFromWorldInfo(worldInfo){
  const entries=entriesFromWorldInfo(worldInfo);
  const groups=[];
  for(const group of GROUPS){
    const entry=entries.find(e=>e.comment.startsWith(`${group.key} |`));
    if(!entry)continue;
    const items=group.definitions.filter(x=>x.needle.test(entry.content))
      .map(x=>({title:x.title,description:x.description}));
    if(items.length)groups.push({name:group.title,source:group.key,disabled:entry.disable===true,items});
  }
  return {sourceName:String(worldInfo.name||''),groups,count:groups.reduce((n,g)=>n+g.items.length,0)};
}

/**
 * Built-in drug reference for the World Info shipped with this release.
 * This display-only reference is available even when SillyTavern does not
 * statically serve .json files from a third-party extension directory.
 * Keep it aligned with the bundled World Info; release checks compare both.
 */
const bundledDrugGroups = GROUPS.map(group => ({
  name: group.title,
  source: group.key,
  disabled: false,
  items: group.definitions.map(({title, description}) => ({title, description})),
}));
export const BUNDLED_WORLDINFO_DRUG_CATALOG = Object.freeze({
  sourceName: '[WI]Geunalui_Sajeong_v1.0.0',
  groups: bundledDrugGroups,
  count: bundledDrugGroups.reduce((total, group) => total + group.items.length, 0),
});
