/* Navigation/session layer: one destination owns locomotion until completion,
 * cancellation or a bounded failure. named-walk.js owns the lower-level gait
 * and fresh-camera approvals; drive-robot.js owns calibrated turn execution.
 *
 * Keep goal state across temporary blockage; do not reuse a prior clear frame.
 * A controller cycle count proves protocol progress, not distance or arrival.
 * Stop aborts pending work, and every resumed await must still pass guard().
 * This file does not write servo calibration or generate joint trajectories.
 * See docs/REVIEW-GUIDE.md for phases, limits and tests. */
const WALK_STREAM={session:null,sequence:0};
function walkingStreamStatus(s=WALK_STREAM.session){
  return s?{id:s.id,active:s.active,target:s.target,direction:s.direction,startedAt:s.startedAt,
    completedCycles:s.completedCycles||0,outcome:s.outcome||'starting',phase:s.phase||'starting',corrections:s.corrections||0,correctionFraction:s.correctionFraction||0,corridor:s.corridor||'',failureKind:s.failureKind||null,recoveryAttempts:s.recoveryAttempts||0,goalRetained:Boolean(s.target||s.corridor||s.direction),physicalArrivalVerified:false}:
    {active:false,physicalArrivalVerified:false};
}
function walkNavigationFailure(error){
  // Classify only recoverable perception failures. A lost link, owner Stop,
  // or unconfirmed halt must NOT enter the obstacle-retry path.
  if(error?.stopUnconfirmed)return null;
  const reason=String(error?.message||error||'');let kind=error?.navigationKind;
  if(!kind){
    if(/response.*(?:truncated|not valid JSON|invalid structure)|path.*invalid classification|camera.*usable path assessment/i.test(reason))kind='vision_format';
    else if(/path camera check failed|vision.*timed out/i.test(reason))kind='vision_unavailable';
  }
  return ['blocked','uncertain','heading_uncertain','vision_slow','vision_format','vision_unavailable'].includes(kind)?{kind,reason}:null;
}
async function walkRecoveryPause(ms,guard,signal){
  const deadline=Date.now()+ms;
  while(Date.now()<deadline){
    guard();if(signal?.aborted)throw Error('Walking recovery cancelled.');
    await new Promise((resolve,reject)=>{
      const done=()=>{signal?.removeEventListener('abort',abort);resolve();};
      const timer=setTimeout(done,Math.min(250,deadline-Date.now()));
      const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(Error('Walking recovery cancelled.'));};
      signal?.addEventListener('abort',abort,{once:true});
    });
  }
  guard();
}
function cancelWalkingSession(reason='Owner Stop'){
  // Synchronous cancellation first; stopWalkingStream performs async halts.
  // Camera ownership remains until gait/steering cleanup finishes.
  const s=WALK_STREAM.session;if(!s?.active)return false;
  s.stopReason=String(reason).slice(0,180);s.active=false;
  NW.abort?.abort();s.correctionAbort?.abort();s.recoveryAbort?.abort();
  return true;
}
// Speech describes the request lifecycle, never raw controller/model payloads.
function walkingStreamSpeech(status){
  // Keep controller JSON in diagnostics, not in the spoken conversation.
  // "Accepted" means the session started checking, never that feet moved.
  if(status?.accepted&&status.active)return 'Checking the path before I walk.';
  const reason=String(status?.outcome||status?.error||'');
  const progress=Number(status?.completedCycles)>0;
  const prefix=progress?'Walking stopped. ':'I could not complete the walk. ';
  if(['vision_slow','vision_format','vision_unavailable'].includes(status?.failureKind))return prefix+'The camera service could not give a usable answer in time. That is not evidence of an obstacle.';
  if(status?.failureKind==='uncertain'||status?.failureKind==='heading_uncertain')return prefix+'The camera view was still unclear. I have kept the walking request.';
  if(/cannot proceed in that direction/i.test(reason)){
    return prefix+'The camera check reported that the next step was blocked or not clearly visible.';
  }
  if(/Pico|controller|connection|socket|disconnected|offline|not responding/i.test(reason))return prefix+'I lost contact with the leg controller.';
  if(/owner.*stop|person.*stop|course correction requested/i.test(reason))return 'Stopped as requested.';
  if(/rest|motor authority|paused in Controls/i.test(reason))return prefix+'Movement is paused.';
  if(/reassessment interval/i.test(reason))return 'Walking paused for a route reassessment.';
  if(/repeated steering/i.test(reason))return 'Walking stopped because the course corrections were not making progress.';
  if(/camera|floor|vision|head|image|path|view/i.test(reason))return prefix+'I could not confirm the path with the camera.';
  return prefix+'I could not confirm that the requested walk completed.';
}
function startWalkingStream(args={}){
  // The caller supplies intent; the local guard, not the model's confidence,
  // controls whether this session may continue after each asynchronous step.
  if(APP.resting||APP.settings)throw Error('Wake Andrew before walking.');
  if(WALK_STREAM.session?.active||NW.running)throw Error('Already walking; stop before changing course.');
  if(!bodyControllerReady())throw Error('The Pico is not responding.');
  const motor=ensureMotorControlForAction('start_walking');if(!motor.ok)throw Error(motor.message);
  const direction=args.direction||'forward',target=String(args.target||'').trim();
  if(!['forward','backward'].includes(direction)||target.length>180)throw Error('Use forward/backward and a short visible destination.');
  const seconds=Number(args.max_seconds??300);
  if(!Number.isFinite(seconds)||seconds<10||seconds>600)throw Error('Reassessment interval must be 10–600 seconds.');
  const corridor=String(args.corridor||'').trim();if(corridor.length>240)throw Error('Keep route guidance under 240 characters.');
  const courseCorrection=direction==='forward'&&args.course_correct!==false&&Boolean(target||corridor);
  const generation=typeof CHANNEL_SETUP!=='undefined'?CHANNEL_SETUP.generation:null;
  const s={id:++WALK_STREAM.sequence,active:true,target,direction,corridor,startedAt:Date.now(),completedCycles:0,corrections:0,phase:'starting',recoveryAttempts:0};
  WALK_STREAM.session=s;
  const guard=()=>{
    if(!s.active||WALK_STREAM.session!==s||Date.now()-s.startedAt>seconds*1000)throw Error(s.stopReason||'Walking reassessment interval reached.');
    if(APP.resting||APP.settings||!bodyControllerReady()||(generation!==null&&CHANNEL_SETUP.generation!==generation)||(typeof motorControlAvailable==='function'&&!motorControlAvailable()))throw Error('Walking interrupted by rest, motor authority or connection change.');
  };
  s.done=(async()=>{
    let completed=0,correctionsWithoutAdvance=0,lastCorrection='',sameHeadingCorrections=0;
    let recoveryStreak=0,visionFailures=0,detourTurns=0,detourStep=false,lastRecoveryProgress=0;
    const notified=new Set();
    while(s.active){
      guard();s.phase='walking';
      try{
        s.outcome=await runNamedForwardWalk({continuous:!detourStep,...(detourStep?{cycles:1}:{}),direction,pace:args.pace,target,corridor,courseCorrection:courseCorrection&&!detourStep,recoveryTilt:s.failureKind==='uncertain',
          sessionGuard:guard,onProgress:state=>{s.completedCycles=completed+(state.completed_cycles||0);if(state.completed_cycles>0){s.failureKind=null;recoveryStreak=0;visionFailures=0;}s.outcome='walking';}});
        if(detourStep){completed=s.completedCycles;detourStep=false;continue;}
        break;
      }catch(error){
        guard();
        const failure=walkNavigationFailure(error);
        if(failure){
          completed=Math.max(completed,s.completedCycles);
          if(completed>lastRecoveryProgress){recoveryStreak=0;detourTurns=0;lastRecoveryProgress=completed;}
          recoveryStreak++;s.recoveryAttempts++;s.failureKind=failure.kind;s.outcome=failure.reason;
          s.phase=failure.kind==='blocked'?'waiting_for_path':'waiting_for_vision';
          if(!notified.has(failure.kind)&&typeof args.onRecovery==='function'){
            notified.add(failure.kind);try{args.onRecovery(walkingStreamStatus(s));}catch(e){}
          }
          // Protocol/service failures are not obstacles. Stop retrying a broken
          // service after a small budget, retaining the destination in status.
          // Four failed service runs total (initial run + three retries).
          // This budget is separate from the whole-session reassessment timer.
          if(failure.kind.startsWith('vision_')&&++visionFailures>3)throw error;
          s.recoveryAbort=new AbortController();
          await walkRecoveryPause(Math.min(15000,1000*Math.pow(2,Math.min(4,recoveryStreak-1))),guard,s.recoveryAbort.signal);
          guard();
          if(failure.kind==='blocked'&&direction==='forward'&&recoveryStreak>=2&&detourTurns<2&&args.allow_detour!==false){
            s.phase='looking_for_route';
            try{
              const view=await checkNamedWalkPath(direction,guard,s.recoveryAbort.signal,{detour:true});guard();
              if(['left','right'].includes(view.direction)){
                const fresh=()=>{guard();if(!Number.isFinite(view.capturedAt)||walkVisionClock()-view.capturedAt>=2500||walkVisionClock()<view.capturedAt||
                  (view.headGeneration!=null&&HEAD.generation!==view.headGeneration))throw Object.assign(Error('Detour view expired before the turn.'),{navigationKind:'vision_slow'});};
                fresh();s.phase='correcting';s.correctionFraction=.08;
                try{await runDriveTurn(view.direction,{fraction:.08,sessionGuard:guard,beforeStart:fresh});}
                catch(e){try{await channelCommand('turn_halt');}catch(haltError){e.stopUnconfirmed=true;}throw e;}
                guard();detourTurns++;s.corrections++;detourStep=true;
              }
            }catch(e){guard();if(!walkNavigationFailure(e))throw e;s.failureKind=e.navigationKind||'vision_format';if(s.failureKind.startsWith('vision_')&&++visionFailures>3)throw e;}
          }
          s.recoveryAbort=null;
          // The same session retries from a NEW view. Neither an old clear
          // answer nor a detour selection grants the next forward step.
          continue;
        }
        if(!courseCorrection||!['left','right'].includes(error.courseCorrection))throw error;
        const advanced=error.completedCycles||0;completed+=advanced;s.completedCycles=completed;
        correctionsWithoutAdvance=advanced?0:correctionsWithoutAdvance+1;
        if(correctionsWithoutAdvance>3)throw Error('Repeated steering without forward progress; destination retained for route reassessment.');
        s.phase='rechecking';s.correctionAbort=new AbortController();
        const view=await checkNamedWalkPath(direction,guard,s.correctionAbort.signal,{target,corridor,courseCorrection});
        s.correctionAbort=null;guard();
        if(!view.steering||view.steering!==error.courseCorrection)continue;
        // Tiny strokes can be lost to floor slip or linkage play. Increase
        // only after a repeated, freshly confirmed same-direction error with
        // little advance; never substitute the full taught turn or edit limits.
        sameHeadingCorrections=lastCorrection===view.steering&&advanced<3?sameHeadingCorrections+1:0;
        const fraction=[.08,.12,.16][Math.min(2,sameHeadingCorrections)];
        s.correctionFraction=fraction;lastCorrection=view.steering;
        s.phase='correcting';s.outcome='small '+view.steering+' correction';
        try{await runDriveTurn(view.steering,{fraction,sessionGuard:guard});}
        catch(e){try{await channelCommand('turn_halt');}catch(haltError){}throw e;}
        guard();s.corrections++;
        // Same session, destination and deadline. The resumed walk captures
        // another aligned frame before any forward command is authorized.
      }
    }
  })().catch(error=>{s.outcome=s.stopReason||String(error.message||error);if(!walkNavigationFailure(error))s.failureKind=null;})
    .finally(()=>{
      s.active=false;s.phase='stopped';s.endedAt=Date.now();
      const outcome=walkingStreamStatus(s);
      let ownerNotified=false;
      if(typeof args.onOutcome==='function'){
        try{ownerNotified=args.onOutcome(outcome)===true;}
        catch(error){if(typeof mindLog==='function')mindLog('Walking outcome notification failed','e');}
      }
      if(!APP.resting&&!APP.settings&&MIND.on){
        MIND.pendingAgentEvent='WALKING OUTCOME: '+JSON.stringify(outcome)+
          (ownerNotified?' The owner already received the short spoken outcome; do not repeat it.':'')+
          '. Arrival is unverified. A nearby target requires a fresh stationary check. A blocked direction invites another inspected route. A person\'s Stop, lost supervision, or expired reassessment interval does not authorize an automatic restart.';
        queueMicrotask(mindTick);
      }
    });
  return {...walkingStreamStatus(),accepted:true,note:'Starting a camera-supervised walking session, not confirmation of movement or arrival.'};
}
async function stopWalkingStream(reason='Stopped for course correction.'){
  const s=WALK_STREAM.session;
  if(!s?.active)return walkingStreamStatus();
  const correcting=s.phase==='correcting';
  cancelWalkingSession(reason);
  let stopError=null;
  try{await channelCommand('walk_halt');}catch(e){stopError=e;}
  if(correcting)try{await channelCommand('turn_halt');}catch(e){stopError=stopError||e;}
  await s.done;
  if(stopError)throw stopError;
  return walkingStreamStatus();
}
