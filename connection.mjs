/* Independent analysis request adapter for SillyTavern's official ConnectionManagerRequestService.
 * Sends profile-bound requests without changing the RP connection and without persisting credentials.
 * Both Chat Completion and Text Completion are dispatched by the official service.
 */
// Remove tokens that may be echoed by an upstream provider error; never display keys in the panel.
export function redactErrorSecrets(value){
 return String(value??'')
  .replace(/(\bBearer\s+)[A-Za-z0-9._~+\/-]{10,}/gi,'$1[учётные данные скрыты]')
  .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{6,}\b/g,'[учётные данные скрыты]')
  .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g,'[учётные данные скрыты]')
  .replace(/([?&](?:api[_-]?key|access_token|token|key)=)[^&#\s]+/gi,'$1[учётные данные скрыты]')
  .replace(/(\b(?:api[_ -]?key|access[_ -]?token|secret|token|authorization)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,'$1[учётные данные скрыты]');
}
export function readableProfileError(error){
 const visited=new Set(),messages=[],statuses=[];
 let e=error;
 while(e!=null&&!visited.has(e)){
  if(typeof e!=='object'){
   const detail=redactErrorSecrets(e).trim();
   if(detail)messages.push(detail);
   break;
  }
  visited.add(e);
  for(const status of [e.status,e.statusCode,e.response?.status]){
   if(Number.isInteger(Number(status))&&Number(status)>=400&&Number(status)<=599)statuses.push(Number(status));
  }
  if(typeof e.message==='string'){
   for(const part of e.message.split(/\s*(?:→|=>)\s*/)){
    const message=redactErrorSecrets(part).trim().replace(/^(?:(?:Error|저장된 프로필 호출 실패|Ошибка запроса сохранённого профиля):\s*)+/gi,'').trim();
    if(message)messages.push(message);
   }
  }
  e=e.cause;
 }
 const unique=[...new Set(messages)];
 const generic=/^(?:API request failed|Response not OK|저장된 프로필 호출 실패|Ошибка запроса сохранённого профиля)$/i;
 const status=statuses[0];
 const useful=(status||unique.some(x=>!generic.test(x)))?unique.filter(x=>!generic.test(x)):unique;
 if(status&&!useful.some(x=>new RegExp(`\\b(?:HTTP\\s*)?${status}\\b`).test(x)))useful.unshift(`HTTP ${status}`);
 return (useful.join(' → ')||redactErrorSecrets(error instanceof Error?error.message:error||'Причина неизвестна')).slice(0,800);
}
export function extractedText(value){
 if(typeof value==='string')return value;
 if(typeof value?.content==='string')return value.content;
 if(Array.isArray(value?.content))return value.content.map(p=>typeof p==='string'?p:p?.text||'').join('');
 if(typeof value?.choices?.[0]?.message?.content==='string')return value.choices[0].message.content;
 if(typeof value?.response==='string')return value.response;
 return '';
}
export function profileErrorHint(error){
 const e=readableProfileError(error).toLowerCase();
 if(/vertex ai express|vertex.*express mode/.test(e))return 'Укажите ключ API Vertex AI Express в настройках подключения SillyTavern и обновите профиль.';
 if(/profile not found|профиль подключения не найден|формат api выбранного профиля|연결 프로필을 찾지|연결 프로필이 없거나 지원되지|프로필의 api 형식이 지원되지/.test(e))return 'Сохранённый профиль отсутствует или не поддерживается. Выберите его заново в менеджере подключений и проверьте сохранение.';
 if(/\b401\b|unauthoriz|authenticat|api key|invalid key|credential/.test(e))return 'Проверьте авторизацию API. Укажите ключ или учётные данные провайдера и обновите профиль подключения.';
 if(/\b403\b|forbidden|permission denied/.test(e))return 'Проверьте права аккаунта API, ограничения доступа и доступные модели.';
 if(/\b404\b|model.*not found|unknown model/.test(e))return 'Проверьте название модели и адрес API в сохранённом профиле.';
 if(/\b429\b|rate.?limit|quota/.test(e))return 'Проверьте лимиты запросов API и квоту.';
 if(/\b408\b|\b504\b|timed? ?out|timeout/.test(e))return 'Время ожидания истекло. Проверьте сервер провайдера и настройки подключения, затем повторите попытку.';
 if(/\b400\b|\b422\b|bad request|invalid request/.test(e))return 'Проверьте формат запроса API, модель и пресет в сохранённом профиле.';
 if(/\b5\d\d\b|internal server error|bad gateway|service unavailable/.test(e))return 'Ошибка API или промежуточного сервера. Проверьте журналы провайдера и SillyTavern, затем повторите попытку.';
 if(/response not ok|api request failed/.test(e))return 'Запрос API завершился ошибкой без подробностей. Проверьте обычный ответ модели в SillyTavern и ошибки авторизации или модели в серверном журнале.';
 if(/failed to fetch|networkerror|network error|fetch failed/.test(e))return 'Проверьте доступность сервера, адрес API и сетевые настройки.';
 if(/응답|empty|content|텍스트|пустой текстовый ответ|ответ пуст/.test(e))return 'Ответ пуст. Проверьте настройки вывода модели и пресет.';
 return 'Проверьте ошибки [Дела того дня] в консоли браузера и журнал сервера SillyTavern.';
}
export async function requestUsingProfile(service,profileId,systemPrompt,prompt,maxTokens=5000){
 if(!service||typeof service.sendRequest!=='function')throw new Error('Сервис запросов через сохранённые профили недоступен.');
 const profile=service.getProfile?.(profileId);
 if(!profile)throw new Error('Сохранённый профиль подключения не найден.');
 // Do NOT branch on getContext().CONNECT_API_MAP: it is not a stable public source for
 // third-party extensions. The official service validates the saved profile and handles
 // text / chat formats itself, including instruct-prompt conversion for text completions.
 if(typeof service.validateProfile==='function')service.validateProfile(profile);
 else if(typeof service.isProfileSupported==='function'&&!service.isProfileSupported(profile))throw new Error('Формат API выбранного профиля подключения не поддерживается.');
 const messages=[{role:'system',content:String(systemPrompt)},{role:'user',content:String(prompt)}];
 try{
  const result=await service.sendRequest(profileId,messages,maxTokens,
   {stream:false,extractData:true,includePreset:false,includeInstruct:true});
  const response=extractedText(result);
  if(!response.trim())throw new Error('Сохранённый профиль вернул пустой текстовый ответ.');
  return response;
 }catch(e){
  throw new Error(`Ошибка запроса сохранённого профиля: ${readableProfileError(e)}`,{cause:e});
 }
}
