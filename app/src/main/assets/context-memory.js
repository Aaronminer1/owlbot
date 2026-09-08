/* Local episodic archive and selective recall. Never uploaded wholesale. */
const CONTEXT_MEMORY={db:null,opening:null,error:'',workingError:'',saved:0};
function memoryArchiveOpen(){
  if(CONTEXT_MEMORY.db)return Promise.resolve(CONTEXT_MEMORY.db);
  if(CONTEXT_MEMORY.opening)return CONTEXT_MEMORY.opening;
  CONTEXT_MEMORY.opening=new Promise((resolve,reject)=>{
    if(typeof indexedDB==='undefined'){reject(Error('Local conversation archive is unavailable'));return;}
    const request=indexedDB.open('owlbot_conversation_archive_v1',1);
    request.onupgradeneeded=()=>{
      const store=request.result.createObjectStore('turns',{keyPath:'id'});
      store.createIndex('time','t');store.createIndex('terms','terms',{multiEntry:true});
    };
    request.onerror=()=>reject(request.error||Error('Cannot open local archive'));
    request.onblocked=()=>reject(Error('Local archive upgrade is blocked by another app window'));
    request.onsuccess=()=>{CONTEXT_MEMORY.db=request.result;resolve(request.result);};
  }).catch(e=>{CONTEXT_MEMORY.opening=null;CONTEXT_MEMORY.error=e.message;throw e;});
  return CONTEXT_MEMORY.opening;
}
async function archiveConversations(records){
  if(!records.length)return true;
  try{
    const db=await memoryArchiveOpen();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('turns','readwrite'),store=tx.objectStore('turns');
      for(const c of records){
        if(!c?.user||!c?.owl)continue;
        const row={t:Number(c.t)||0,person:c.person||null,user:String(c.user),owl:String(c.owl)};
        // Exact content key makes interrupted migration/retries idempotent.
        row.id=JSON.stringify([row.t,row.person,row.user,row.owl]);
        row.terms=OwlContext.terms(row.user+' '+row.owl);store.put(row);
      }
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Archive save aborted'));
    });
    CONTEXT_MEMORY.error='';CONTEXT_MEMORY.saved+=records.length;return true;
  }catch(e){CONTEXT_MEMORY.error='Conversation archive not saved: '+e.message;return false;}
}
function memoryRecords(){
  const records=[];
  for(const x of MEM.answeredQuestions||[])records.push({kind:'human_answer',t:x.t,text:'Question/context: '+x.context+' | Person reported: '+x.answer+' | Source: '+x.source+'. Not independent visual verification.'});
  for(const p of Object.values(MEM.people||{})){
    if(p?.name)records.push({kind:'person_record',t:p.seen||p.met||0,
      text:'Stored person name: '+p.name+'. Notes: '+(p.notes||[]).join('; ')+'. This old record does not identify whoever is currently present.'});
  }
  for(const [kind,list]of Object.entries({lesson:MEM.lessons,fact:MEM.facts,long_term:MEM.longTerm,shared:MEM.shared,summary:MEM.summaries})){
    for(const x of list||[])records.push({kind:x.kind||kind,text:String(x.text||x.summary||''),t:x.t||x.updated||0,weight:x.weight||x.salience||0});
  }
  for(const c of MEM.conversations||[])records.push({kind:'transcript',t:c.t,text:'Person: '+c.user+' | My reply (not proof of facts): '+c.owl});
  for(const x of AUTONOMY.world||[])records.push({kind:'past_observation',t:x.t,text:x.summary});
  for(const x of MEM.bodyExperiences||[])records.push({kind:'action_evidence',t:x.t,text:x.text});
  return records;
}
function relevantMemoryContext(query){
  const result=OwlContext.retrieve(memoryRecords(),query,{limit:4,characters:1900});
  return result.items.map(r=>'['+r.kind+'; '+(r.t?new Date(r.t).toISOString():'date unknown')+'] '+r.text).join('\n');
}
async function recallContextMemory(query='',offset=0){
  const records=memoryRecords();
  let archiveAvailable=false;
  try{
    const db=await memoryArchiveOpen(),words=OwlContext.terms(query).sort((a,b)=>b.length-a.length).slice(0,4);
    const archived=new Map();
    await Promise.all((words.length?words:[null]).map(word=>new Promise((resolve,reject)=>{
      const tx=db.transaction('turns','readonly'),store=tx.objectStore('turns');let count=0;
      const req=word?store.index('terms').openCursor(IDBKeyRange.only(word)):store.index('time').openCursor(null,'prev');
      req.onerror=()=>reject(req.error);
      req.onsuccess=()=>{const c=req.result;if(!c||count++>=400){resolve();return;}archived.set(c.value.id,c.value);c.continue();};
    })));
    for(const c of archived.values())records.push({kind:'transcript',t:c.t,text:'Person: '+c.user+' | My reply (not proof of facts): '+c.owl});
    archiveAvailable=true;
  }catch(e){CONTEXT_MEMORY.error=e.message;}
  const result=OwlContext.retrieve(records,query,{limit:8,characters:5000,offset});
  return JSON.stringify({...result,archiveAvailable,search:'local lexical retrieval; up to 400 archive candidates per search word, not an exhaustive semantic search',warning:CONTEXT_MEMORY.error||undefined});
}
function recordEmbodiedExperience(tool,args,result,before,after){
  if(!['move','look_at','gesture','perform_body_sequence','move_named_servos'].includes(tool))return;
  const text='Action '+tool+' '+OwlContext.clip(JSON.stringify(args),220)+
    '; controller result: '+OwlContext.clip(result,330)+
    '; before ('+before.facing+'): '+OwlContext.clip(before.report||'no fresh view',220)+
    '; after ('+after.facing+'): '+OwlContext.clip(after.report||'no fresh view; physical outcome unverified',280)+
    '. Reports are visual-model interpretations; this is an episode, not a proven general rule.';
  MEM.bodyExperiences=Array.isArray(MEM.bodyExperiences)?MEM.bodyExperiences:[];
  MEM.bodyExperiences.push({t:Date.now(),text});MEM.bodyExperiences=MEM.bodyExperiences.slice(-100);memSave();
}
