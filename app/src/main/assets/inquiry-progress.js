/* Evidence ledger for curiosity, not another movement executor. A finding must
 * cite a recent report ID and an exact excerpt; interpretation stays separate.
 * Repeated unchanged views and accepted controller commands do not count as
 * new discoveries. These are model observations, not measured localization.
 * Only the foreground tool/movement layers may act on the retained question. */
const INQUIRY_KEY='owlbot_inquiry_progress_v1';
const INQUIRY={evidence:[],unchangedViews:0,failedActions:0,lastAction:null};
const COMPLETED_INQUIRY_KEY='owlbot_completed_inquiries_v1';
const COMPLETED_INQUIRIES={records:[],saveError:''};
function inquiryTerms(text){
 const stop=new Set('a an the is are was were what which this that it its on in of to and or for with does do did can could would should has have how me my i you your from near sitting standing'.split(' '));
 return [...new Set(String(text||'').toLowerCase().match(/[a-z0-9]+/g)||[])].filter(x=>x.length>1&&!stop.has(x));
}
function inquiryOverlap(a,b){
 const aa=inquiryTerms(a),bb=inquiryTerms(b),hits=aa.filter(x=>bb.includes(x)).length;
 return hits>=2?hits/Math.max(aa.length,bb.length):0;
}
function inquiryQuestionFacet(q){
 if(/\b(?:what(?:['’]s| is) (?:in|inside)|what .{0,40}(?:contains|contain|holds)|contents)\b/i.test(q))return 'contents';
 if(/\b(?:used for|purpose of)\b/i.test(q))return 'function';
 if(/\bwhat colou?r\b/i.test(q))return 'color';
 if(/\bmade (?:of|from)\b/i.test(q))return 'material';
 if(/\b(?:how (?:big|tall|wide)|dimensions|size of)\b/i.test(q))return 'size';
 if(/\b(?:where is|where are|location of)\b/i.test(q))return 'location';
 if(/\b(?:why|how does|how do)\b/i.test(q))return 'mechanism';
 if(/\b(?:what (?:is|are)|what['’]s|identify|which)\b/i.test(q))return 'identify';
 if(/\b(?:what does|function|purpose)\b/i.test(q))return 'function';
 return 'other';
}
function completedInquiryMatch(args){
 return COMPLETED_INQUIRIES.records.slice().reverse().find(r=>{
  if(inquiryQuestionFacet(r.question)!==inquiryQuestionFacet(args.question))return false;
  const colors=s=>String(s||'').toLowerCase().match(/\b(?:red|blue|yellow|green|orange|purple|black|white|gray|grey|pink|brown)\b/g)||[];
  const a=colors(r.target||r.question),b=colors(args.target||args.question);
  if(a.length&&b.length&&!a.some(x=>b.includes(x)))return false;
  if(args.target&&r.target&&inquiryOverlap(args.target,r.target)<.6)return false;
  return inquiryOverlap(args.question,r.question)>=.6;
 })||null;
}
function saveCompletedInquiries(){
 try{localStorage.setItem(COMPLETED_INQUIRY_KEY,JSON.stringify(COMPLETED_INQUIRIES.records));COMPLETED_INQUIRIES.saveError='';}
 catch(e){COMPLETED_INQUIRIES.saveError='Completed investigations could not be saved; persistence is not confirmed.';}
}
function rememberCompletedInquiry(thread,save=true){
 if(thread.status!=='resolved')return;
 const findings=(thread.evidence||[]).filter(x=>x?.text).slice(-2).map(x=>String(x.text).slice(0,300)).join(' | ');
 if(!findings)return;
 const record={id:thread.id,question:String(thread.question).slice(0,180),target:String(thread.target||'').slice(0,160),
  finding:findings,updated:Number(thread.updated)||Date.now(),source:'previously resolved investigation; recorded evidence, not independent verification'};
 COMPLETED_INQUIRIES.records=COMPLETED_INQUIRIES.records.filter(x=>x.id!==record.id).concat(record).sort((a,b)=>a.updated-b.updated).slice(-200);
 if(save)saveCompletedInquiries();
}
function completedInquiryRecords(){return COMPLETED_INQUIRIES.records.map(r=>({kind:'completed_investigation',t:r.updated,
 text:'ALREADY INVESTIGATED: '+r.question+' Target: '+r.target+'. Recorded finding: '+r.finding+'. '+r.source+'. Do not reopen automatically without relevant changed evidence; a different question about it is allowed.'}));}
function quietCompletedInquiryQuestions(text){
 return String(text||'').split(/(?<=[.!?])\s+/u).filter(line=>{
  if(!line.includes('?'))return true;
  const done=completedInquiryMatch({question:line});if(!done)return true;
  const focus=typeof activeWonder==='function'?activeWonder():null;
  // A legitimately reopened investigation may ask its new evidence question.
  return Boolean(focus&&focus.created>done.updated&&inquiryOverlap(focus.question,line)>=.6);
 }).join(' ').trim();
}
function completedInquiryGate(args){
 const done=completedInquiryMatch(args);if(!done)return '';
 const request=typeof MIND!=='undefined'&&MIND.activeUserTurn?String(MIND.activeRequest?.text||''):'';
 const ownerRecheck=/\b(?:again|recheck|revisit|double.check|check (?:it|that|this) once more)\b/i.test(request);
 const evidence=INQUIRY.evidence.find(e=>e.id===args.newEvidenceId&&e.novel&&e.at>done.updated&&Date.now()-e.at>=0&&Date.now()-e.at<=60000);
 const subject=inquiryTerms(done.target||done.question),observed=inquiryTerms(evidence?.text);
 const hits=subject.filter(x=>observed.includes(x)).length;
 const changed=Boolean(String(args.revisitReason||'').trim().length>=12&&evidence&&hits>=2&&hits/subject.length>=.5);
 if(ownerRecheck||changed)return '';
 return 'Already investigated: '+done.question+' Recorded finding: '+done.finding+
  '. Keep this closed and choose another useful question or target. Reopen only for an explicit owner recheck or relevant changed evidence with newEvidenceId and revisitReason.';
}
function loadCompletedInquiries(){
 try{const rows=JSON.parse(localStorage.getItem(COMPLETED_INQUIRY_KEY)||'[]');if(Array.isArray(rows))COMPLETED_INQUIRIES.records=rows.filter(x=>x&&typeof x.id==='string'&&typeof x.question==='string'&&typeof x.finding==='string'&&Number.isFinite(x.updated)).slice(-200);}catch(e){}
 // Seed only existing resolved records; retain them after the working journal
 // rotates, without reopening a task or manufacturing a new observation.
 if(typeof WONDER!=='undefined')for(const w of WONDER.threads||[])rememberCompletedInquiry(w,false);
 saveCompletedInquiries();
}
function inquiryLoad(){
  try{const saved=JSON.parse(localStorage.getItem(INQUIRY_KEY)||'null');
    if(saved&&Array.isArray(saved.evidence))INQUIRY.evidence=saved.evidence.filter(e=>e&&typeof e.text==='string'&&Number.isFinite(e.at)).slice(-8);
  }catch(e){}
}
function inquirySave(){try{localStorage.setItem(INQUIRY_KEY,JSON.stringify(INQUIRY));}catch(e){}}
function inquiryText(text){
  return String(text||'').split(/OPEN QUESTION:|AFFORDANCE:|FOCUS:/i)[0]
    .replace(/^\s*CHANGE:\s*(?:NONE|MINOR|MAJOR|UNCERTAIN)[.\s]*/i,'').replace(/\s+/g,' ').trim();
}
function inquiryObserve(report,at,facing){
  if(APP.resting||APP.settings||!report||!Number.isFinite(at))return;
  if(INQUIRY.evidence.some(e=>e.at===at))return;
  const text=inquiryText(report);if(text.length<12)return;
  const comparable=INQUIRY.evidence.filter(e=>e.facing===facing).slice(-4);
  const repeated=comparable.some(e=>perceptionSimilarity(inquiryText(e.text),text)>=.85);
  const novel=!repeated&&(!/^\s*CHANGE:\s*NONE\b/i.test(report)||!comparable.length);
  INQUIRY.evidence.push({id:'vision-'+at,at,facing,text:String(report).slice(0,1800),novel});
  INQUIRY.evidence=INQUIRY.evidence.slice(-8);
  INQUIRY.unchangedViews=novel?0:INQUIRY.unchangedViews+1;
  if(novel){INQUIRY.failedActions=0;MIND.initiativeExperiments=(MIND.initiativeExperiments||0)+1;
    recordCuriosityMove('experiment','New visual evidence',text);}
  inquirySave();
}
function inquiryAction(tool,result){
  if(!['move','start_walking','look_at','use_camera','test_body_output','repair_body','diagnose_body'].includes(tool))return;
  const failed=classifyActionResult(result)==='failed';
  INQUIRY.lastAction={tool,at:Date.now(),failed,detail:String(result||'').slice(0,200)};
  if(failed)INQUIRY.failedActions++;
  // Successful PWM/ACKs do not reset lack-of-evidence or feed curiosity.
  inquirySave();
}
function inquiryBindWonder(thread,args){
  const task=activeOwnerTask()||(typeof activeSelfTask==='function'?activeSelfTask():null);
  thread.target=String(args.target||thread.target||'').trim().slice(0,160);
  thread.taskId=thread.taskId||task?.id||null;
  thread.destination=thread.destination||String(task?.title||'').slice(0,180);
  thread.requiresVisualEvidence=Boolean(thread.requiresVisualEvidence||thread.target||task?.requiresMotion);
  thread.evidenceIds=Array.isArray(thread.evidenceIds)?thread.evidenceIds:[];
}
function inquiryValidateEvidence(thread,args){
  if(!thread.requiresVisualEvidence||args.status==='abandoned')return {ok:true};
  const e=INQUIRY.evidence.find(e=>e.id===args.evidenceId);
  if(!e||Date.now()-e.at>60000||Date.now()<e.at)return {ok:false,error:'a fresh vision evidenceId from INVESTIGATION is required; controller ACKs are not visual evidence. '+inquiryEvidenceContext()};
  if((thread.evidenceIds||[]).includes(e.id))return {ok:false,error:'that evidence was already used; retain the question and obtain a useful new observation'};
  const quote=String(args.evidence||'').toLowerCase().replace(/\s+/g,' ').trim();
  if(quote.length<8||!e.text.toLowerCase().replace(/\s+/g,' ').includes(quote))return {ok:false,error:'evidence must be a short exact excerpt of that vision report; put interpretation in revisedHypothesis'};
  if(args.status==='resolved'&&args.predictionResult==='inconclusive')return {ok:false,error:'inconclusive evidence cannot resolve the question'};
  return {ok:true,id:e.id,source:'vision model report',at:e.at};
}
function inquiryEvidenceContext(){
  const entries=INQUIRY.evidence.filter(e=>Date.now()>=e.at&&Date.now()-e.at<=60000).slice(-2);
  return entries.length?'CURRENT CITABLE VISION EVIDENCE (model observations, not measured position): '+JSON.stringify(entries.map(e=>({evidenceId:e.id,facing:e.facing,ageMs:Date.now()-e.at,report:e.text})))+' Copy an exact excerpt into evidence; place interpretation in revisedHypothesis. Inconclusive evidence leaves the question open; abandon with a reason if it cannot be tested.':'No unexpired visual evidence is available. Obtain a useful fresh view or abandon with a reason; never invent an evidence ID.';
}
function inquirySnapshot(){
  const w=activeWonder(),task=activeOwnerTask()||(typeof activeSelfTask==='function'?activeSelfTask():null);
  const recent=INQUIRY.evidence.slice(-2).map(e=>({id:e.id,ageMs:Date.now()-e.at,facing:e.facing,novel:e.novel,text:e.text.slice(0,700)}));
  const stalled=INQUIRY.unchangedViews>=2||INQUIRY.failedActions>=2;
  return {focus:w?{id:w.id,target:w.target||w.observations?.[0]?.text,question:w.question,
    prediction:w.hypothesis,nextTest:w.nextTest,destination:w.destination||task?.title,
    taskId:w.taskId,requiresVisualEvidence:!!w.requiresVisualEvidence,lastFinding:w.evidence?.slice(-1)}:null,
    destination:task?.title||null,recentEvidence:recent,unchangedViews:INQUIRY.unchangedViews,failedActions:INQUIRY.failedActions,
    critique:stalled?'No new evidence after repeated attempts. Keep the destination; choose a different useful viewpoint or route, or defer this object with a reason and investigate another. Do not repeat the same scan or retry loop. Camera safety checks still apply.':'Choose a question and a test, act, compare evidence, then continue or resolve.',
    completedHistory:{count:COMPLETED_INQUIRIES.records.length,warning:COMPLETED_INQUIRIES.saveError||null},
    arrival:'Gait completion and head motion do not establish arrival. These reports are visual-model evidence, not measured localization.'};
}
function resumeInterruptedInvestigation(){
  if(APP.resting||APP.settings||!MIND.on||!MIND.motionArmed||!AUTONOMY.enabled||!bodyControllerReady())return false;
  // A recovered controller is not permission to interrupt a shared story or
  // conversation with an old investigation. Retry naturally after that lane yields.
  if(typeof humanConversationOwnsResources==='function'&&humanConversationOwnsResources())return false;
  const task=TASKS.items.filter(t=>t.source==='owner'&&t.status==='blocked'&&t.requiresMotion).find(t=>t.resumeOnConnection===true);
  if(!task||!S.bodyLastSeenAt||S.bodyLastSeenAt<task.blockedAt)return false;
  const active=TASKS.items.find(t=>t.status==='active');
  // Newer explicit owner work outranks the interrupted investigation.
  if(TASKS.items.some(t=>t.source==='owner'&&['active','queued'].includes(t.status)&&t.created>task.blockedAt))return false;
  if(active)active.status='queued';
  task.status='active';task.resumeOnConnection=false;task.blockedCount=0;task.updated=Date.now();
  task.evidence=Array.isArray(task.evidence)?task.evidence:[];
  task.evidence.push({t:Date.now(),text:'Fresh controller evidence restored the connection. Resume the existing destination and next test; arrival remains unverified.'});
  task.evidence=task.evidence.slice(-12);taskSave();
  AUTONOMY.nextCycleAt=Date.now();AUTONOMY.blockedUntil=0;autonomySave();
  return true;
}
function inquiryMigrateBlockedTasks(){
  // Upgrade only recognizably connection-blocked owner investigations. Keep
  // obstacle stops and explicit owner/power pauses untouched.
  let changed=false;
  for(const task of TASKS.items){
    if(task.source!=='owner'||task.status!=='blocked'||!task.requiresMotion||task.resumeOnConnection!==undefined)continue;
    const last=task.evidence?.slice(-1)[0]?.text||'';
    if(!/explor|investigat/i.test(task.title)||!/disconnect|connection|controller|pico|relay|ack timeout|offline|not responding/i.test(last)||
      /owner.*(?:stop|pause|cancel)|power.*(?:off|unplug)|unsafe|stairs|ledge/i.test(last))continue;
    if(!Number.isFinite(task.updated))continue;
    task.resumeOnConnection=true;task.blockedAt=task.updated;changed=true;
  }
  if(changed)taskSave();
}
inquiryLoad();
inquiryMigrateBlockedTasks();
loadCompletedInquiries();
