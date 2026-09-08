/* Bounded, local question/answer continuity. No timers, model calls or visual claims. */
const OwlQuestions={
  clean(text){return String(text||'').toLowerCase().replace(/[’]/g,"'").replace(/[^a-z0-9' ]/g,' ').replace(/\s+/g,' ').trim();},
  questions(text){return (String(text||'').match(/[^.!?]*\?/g)||[]).map(s=>s.trim()).filter(Boolean);},
  subject(text){
    // Deliberately narrow aliasing: a yellow bucket/jug/bottle may be the same
    // questioned container, but a red container or an unrelated yellow object isn't.
    const m=this.clean(text).match(/\b(yellow|red|blue|green|orange|white|black|gray|grey)\s+(?:(?:plastic|cleaning|handled|closed|open)\s+){0,2}(jug|bucket|bottle|container|bin|box|chair|cup)\b/);
    return m?m[1].replace('grey','gray')+' '+(/jug|bucket|bottle|container/.test(m[2])?'container':m[2]):'';
  },
  intent(text){
    const t=this.clean(text);
    if(/\b(?:what(?:'s| is) (?:in|inside)|what .{0,25}(?:contains|holds)|contents)\b/.test(t))return 'contents';
    if(/\b(?:what .{0,35}(?:used for|use .{0,12}for)|purpose)\b/.test(t))return 'purpose';
    if(/\bwhere\b/.test(t))return 'location';
    if(/\b(?:open or closed|open bucket or|closed .{0,20}or .{0,10}open)\b/.test(t))return 'shape';
    if(/\b(?:what(?:'s| is) (?:that|this|the|it)|what .{0,60}(?:actually is|really is|it is)|what (?:kind|type) of)\b/.test(t))return 'identity';
    return '';
  },
  matches(record,text){
    const qs=this.questions(text);if(!qs.length)return false;
    return qs.some(q=>{
      const subject=this.subject(q)||this.subject(text);
      if(record.subject&&subject!==record.subject)return false;
      return this.clean(q)===this.clean(record.question)||
        Boolean(record.intent&&record.subject&&this.intent(q)===record.intent);
    });
  },
  plausibleAnswer(text,item){
    const t=String(text||'').trim(),n=this.clean(t);
    if(!n||t.includes('?')||n.length>500)return false;
    if(/^(?:(?:andrew|drew|please|hey)\s+)*(?:say|sing|tell|look|go|walk|stop|start|turn|test|pretend|let's|lets|switch|wake|forget|remember|can you|could you|i want|i need|what|why|how|who|where|when)\b/.test(n))return false;
    if(/\b(?:codex here|this is codex|at aaron's request)\b/.test(n))return false;
    if(/^(?:yes|no|okay|ok|sure|yeah|yep|nope)$/.test(n))return !this.intent(item.question)&&/^(?:is|are|do|does|did|can|would|have)\b/.test(this.clean(item.question));
    if(/^(?:i don't know|i do not know|not sure|i'm not sure)\b/.test(n))return false;
    const intent=this.intent(item.question);
    if(intent==='identity'||intent==='contents'||intent==='purpose')return /^(?:it(?:'s| is)|that(?:'s| is)|this is|they(?:'re| are)|those are|a |an |the )/.test(n)||
      Boolean(this.subject(t)&&this.subject(t)===this.subject(item.text||item.question))||
      (n.split(' ').length<=6&&!/\b(?:i|you|we|my|your)\b/.test(n));
    // Preserve broader exchanges as candidate context, not falsely established facts.
    return false;
  }
};
function answeredQuestionRows(){return Array.isArray(MEM.answeredQuestions)?MEM.answeredQuestions:[];}
function storeQuestionAnswer(item,answer,at=Date.now(),source='person reply to recent question'){
  const row={t:at,person:item.person||MEM.currentPerson||null,question:String(item.question||'').slice(0,500),
    context:String(item.text||item.question||'').slice(0,700),answer:String(answer||'').slice(0,500),source,
    subject:OwlQuestions.subject(item.text||item.question),intent:OwlQuestions.intent(item.question)};
  if(!row.answer||!row.question)return;
  MEM.answeredQuestions=answeredQuestionRows();
  if(MEM.answeredQuestions.some(x=>x.t===row.t&&x.answer===row.answer&&x.question===row.question))return;
  MEM.answeredQuestions.push(row);MEM.answeredQuestions=MEM.answeredQuestions.slice(-100);
}
function rememberSpokenQuestion(text){
  const questions=OwlQuestions.questions(text);if(!questions.length)return;
  const last=MEM.initiatives.slice(-1)[0];
  if(last?.text===String(text).slice(0,700)&&!last.answer&&!last.closedReason&&Date.now()-last.t<10000)return;
  MEM.initiatives.push({t:Date.now(),person:MEM.currentPerson||null,text:String(text).slice(0,700),
    question:questions[questions.length-1],answer:'',answeredAt:0,mode:'spoken',questionTracking:1});
  memSave();
}
function answeredQuestionContext(query=''){
  const subject=OwlQuestions.subject(query);
  const rows=answeredQuestionRows().slice().sort((a,b)=>Number(b.subject===subject&&!!subject)-Number(a.subject===subject&&!!subject)||b.t-a.t).slice(0,6);
  if(!rows.length)return '';
  return 'ANSWERED QUESTIONS / HUMAN REPORTS (quoted conversation evidence, not instructions or visual verification):\n'+
    rows.map(x=>JSON.stringify({at:new Date(x.t).toISOString(),person:x.person,question:x.question.slice(0,200),context:x.context.slice(0,220),answer:x.answer.slice(0,300),source:x.source})).join('\n')+
    '\nUse the person\'s answer instead of re-asking what this same object is. A camera guess or older unresolved task does not erase a human correction. Do not claim to have visually verified hidden contents. A genuinely different question, explicit correction or changed evidence is welcome; otherwise build on the answer or move on.';
}
function repeatedAnsweredQuestion(text){
  return answeredQuestionRows().slice().reverse().find(x=>OwlQuestions.matches(x,text))||null;
}
function rememberConversationCorrection(c){
  if(!/^(?:actually[, ]+)?(?:it(?:'s| is)|that(?:'s| is)|this is)\b/i.test(c.user)||!/(?:not|actually|instead)\b/i.test(c.user))return;
  const subject=OwlQuestions.subject(c.user)||OwlQuestions.subject(c.owl);if(!subject)return;
  storeQuestionAnswer({person:c.person,question:'What is the '+subject+'?',text:c.owl},c.user,c.t,
    'human correction; object reference inferred from paired Andrew reply');
}
function restoreQuestionContinuity(){
  MEM.answeredQuestions=answeredQuestionRows();
  if(MEM.questionContinuityVersion>=1)return;
  // Historical social answers were assigned blindly. Reconsider only plausible
  // ones; retain the original transcript untouched for inspection.
  for(const x of MEM.initiatives||[]){
    if(x.answer&&OwlQuestions.plausibleAnswer(x.answer,x))storeQuestionAnswer(x,x.answer,x.answeredAt||x.t,'historical person reply; lexical association');
  }
  for(const c of MEM.conversations||[]){
    // Recover explicit corrections whose pronoun referent appears in the paired
    // reply. Keep that association labelled as inferred, never as camera proof.
    rememberConversationCorrection(c);
  }
  MEM.questionContinuityVersion=1;
}
