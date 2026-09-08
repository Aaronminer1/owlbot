/* A walking session owns locomotion; cycles remain an internal gait detail. */
const WALK_STREAM={session:null,sequence:0};
function walkingStreamStatus(){
  const s=WALK_STREAM.session;
  return s?{id:s.id,active:s.active,target:s.target,direction:s.direction,startedAt:s.startedAt,
    completedCycles:s.completedCycles||0,outcome:s.outcome||'starting',phase:s.phase||'starting',corrections:s.corrections||0,correctionFraction:s.correctionFraction||0,corridor:s.corridor||'',physicalArrivalVerified:false}:
    {active:false,physicalArrivalVerified:false};
}
function startWalkingStream(args={}){
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
  const s={id:++WALK_STREAM.sequence,active:true,target,direction,corridor,startedAt:Date.now(),completedCycles:0,corrections:0,phase:'starting'};
  WALK_STREAM.session=s;
  const guard=()=>{
    if(!s.active||WALK_STREAM.session!==s||Date.now()-s.startedAt>seconds*1000)throw Error(s.stopReason||'Walking reassessment interval reached.');
    if(APP.resting||APP.settings||!bodyControllerReady()||(generation!==null&&CHANNEL_SETUP.generation!==generation)||(typeof motorControlAvailable==='function'&&!motorControlAvailable()))throw Error('Walking interrupted by rest, motor authority or connection change.');
  };
  s.done=(async()=>{
    let completed=0,correctionsWithoutAdvance=0,lastCorrection='',sameHeadingCorrections=0;
    while(s.active){
      guard();s.phase='walking';
      try{
        s.outcome=await runNamedForwardWalk({continuous:true,direction,pace:args.pace,target,corridor,courseCorrection,
          sessionGuard:guard,onProgress:state=>{s.completedCycles=completed+(state.completed_cycles||0);s.outcome='walking';}});
        break;
      }catch(error){
        guard();
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
  })().catch(error=>{s.outcome=s.stopReason||String(error.message||error);})
    .finally(()=>{
      s.active=false;s.phase='stopped';s.endedAt=Date.now();
      if(!APP.resting&&!APP.settings&&MIND.on){
        MIND.pendingAgentEvent='WALKING OUTCOME: '+JSON.stringify(walkingStreamStatus())+
          '. Arrival is unverified. A nearby target requires a fresh stationary check. A blocked direction invites another inspected route. A person\'s Stop, lost supervision, or expired reassessment interval does not authorize an automatic restart.';
        queueMicrotask(mindTick);
      }
    });
  return {...walkingStreamStatus(),accepted:true,note:'Starting a camera-supervised walking session, not confirmation of movement or arrival.'};
}
async function stopWalkingStream(reason='Stopped for course correction.'){
  const s=WALK_STREAM.session;
  if(!s?.active)return walkingStreamStatus();
  s.stopReason=String(reason).slice(0,180);s.active=false;
  // Cancel in-flight camera work too, including a stop before walk_run was sent.
  NW.abort?.abort();
  s.correctionAbort?.abort();
  try{await channelCommand('walk_halt');if(s.phase==='correcting')await channelCommand('turn_halt');}finally{await s.done;}
  return walkingStreamStatus();
}
