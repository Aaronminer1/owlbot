/* Continuity for the existing executive, not another model/motor loop.
 * A new frame is evidence; it is not evidence of travel or goal completion. */
function explorationWorkPending(){
  const owner=activeOwnerTask();
  if(owner)return Boolean(owner.requiresMotion);
  return Boolean(activeSelfTask()?.requiresMotion||activePersonalMission()?.requiresMotion||activeWonder()?.target);
}
function explorationMomentumReady(){
  return Boolean(AUTONOMY.enabled&&MIND.on&&!APP.resting&&!APP.settings&&MIND.motionArmed&&
    bodyEmbodimentReady()&&bodyControllerReady()&&explorationWorkPending()&&
    !(typeof ownerBodyMotionProblem==='function'&&ownerBodyMotionProblem()));
}
function explorationTurnSummary(outcomes=[]){
  const useful=outcomes.filter(x=>!bodyToolFailed(x.result)&&classifyActionResult(x.result)!=='failed');
  // Accepted locomotion is an attempt, not measured arrival. A look/note alone
  // must not reset the counter for repeated stationary investigations.
  return {locomotion:useful.some(x=>['move','start_walking','test_body_output'].includes(x.tool)),
    observation:useful.some(x=>['look_at','use_camera','read_distance','update_curiosity'].includes(x.tool))};
}
function recordExplorationContinuity(outcomes=[]){
  if(!explorationWorkPending())return null;
  const wonder=activeWonder(),task=activeOwnerTask()||activeSelfTask(),mission=activePersonalMission();
  const targetId=wonder?.id||task?.id||mission?.id||'explore';
  const old=AUTONOMY.approachContinuity;
  const state=old?.targetId===targetId?old:{targetId,stationaryTurns:0};
  const summary=explorationTurnSummary(outcomes);
  state.stationaryTurns=summary.locomotion?0:state.stationaryTurns+1;
  state.lastTurnAt=Date.now();state.lastLocomotionAttempt=summary.locomotion?Date.now():state.lastLocomotionAttempt||null;
  state.lastStep=summary.locomotion?'locomotion_attempt':summary.observation?'stationary_observation':'planning_only';
  AUTONOMY.approachContinuity=state;
  return state;
}
function explorationMomentumPrompt(){
  if(!explorationWorkPending())return '';
  const w=activeWonder(),state=AUTONOMY.approachContinuity;
  const turns=state?.targetId===(w?.id||activeOwnerTask()?.id||activeSelfTask()?.id||activePersonalMission()?.id||'explore')?state.stationaryTurns:0;
  const repeated=(w?.evidence||[]).slice(-3).filter(x=>x.predictionResult==='inconclusive').length>=3;
  return 'APPROACH COMMITMENT: '+JSON.stringify({target:w?.target||null,question:w?.question||null,nextTest:w?.nextTest||null,stationaryTurns:turns,repeatedInconclusive:repeated})+
    '. Keep a specific destination and the detail you want to learn. A head look, another image or updating notes is not travel. '+
    'If a closer viewpoint would answer the question, orient toward it and use a sustained walking session at the saved pace; do not stop merely because a model turn ends. '+
    'If the immediate route is obstructed, inspect an alternative and preserve the destination. If the scene no longer contains that target, explicitly defer the old investigation and open the new one; do not attach a cabinet finding to an old shelving question. '+
    ((turns>=2||repeated)?'Repeated stationary investigation has not answered this question. In this turn choose an evidence-supported approach, a concrete alternate route, or defer this target and select a genuinely different reachable target. Another unchanged scan or plan is not progress. ':'')+
    'An unverified route still needs fresh evidence; this commitment never overrides Stop, feet-still, sleep or motor-off. Keep logistics silent.';
}
function explorationContinuationDelay(){
  const n=Number(AUTONOMY.approachContinuity?.stationaryTurns)||0;
  return n===0?5000:n===1?10000:n===2?15000:30000;
}

/* A mind pause cancels work from that mind, not manual Controls. Signal checks
 * also run after model/preflight awaits so late results cannot start a turn. */
function mindActionGuard(signal){
  if(signal?.aborted)throw Object.assign(Error('Action cancelled with its thinking turn.'),{name:'AbortError'});
}
function pauseMindLocomotion(){
  const s=typeof WALK_STREAM!=='undefined'?WALK_STREAM.session:null;
  const walking=Boolean(s?.active&&s.mindOwned);
  const active=Boolean(MIND.activeLocomotion);
  if(!walking&&!active)return;
  if(walking)cancelWalkingSession('Mind paused; walking stopped.');
  if(typeof CHANNEL_SETUP!=='undefined')CHANNEL_SETUP.generation++;
  if(typeof NW!=='undefined')NW.abort?.abort();
  if(bodyControllerReady())for(const action of ['walk_halt','turn_halt'])
    channelCommand(action).catch(e=>log('Mind pause stop unconfirmed: '+e.message,'e'));
  // No release command: retain the supported head pose.
}
