export const presets = {
  openai:{label:'OpenAI · ChatGPT 模型',provider:'responses',baseUrl:'https://api.openai.com/v1',model:'gpt-5.4-mini',keyUrl:'https://platform.openai.com/api-keys'},
  deepseek:{label:'DeepSeek',provider:'chat',baseUrl:'https://api.deepseek.com',model:'deepseek-v4-flash',keyUrl:'https://platform.deepseek.com/api_keys'},
  glm:{label:'智谱 GLM',provider:'chat',baseUrl:'https://open.bigmodel.cn/api/paas/v4',model:'glm-4.7-flash',keyUrl:'https://bigmodel.cn/usercenter/proj-mgmt/apikeys'},
  claude:{label:'Claude',provider:'anthropic',baseUrl:'https://api.anthropic.com/v1',model:'claude-sonnet-5',keyUrl:'https://platform.claude.com/settings/keys'},
  custom:{label:'其他兼容服务 / 本地模型',provider:'chat',baseUrl:'http://127.0.0.1:11434/v1',model:'',keyUrl:''}
};
export const defaults = {service:'openai',...presets.openai, apiKey:'', maxCalls:6, maxOutputTokens:6000, tokenBudget:30000, webSearch:false, profiles:{}};
export function validateConfig(input, previous = defaults) {
  if(!presets[input.service])throw new Error('请选择模型服务。');
  const saved=previous.profiles?.[input.service] || (previous.service===input.service?previous:{});
  const c = {...defaults, ...presets[input.service], ...saved, service:input.service};
  if (!['responses', 'chat', 'anthropic'].includes(input.provider)) throw new Error('请选择接口类型。');
  let url; try { url = new URL(input.baseUrl); } catch { throw new Error('API 地址无效。'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) throw new Error('API 地址需要 HTTPS；本机模型可使用 HTTP。不要在地址中填写密钥。');
  const baseUrl = url.href.replace(/\/+$/, '');
  if (baseUrl !== c.baseUrl || input.provider !== c.provider) c.apiKey = '';
  if (input.clearKey === true) c.apiKey = '';
  if (typeof input.apiKey === 'string' && input.apiKey.trim()) c.apiKey = input.apiKey.trim().slice(0, 4096);
  Object.assign(c, {provider:input.provider, baseUrl, model:String(input.model || '').trim().slice(0, 200), webSearch:input.webSearch === true});
  for (const [key, min, max] of [['maxCalls',1,12],['maxOutputTokens',256,16000],['tokenBudget',1000,200000]]) {
    const v = Number(input[key] ?? c[key]); if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${key} 超出范围 ${min}–${max}。`); c[key] = v;
  }
  if (c.webSearch && !(c.provider === 'responses' && url.origin === 'https://api.openai.com')) throw new Error('本版联网搜索仅接入 OpenAI 官方 Responses 接口。');
  delete c.profiles;
  return {...c,profiles:{...previous.profiles,[input.service]:structuredClone(c)}};
}
export function publicConfig(c) {
  const clean=x=>{const {apiKey,profiles,...rest}=x;return {...rest,hasKey:!!apiKey,configured:!!x.model&&(x.service==='custom'||!!apiKey)};};
  return {...clean(c),presets,profiles:Object.fromEntries(Object.entries(c.profiles||{}).map(([k,v])=>[k,clean(v)]))};
}
export function buildRequestBody(c, {input, tools, instructions}) {
  const responses = c.provider === 'responses', anthropic=c.provider==='anthropic';
  const definitions = tools.map(t => responses ? {type:'function', ...t, strict:false} : anthropic ? {name:t.name,description:t.description,input_schema:t.parameters} : {type:'function', function:t});
  return responses ? {
    model:c.model, instructions, input, store:false, max_output_tokens:c.maxOutputTokens,
    tools:[...definitions, ...(c.webSearch ? [{type:'web_search'}] : [])],
    include:['reasoning.encrypted_content', ...(c.webSearch ? ['web_search_call.action.sources'] : [])]
  } : anthropic ? {model:c.model,system:instructions,messages:input,max_tokens:c.maxOutputTokens,tools:definitions} : {model:c.model, messages:[{role:'system',content:instructions}, ...input], [new URL(c.baseUrl).hostname==='api.openai.com'?'max_completion_tokens':'max_tokens']:c.maxOutputTokens, tools:definitions};
}
export async function requestModel(c, {input, tools, instructions, signal, onRequest}) {
  const responses=c.provider==='responses', anthropic=c.provider==='anthropic';
  const body=buildRequestBody(c,{input,tools,instructions});
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', abort, {once:true});
  const timer = setTimeout(abort, 90000), started = Date.now();let receivedUsage;
  try {
    if(controller.signal.aborted)throw new Error('执行已停止。');
    if(onRequest)await onRequest(body);
    if(controller.signal.aborted)throw new Error('执行已停止。');
    const response = await fetch(c.baseUrl + (responses ? '/responses' : anthropic?'/messages':'/chat/completions'), {method:'POST', redirect:'error', signal:controller.signal, headers:{'Content-Type':'application/json', ...(anthropic?{'x-api-key':c.apiKey,'anthropic-version':'2023-06-01'}:c.apiKey ? {Authorization:`Bearer ${c.apiKey}`} : {})}, body:JSON.stringify(body)});
    if (!response.ok) { await response.body?.cancel(); throw new Error(`模型接口返回 HTTP ${response.status}。请检查接口地址、模型名称、密钥和额度。`); }
    const reader = response.body.getReader(); let size = 0, parts = [];
    while (true) { const {done,value} = await reader.read(); if(done) break; size += value.length; if(size > 4_000_000) { await reader.cancel(); throw new Error('模型响应超过本版大小限制。'); } parts.push(value); }
    const data = JSON.parse(Buffer.concat(parts).toString('utf8'));

    const rawUsage = data.usage;
    const valid = v => Number.isFinite(v) && v >= 0 ? v : null;
    const usage = {input:valid(responses || anthropic ? rawUsage?.input_tokens : rawUsage?.prompt_tokens), output:valid(responses || anthropic ? rawUsage?.output_tokens : rawUsage?.completion_tokens), cached:valid(anthropic?rawUsage?.cache_read_input_tokens:responses ? rawUsage?.input_tokens_details?.cached_tokens : rawUsage?.prompt_tokens_details?.cached_tokens ?? rawUsage?.prompt_cache_hit_tokens), cacheWrite:valid(rawUsage?.cache_creation_input_tokens), reasoning:valid(responses ? rawUsage?.output_tokens_details?.reasoning_tokens : rawUsage?.completion_tokens_details?.reasoning_tokens), durationMs:Date.now()-started, model:data.model || c.model, requestId:response.headers.get('x-request-id') || response.headers.get('request-id') || null};
    // Anthropic's input_tokens excludes both cache categories; normalize to total input.
    if(anthropic && usage.input!==null)usage.input+=(usage.cached??0)+(usage.cacheWrite??0);
    if(anthropic)usage.reasoning=valid(rawUsage?.output_tokens_details?.thinking_tokens);
    receivedUsage=usage;
    if (data.error) throw new Error('模型接口返回错误；未执行工具。');
    if(anthropic){
      if(!Array.isArray(data.content))throw new Error('模型响应缺少 content。');
      return {usage,output:[{role:'assistant',content:data.content}],calls:data.content.filter(x=>x.type==='tool_use').map(x=>({id:x.id,name:x.name,arguments:JSON.stringify(x.input)})),text:data.content.filter(x=>x.type==='text').map(x=>x.text).join('\n'),sources:[],searches:0,incomplete:['max_tokens','pause_turn'].includes(data.stop_reason)};
    }
    if (responses) {
      if (!Array.isArray(data.output)) throw new Error('Responses 响应缺少 output。');
      const messages = data.output.filter(x => x.type === 'message').flatMap(x => x.content || []);
      return {usage, output:data.output, calls:data.output.filter(x => x.type === 'function_call').map(x => ({id:x.call_id,name:x.name,arguments:x.arguments})), text:messages.map(x => x.text || x.refusal || '').join('\n'), sources:messages.flatMap(x => (x.annotations || []).filter(a => a.type === 'url_citation').map(a => ({url:a.url,title:a.title}))), searches:data.output.filter(x => x.type === 'web_search_call').length, incomplete:!!data.status && data.status !== 'completed'};
    }
    const choice = data.choices?.[0], msg = choice?.message;
    if (!msg) throw new Error('Chat Completions 响应缺少 message。');
    return {usage, output:[msg], calls:(msg.tool_calls || []).map(x => ({id:x.id, name:x.function?.name, arguments:x.function?.arguments})), text:typeof msg.content === 'string' ? msg.content : '', sources:[], searches:0, incomplete:choice.finish_reason === 'length'};
  } catch (error) {
    if(receivedUsage)error.usage=receivedUsage;
    if (controller.signal.aborted) throw new Error(signal?.aborted ? '执行已停止；中断请求的用量可能未返回。' : '模型请求超过 90 秒，已中断；用量可能未返回。');
    if (/模型|Responses|Chat Completions/.test(error.message)) throw error;
    const failure=new Error('无法连接模型或响应格式无效。请检查地址、网络与接口兼容性。');if(receivedUsage)failure.usage=receivedUsage;throw failure;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
