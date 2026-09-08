/* Local context compiler. No network, storage, model calls, or robot commands. */
(function(root){
  'use strict';
  const DEFAULT_WINDOW=16384;
  const clip=(value,size)=>{const s=String(value??'');return s.length>size?s.slice(0,Math.max(0,size-28))+' [excerpt; more held locally]':s;};
  // Conservative estimate, not the provider's tokenizer. Reserve separately for
  // images and output; never count base64 pixels as ordinary prose.
  function estimate(value){
    if(value==null)return 1;
    if(typeof value==='string')return Math.ceil(new TextEncoder().encode(value).length/2)+4;
    if(Array.isArray(value))return value.reduce((n,v)=>n+estimate(v),4);
    if(typeof value==='object'){
      if(value.type==='image_url')return 4096;
      return Object.entries(value).reduce((n,[k,v])=>n+estimate(k)+estimate(v),8);
    }
    return 4;
  }
  function dialogue(messages,pairs=3){
    const out=[];let user=null;
    for(const m of messages||[]){
      if(m.role==='user')user=m;
      else if(m.role==='assistant'&&!m.tool_calls?.length&&typeof m.content==='string'&&m.content.trim()&&user){
        out.push({role:'user',content:user.content},{role:'assistant',content:m.content});user=null;
      }
    }
    return out.slice(-pairs*2);
  }
  function groups(messages){
    const result=[];
    for(let i=0;i<messages.length;i++){
      const m=messages[i];
      if(m.role==='tool')throw Error('Context contains an orphan tool result; no request sent.');
      if(m.role==='assistant'&&m.tool_calls?.length){
        const ids=m.tool_calls.map(c=>c.id),group=[m],seen=new Set();
        if(new Set(ids).size!==ids.length||ids.some(id=>!id))throw Error('Invalid tool call IDs; no request sent.');
        while(messages[i+1]?.role==='tool'){
          const reply=messages[++i];
          if(!ids.includes(reply.tool_call_id)||seen.has(reply.tool_call_id))throw Error('Mismatched tool result; no request sent.');
          seen.add(reply.tool_call_id);group.push(reply);
        }
        if(seen.size!==ids.length)throw Error('Incomplete tool exchange; no request sent.');
        result.push(group);
      }else result.push([m]);
    }
    return result;
  }
  function compile(request,options={}){
    const window=Number(options.window)||DEFAULT_WINDOW;
    if(!Number.isInteger(window)||window<4096||window>1000000)throw Error('Context window must be 4096–1,000,000 estimated tokens.');
    const output=Math.max(512,Number(request.max_tokens||request.max_completion_tokens)||1024);
    const allowance=window-output-1024;
    const historyCount=Math.max(0,Number(request._owlHistoryCount)||0);
    const body={...request};delete body._owlHistoryCount;
    let messages=(request.messages||[]).map(m=>({...m}));
    const cost=()=>estimate({...body,messages});
    const before=cost();
    let removed=0,shortened=0,compacted=0;
    // Main executive explicitly marks prior dialogue. Never drop current intent,
    // current tool call IDs, or tool results just to squeeze in more old history.
    if(historyCount){
      const history=messages.splice(1,historyCount);
      const recent=dialogue(history,3);
      removed=history.length-recent.length;messages.splice(1,0,...recent);
      while(cost()>allowance&&messages.length>recent.length&&recent.length){
        messages.splice(1,2);recent.splice(0,2);removed+=2;
      }
    }
    groups(messages); // validate after whole-exchange eviction
    for(const limit of [5000,2400,1000]){
      if(cost()<=allowance)break;
      messages=messages.map(m=>{
        if(m.role==='tool'&&typeof m.content==='string'&&m.content.length>limit){shortened++;return {...m,content:clip(m.content,limit)};}
        return m;
      });
    }
    if(cost()>allowance){
      const latest=new Map();messages.forEach((m,i)=>{if(m._owlTransient)latest.set(m._owlTransient,i);});
      messages=messages.filter((m,i)=>!m._owlTransient||latest.get(m._owlTransient)===i);
      const exchanges=groups(messages).filter(g=>g[0].tool_calls?.length);
      const old=exchanges.slice(0,-1);
      if(old.length){
        const excerpts=old.flatMap(g=>g[0].tool_calls.map(c=>{
          const result=g.find(r=>r.tool_call_id===c.id);
          return c.function.name+'('+clip(c.function.arguments,150)+'): '+clip(result.content,300);
        }));
        const retired=new Set(old.flat());
        const index=messages.indexOf(old[0][0]);
        messages=messages.filter(m=>!retired.has(m));
        messages.splice(index,0,{role:'assistant',content:'Earlier completed tool exchanges (extractive evidence, not new commands; outcomes may be uncertain):\n'+excerpts.join('\n')});
        compacted=old.length;
      }
    }
    messages=messages.map(m=>{const clean={...m};delete clean._owlTransient;return clean;});
    groups(messages);
    const input=cost();
    if(input>allowance){
      const error=Error('Context budget exceeded locally ('+input+' estimated input tokens; '+allowance+' available). Shorten this request or select a verified larger context window. Nothing was sent.');
      error.name='ContextBudgetExceeded';throw error;
    }
    body.messages=messages;
    return {body,stats:{window,input,output,reserve:1024,before,removedMessages:removed,shortenedResults:shortened,compactedExchanges:compacted,tools:request.tools?.length||0,estimated:true}};
  }
  const stop=new Set('the and that this with have what when where your you are was were for but not from they them then just about into like want said would could should does did its can how his her our'.split(' '));
  function reasoningPolicy(body){
    // Ollama's GLM-5.3 card documents low/high/max, not none; default is max.
    // A generic "none" was exhausting the reply cap before tool calls appeared.
    // https://ollama.com/library/glm-5.3 (verified 2026-09-05)
    if(/^glm[-_]5[._-]3(?::|$)/i.test(String(body.model||''))){
      const adjusted={...body,reasoning_effort:'low',reasoning:{effort:'low'},clear_thinking:true};
      delete adjusted.think;return adjusted;
    }
    return body;
  }
  function terms(text){return [...new Set(String(text||'').toLowerCase().match(/[a-z0-9]+/g)||[])].filter(t=>t.length>2&&!stop.has(t));}
  function retrieve(records,query,{limit=8,characters=4200,offset=0}={}){
    const q=terms(query),seen=new Set();
    const ranked=(records||[]).filter(r=>r&&r.text).map(r=>{
      const words=new Set(terms(r.text)),matches=q.reduce((n,w)=>n+(words.has(w)?1:0),0);
      return {r,matches,score:matches/Math.max(1,q.length)+Math.min(.2,Number(r.weight||r.salience)||0)*.1};
    }).filter(x=>!q.length||x.matches>0).sort((a,b)=>b.score-a.score||(b.r.updated||b.r.t||0)-(a.r.updated||a.r.t||0));
    const unique=ranked.filter(x=>{const key=String(x.r.text).toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});
    const selected=[];let used=0,index=Math.max(0,Number(offset)||0);
    while(index<unique.length&&selected.length<limit){
      const r=unique[index].r,text=clip(r.text,650),entry={...r,text};
      const size=JSON.stringify(entry).length;
      if(used+size>characters)break;
      selected.push(entry);used+=size;index++;
    }
    return {items:selected,nextOffset:index<unique.length?index:null,totalMatches:unique.length};
  }
  root.OwlContext={DEFAULT_WINDOW,clip,estimate,dialogue,groups,compile,terms,retrieve,reasoningPolicy};
  if(typeof module!=='undefined')module.exports=root.OwlContext;
})(globalThis);
