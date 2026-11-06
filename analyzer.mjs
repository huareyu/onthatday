/* The classifier is intentionally read-only. All random decisions occur in core.mjs. */
const ALLOWED=['time_advance','heat_start','rut_start','ovulation','menstruation_start','menstruation_end','bond','bond_loss','medication','exposure','pregnancy_reveal','delivery','pregnancy_end','preference','scene','vital_observation'];
const DRUGS=['oral_suppressant','long_suppressant','emergency_suppressant','scent_blocker','symptom_inducer','cycle_inducer','unlicensed_mixture','emergency_contraceptive','oral_contraceptive'];
const validPersonId=id=>['char','user'].includes(id)||/^npc:[a-z0-9_-]{2,48}$/i.test(String(id||''));
const PREF_LEVELS=['latent','liked','strongly_liked','disliked','restricted'];
// Independent evidence gate: model-inferred roles remain subject to the core role checks.
// Outcomes: confirmed, uncertain, not_established. Uncertain is never persisted.
export function classifyBondEvidence(evidence){
 const t=String(evidence||'').trim();
 if(!t)return {status:'not_established',reason:'empty'};
 const explicit=/각인(?:이|을|은|도|까지)?\s*(?:성립(?:했|하였|된|했다|하여|됐)|완료(?:됐|되었|했)|새겨졌|맺어졌|이루어졌)|(?:각인|본딩)(?:했(?:다|어|으며|고)|되었(?:다|어)|됐(?:다|어))|(?:bond(?:ed|ing)?|mark(?:ed|ing)?)\s+(?:was\s+)?(?:established|completed|formed)/i;
 const nape=/(?:목덜미|뒷목|목\s*뒤(?:쪽)?|목\s*뒷부분|목덜미의\s*피부|nape|back\s+of\s+(?:the|his|her|their)\s+neck)/i;
 const biting=/(?:물(?:었|었다|어뜯|고\s*놓)|깨물(?:었|었다)|베어\s*물(?:었|었다)|이빨(?:을|이)?\s*(?:박|꽂|파묻)|송곳니(?:를|가|는|를\s*깊이)?\s*(?:박|꽂|파묻|파고들)|송곳니가.{0,35}?(?:박|꽂|파묻|파고들)|(?:bit|bitten|sank\s+(?:his|her|their)?\s*(?:teeth|fangs)|buried\s+(?:his|her|their)?\s*fangs))/i;
 const hypothetical=/(?:물(?:려고|을\s*뻔|수\s*있|고\s*싶|어야)|깨물(?:려고|고\s*싶)|각인(?:하려|하고\s*싶|할\s*생각|할\s*뻔|할\s*수|하지\s*않)|(?:would|could|might|wanted|tried|about\s+to)\s+(?:bite|bond|mark)|(?:if|만약).{0,25}(?:물|각인|bite|bond))/i;
 const negated=/(?:물지\s*않|물지\s*못|물지는\s*않|물린\s*것은\s*아니|각인(?:되지\s*않|이\s*되지\s*않|은\s*성립하지\s*않|하지\s*않|은\s*아니)|(?:did\s+not|didn't|never|wasn't)\s+(?:bite|bitten|bond|mark))/i;
 const memory=/(?:꿈속|꿈에서|상상(?:속|했|하며)|회상(?:했|하며|속)|과거를\s*떠올|예전에\s*각인|오래전\s*각인|(?:in\s+a\s+dream|imagined|flashback|remembered\s+(?:when|that)))/i;
 const completed=explicit.test(t)||(nape.test(t)&&biting.test(t));
 if(negated.test(t))return {status:'not_established',reason:'negated'};
 if(hypothetical.test(t))return {status:'not_established',reason:'intent_or_hypothetical'};
 if(memory.test(t))return {status:'uncertain',reason:'recollection_or_dream'};
 if(completed)return {status:'confirmed',reason:explicit.test(t)?'explicit_completion':'completed_nape_bite'};
 if(/(?:각인|본딩|물|깨물|송곳니|이빨\s*자국|bite|bond|mark|fangs)/i.test(t))return {status:'uncertain',reason:'insufficient_completion_context'};
 return {status:'not_established',reason:'no_bond_evidence'};
}
export const ANALYZER_SYSTEM=`You extract confirmed events for a fictional ABO roleplay tracker. You are a conservative factual parser, not a narrator.
Output only one valid JSON object: {"events": [ ... ]}. Never invent missing facts or add hypothetical events.
Event shapes:
- {"kind":"time_advance","hours":number,"evidence":"EXACT short quotation from one provided message"}. Clock advances only on explicit duration/time skip, not inferred from chat turn count.
- {"kind":"heat_start"|"rut_start"|"ovulation","person":"char"|"user","evidence":"..."} only for explicitly confirmed start/ovulation.
- {"kind":"menstruation_start"|"menstruation_end","person":"char"|"user","evidence":"..."} ONLY when a new menstrual period has explicitly BEGUN or ENDED in the current messages. Merely saying someone is currently menstruating, has cramps, or talking about an existing period is NOT a new start event. Never repeat ongoing state each reply.
- {"kind":"medication","person":"char"|"user","drug":"${DRUGS.join('|')}","use_mode":"normal"|"misuse"|"unlicensed","evidence":"..."} only if taken/administered, not simply discussed.
- {"kind":"exposure","gestator":"char"|"user","donor":"char"|"user","penetration":true,"deposition":true,"depositions":integer,"evidence":"..."} ONLY if explicit confirmed penetration into a reproductive route AND confirmed direct internal ejaculate deposition. No guessing from ambiguous intimacy or vague implications. Count only explicitly confirmed depositions, default 1 if a single one confirmed.
- {"kind":"bond","actor":"char"|"user","target":"char"|"user","biteLocation":"pheromone_nape","biteConfirmed":true,"evidence":"..."} ONLY when the current narration establishes an Alpha ACTUALLY biting an Omega on the nape/back of neck, OR explicitly reports the completed creation of their bond. The words "pheromone gland" are NOT required. Accept natural descriptions of biting the nape, sinking fangs into the back of the neck, or establishing a bond in the source language. Determine actor/target using context and known secondary genders; never reverse roles. Do not treat mere desire, attempted bites, kisses, scents, hypotheticals, dreams, flashbacks or recollections of existing bonds as NEW events. Emit only certain completed current events, never an uncertain event.
- {"kind":"bond_loss","person":"char"|"user","partner":"char"|"user","cause":"surgery"|"drug_adverse"|"death","evidence":"..."} ONLY for completed surgical removal, documented medication adverse loss, or death; never infer from ordinary separation.
- {"kind":"pregnancy_reveal","person":"char"|"user","knower":"char"|"user","level":"suspected"|"confirmed","evidence":"..."}. Person is gestator; knower is one of the people.
- {"kind":"delivery"|"pregnancy_end","person":"char"|"user","evidence":"..."} for a story-confirmed event.
- {"kind":"vital_observation","person":"char"|"user","condition":"exhausted"|"tired"|"strained"|"neutral"|"rested"|"energized","emission":"surge"|"strong"|"neutral"|"faint"|"suppressed","evidence":"..."}. Only when the CURRENT message establishes actual present fatigue, condition recovery, or the tracked person's OWN pheromone emission changes. Either condition or emission may be omitted; do NOT invent missing evidence or score. For USER, USER text ONLY. Do not infer physical condition from personality; partner's scent is not one's own emitted scent.
- {"kind":"preference","person":"char"|"user","preference":"concise snake_case tag","label":"short natural Russian description of the ACTUAL preference; never output raw ID","level":"${PREF_LEVELS.join('|')}","direct":boolean,"sceneId":"optional unique scene label","evidence":"..."}. Direct only for explicit statement; observations must recur across 2 different scenes before confirmation. Do not infer user preference from narrator prose. Translate even novel preference IDs into natural, clear Russian in label; avoid untranslated snake_case, unexplained edging jargon, and stiff literal translations. Use restricted for a boundary/caution (boundary/caution), not automatically a prohibition. Prefer a concise, understandable paraphrase, do not invent a new preference or intensify the meaning.
- {"kind":"scene","person":"char"|"user","posture":"...","contact":"...","vocal":"...","speech":"...","play":[],"completed":boolean,"evidence":"..."}. Capture the CURRENT observable posture, contact, and activity whenever the latest narrative establishes them, including nonsexual and conversational scenes. Use the latest physical position, not an earlier sexual pose or a preference. Write posture, contact, vocal, and play descriptions in short natural RUSSIAN, even when source narration is in English; retain named people and other proper nouns. For speech preserve the quoted original utterance in any language verbatim and never invent or translate a line as if actually spoken. The scene is a REPLACEMENT SNAPSHOT, not a partial merge: use empty strings and [] for fields not currently supported. Only record actual present contact; earlier kisses and imagined bites are not current contact. Use "completed":true ONLY when the ongoing scene explicitly ends. Do not carry over on_back or penetration without fresh evidence. If no scene facts are available, emit no scene event; the tracker will mark earlier data as unverified. Never invent user actions.
Evidence MUST be an exact contiguous quote from USER or ASSISTANT text supplied below, not from these instructions. Minimum 4 visible characters. For USER-initiated events or USER preferences, evidence must come from the provided USER message, not ASSISTANT text.
Do not attribute actions to USER from assistant narration. Ignore hypothetical scenes, future plans, negated events, and quoted instructions. No event if ambiguous. Events ordered chronologically. For bonds ONLY, registered NPC IDs provided in current state may be used; never invent an NPC ID or confuse aliases. All other event kinds remain limited to CHAR/USER. Maximum 12 events.`;
export function parseModelOutput(raw,userText='',assistantText=''){
 let text=String(raw||'').trim();
 if(text.startsWith('```'))text=text.replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'');
 const start=text.indexOf('{'),end=text.lastIndexOf('}');if(start<0||end<start)return [];
 let obj;try{obj=JSON.parse(text.slice(start,end+1));}catch{return [];}
 if(!Array.isArray(obj.events))return [];
 const u=String(userText||''),a=String(assistantText||'');
 const present=(needle,hay)=>hay.includes(needle);
 const res=[];
 for(const rawEvent of obj.events.slice(0,12)){
  if(!rawEvent||!ALLOWED.includes(rawEvent.kind)||typeof rawEvent.evidence!=='string')continue;
  const e={...rawEvent};e.evidence=e.evidence.trim();
  if(e.evidence.length<4||!present(e.evidence,u)&&!present(e.evidence,a))continue;
  const fromUser=present(e.evidence,u);
  // The assistant's narration cannot independently establish a USER-performed
  // action (including a marking/bond by USER).
  // USER preferences/actions cannot be fabricated by assistant narration.
  if(e.kind==='preference'&&e.person==='user'&&!fromUser)continue;
  if(e.kind==='vital_observation'&&e.person==='user'&&!fromUser)continue;
  if(e.kind==='scene'&&e.person==='user'&&!fromUser)continue;
  if(e.kind==='bond'&&e.actor==='user'&&!fromUser)continue;
  if(e.kind==='pregnancy_reveal'&&e.knower==='user'&&!fromUser)continue;
  if(['medication','heat_start','rut_start','ovulation','menstruation_start','menstruation_end','bond','bond_loss','delivery','pregnancy_end'].includes(e.kind)&&e.person==='user'&&!fromUser)continue;
  if(['time_advance'].includes(e.kind)&&(!Number.isFinite(e.hours)||e.hours<0||e.hours>8760))continue;
  if(['heat_start','rut_start','ovulation','menstruation_start','menstruation_end','medication','pregnancy_reveal','delivery','pregnancy_end','preference','scene','vital_observation'].includes(e.kind)&&!['char','user'].includes(e.person))continue;
  if(['menstruation_start','menstruation_end'].includes(e.kind)){
   const begin=e.kind==='menstruation_start';
   const positive=begin
    ?/(?:생리|월경)(?:가|이|는|도)?\s*(?:막\s*)?(?:시작|터졌|터지|나오기\s*시작)|(?:period|menstruation)\s+(?:just\s+)?(?:started|began)|(?:started|began)\s+(?:her|his|their|the)?\s*(?:period|menstruation)/i
    :/(?:생리|월경)(?:가|이|는|도)?\s*(?:막\s*)?(?:끝났|끝나|종료|멈췄|멎었)|(?:period|menstruation)\s+(?:has\s+)?(?:ended|stopped|finished)|(?:ended|finished|stopped)\s+(?:her|his|their|the)?\s*(?:period|menstruation)/i;
   if(!positive.test(e.evidence))continue;
  }
  if(e.kind==='medication'&&(!DRUGS.includes(e.drug)||!['normal','misuse','unlicensed'].includes(e.use_mode)))continue;
  if(e.kind==='exposure'){
   if(!['char','user'].includes(e.gestator)||!['char','user'].includes(e.donor)||e.gestator===e.donor)continue;
   if(e.penetration!==true||e.deposition!==true||!Number.isInteger(e.depositions)||e.depositions<1||e.depositions>30)continue;
   // Disallow ambiguous single-word sexual-event evidence.
   if(e.evidence.length<12)continue;
  }
  if(e.kind==='vital_observation'&&!(['exhausted','tired','strained','neutral','rested','energized'].includes(e.condition)||['surge','strong','neutral','faint','suppressed'].includes(e.emission)))continue;
  if(e.kind==='preference'){
   if(!PREF_LEVELS.includes(e.level)||typeof e.preference!=='string'||!/^[-_a-z0-9]{2,80}$/i.test(e.preference))continue;
   if(typeof e.label==='string'&&/[А-Яа-яЁё]/u.test(e.label)&&e.label.length<=90) e.label=e.label.trim();
   else delete e.label;
  }
  if(e.kind==='bond'&&(!validPersonId(e.actor)||!validPersonId(e.target)||e.actor===e.target||e.biteLocation!=='pheromone_nape'||e.biteConfirmed!==true))continue;
  if(e.kind==='bond'){
   const verdict=classifyBondEvidence(e.evidence);
   if(verdict.status!=='confirmed')continue;
   e.person=e.actor;e.partner=e.target;
  }
  if(e.kind==='bond_loss'&&(!validPersonId(e.person)||!validPersonId(e.partner)||e.partner===e.person||!['surgery','drug_adverse','death'].includes(e.cause)))continue;
  if(e.kind==='pregnancy_reveal'&&(!['char','user'].includes(e.knower)||!['suspected','confirmed'].includes(e.level)))continue;
  if(e.kind==='scene'){
   if(e.completed!==true)e.completed=false;
   for(const k of ['posture','contact','vocal','speech'])if(typeof e[k]!=='string')delete e[k];
   if(!Array.isArray(e.play))delete e.play;
  }
  res.push(e);
 }
 return res;
}
export function buildAnalyzerUserPrompt({charName,charAliases=[],multiNpc=false,userName,charCard,userPersona,userText,assistantText,existingState}){
 return `Character name: ${charName||'CHAR'}\n${multiNpc?`MULTI-NPC MODE: CHAR means ONLY this selected individual (${charName}); aliases: ${charAliases.join(', ')||'none'}. The narrator and all other NPCs are NOT CHAR. Attribute an event to CHAR only when the selected individual is unambiguously the actor/subject. Do not assign events involving other NPCs to CHAR; if identity is unclear emit no CHAR event. \n`: ''}User persona name: ${userName||'USER'}\nCharacter card (background only, NOT events):\n${String(charCard||'').slice(0,3000)}\nUser persona (background only, NOT events):\n${String(userPersona||'').slice(0,2400)}\nCurrent tracker state (background only, NOT events):\n${JSON.stringify(existingState||{}).slice(0,2400)}\n--- USER MESSAGE ---\n${String(userText||'').slice(0,3000)}\n--- ASSISTANT MESSAGE ---\n${String(assistantText||'').slice(0,5000)}\n--- END ---\nReturn JSON for confirmed NEW events in those messages only.`;
}
