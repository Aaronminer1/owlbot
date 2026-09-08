/* Owner-controlled token spending. Ordinary memory and curiosity stay separate. */
const SELF_IMPROVEMENT={enabled:localStorage.getItem('owlbot_self_improvement_v1')==='on',generation:0,controllers:new Set()};
function selfImprovementEnabled(){return SELF_IMPROVEMENT.enabled;}
function isSelfImprovementWork(item){
  if(item?.category==='self_improvement')return true;
  const text=typeof item==='string'?item:[item?.title,item?.task,item?.objective,item?.why,item?.reason].filter(Boolean).join(' ');
  return /\bself[- ]?(?:improv\w*|review\w*|reflect\w*|tun\w*|optim\w*)\b|\b(?:reflect on|review|audit|improve|tune|optimize)\s+(?:my|your|andrew'?s|own)\s+(?:behavior|behaviour|performance|personality|tuning|responses|code|experiences|habits)\b/i.test(text);
}
function improvementWorkAllowed(item){return selfImprovementEnabled()||!isSelfImprovementWork(item);}
function reconcileImprovementWork(){
  let changed=false;
  for(const task of TASKS.items){
    if(!selfImprovementEnabled()&&isSelfImprovementWork(task)&&['queued','active','blocked'].includes(task.status)){
      task.improvementPreviousStatus=task.status;task.status='paused_improvement';changed=true;
    }else if(selfImprovementEnabled()&&task.status==='paused_improvement'){
      task.status=task.improvementPreviousStatus==='blocked'?'blocked':'queued';delete task.improvementPreviousStatus;changed=true;
    }
  }
  if(changed)taskSave();
  const m=AUTONOMY.mission;
  if(!selfImprovementEnabled()&&m?.status==='active'&&isSelfImprovementWork(m)){
    AUTONOMY.pausedImprovementMissions=(AUTONOMY.pausedImprovementMissions||[]).concat({...m,improvementPausedAt:Date.now()});
    AUTONOMY.mission=null;autonomySave();
  }else if(selfImprovementEnabled()&&!m&&AUTONOMY.pausedImprovementMissions?.length){
    const restored=AUTONOMY.pausedImprovementMissions.shift();
    if(restored.expires)restored.expires+=Date.now()-restored.improvementPausedAt;
    delete restored.improvementPausedAt;AUTONOMY.mission=restored;autonomySave();
  }
}
function renderSelfImprovement(){
  const button=$('#btnSelfImprovement'),reflectButton=$('#btnReflect'),status=$('#selfImprovementStatus');
  if(button){button.textContent='Self-improvement: '+(selfImprovementEnabled()?'on':'off');button.setAttribute('aria-pressed',String(selfImprovementEnabled()));}
  if(reflectButton)reflectButton.disabled=!selfImprovementEnabled();
  if(status)status.textContent=selfImprovementEnabled()?'On — reflection and self-tuning may run during quiet time. Conversation and walking take priority.':'Off — no reflection loop or self-tuning calls. Existing memories, conversation, exploration and walking vision remain available.';
}
function setSelfImprovementEnabled(enabled){
  // Persist before changing runtime state, so storage failures are visible to the owner.
  localStorage.setItem('owlbot_self_improvement_v1',enabled===true?'on':'off');
  SELF_IMPROVEMENT.enabled=enabled===true;SELF_IMPROVEMENT.generation++;
  if(!SELF_IMPROVEMENT.enabled){
    for(const controller of SELF_IMPROVEMENT.controllers)controller.abort();
    for(const [id,controller] of BACKGROUND.running){
      if(isSelfImprovementWork(BACKGROUND.jobs.find(j=>j.id===id)))controller.abort();
    }
    if(isSelfImprovementWork(MIND.pendingAgentEvent))MIND.pendingAgentEvent=null;
    if(MIND.busy&&!MIND.activeUserTurn&&(MIND.activeImprovementTurn||isSelfImprovementWork(AUTONOMY.mission)||TASKS.items.some(t=>t.status==='active'&&isSelfImprovementWork(t))))MIND.abort?.abort();
  }
  reconcileImprovementWork();renderSelfImprovement();
  return {enabled:SELF_IMPROVEMENT.enabled,defaultEnabled:false};
}
function selfImprovementPrompt(){
  return 'SELF-IMPROVEMENT '+(selfImprovementEnabled()?'ON: quiet-time reflection and grounded tuning are permitted.':'OFF by owner control: do not start self-review, reflection, self-tuning, or improvement jobs. Do not turn this switch on yourself. Ordinary memory, play and exploration remain available.');
}
