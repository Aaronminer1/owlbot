/* Local evidence interpretation: no model calls, motor commands, timers or storage.
   Sensor readings inform attention; none of these heuristics authorize or veto gait.
   Keep missing values unknown and never turn phone motion into measured travel. */
(function(root){
  'use strict';
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const vector=v=>Array.isArray(v)&&v.length===3&&v.every(finite);
  const norm=v=>vector(v)?Math.hypot(...v):null;
  function reading(n,key,now=Date.now()){
    const value=n?.motion?.[key]??n?.environment?.[key];
    const meta=n?.samples?.[key];
    const age=finite(meta?.sampleAt)&&meta.sampleAt>0?now-meta.sampleAt:null;
    // On-change sensors report again only when their value changes. An old reading
    // is still current while this subscription is active, but never across Sleep.
    const held=meta?.onChange===true;
    const valid=n?.sensorMode!=='paused'&&meta?.active===true&&age!==null&&age>=0&&
      (held||age<=(key==='pressureHpa'?10000:1500))&&(finite(value)||vector(value));
    return {value:valid?value:null,valid,ageMs:age,held:valid&&held,accuracy:meta?.accuracy??null};
  }
  function interpret(n={},ctx={},now=Date.now()){
    const get=k=>reading(n,k,now), gyro=get('gyroscopeRadS'), linear=get('linearAccelerationMps2');
    const accel=get('accelerationMps2'),gravity=get('gravityMps2'),light=get('lightLux'),near=get('proximityCm');
    const paused=!!ctx.resting||n.sensorMode==='paused';
    if(paused)return {mode:'paused',motion:'unknown',sceneMotion:'unavailable',notes:['Sensing paused; cached readings are not current evidence.']};
    const spin=norm(gyro.value), acceleration=norm(linear.value);
    const head=!!ctx.headMoving, body=!!ctx.bodyCommanded;
    const selfMotion=head||body||(spin!==null&&spin>.12)||(acceleration!==null&&acceleration>.3);
    const flow=ctx.cameraLive&&finite(ctx.flow?.sampleAt)&&now-ctx.flow.sampleAt>=0&&
      now-ctx.flow.sampleAt<1500&&ctx.flow.conf>.25;
    const flowEnergy=flow?Math.abs(ctx.flow.yaw||0)+Math.abs(ctx.flow.tilt||0)+Math.abs(ctx.flow.fwd||0)*.5:null;
    const motion=head?'head movement commanded':body?'body movement commanded':
      selfMotion?'phone motion detected; handling is possible':gyro.valid&&linear.valid?'low inertial activity; not proof of being stationary':'unknown';
    const sceneMotion=!flow?'unavailable':selfMotion?'self-motion may explain image change':
      !gyro.valid||!linear.valid?'image change; self-motion unknown':flowEnergy>.8?'scene change candidate; verify in images':'little image change';
    const notes=[];
    if(body)notes.push('Gait commands are not measured travel; compare fresh landmarks for progress or slipping.');
    if(head||spin>.12)notes.push('Camera rotation is not a moving obstacle or forward travel.');
    if(!gyro.valid||!linear.valid)notes.push('Some motion evidence is missing or stale.');
    const nearLimit=Math.min(4.5,finite(n.samples?.proximityCm?.maximumRange)?n.samples.proximityCm.maximumRange:4.5);
    const covered=near.valid&&near.value<nearLimit;
    if(covered)notes.push('Something is near the phone proximity sensor; this is not distance to an obstacle along the route.');
    if(light.valid&&light.value<12)notes.push(covered?'Phone sensor area may be covered or shaded; check the actual camera image.':'Low ambient light; camera details may be uncertain.');
    const magnetic=get('magneticFieldUt'),orientation=get('orientationDegAzimuthPitchRoll');
    const heading=orientation.valid&&orientation.accuracy>=2&&magnetic.valid&&magnetic.accuracy>=2?'available, not calibrated to body forward':'unreliable or unavailable';
    if(heading.startsWith('unreliable'))notes.push('Do not steer from an unverified compass heading.');
    let gravityAxisRotationRadS=null;
    if(gyro.valid&&gravity.valid&&norm(gravity.value)>1)
      gravityAxisRotationRadS=gyro.value.reduce((sum,v,i)=>sum+v*gravity.value[i],0)/norm(gravity.value);
    const position=n.position||{};
    return {mode:n.sensorMode||'unknown',motion,sceneMotion,
      rotationRadS:spin,linearAccelerationMps2:acceleration,gravityAxisRotationRadS,
      accelerationFresh:accel.valid,heading,
      lightLux:light.value,proximityNear:near.valid?covered:null,
      pressureHpa:get('pressureHpa').value,ambientTemperatureC:get('ambientTemperatureC').value,
      stepCount:get('stepsSinceBoot').value,
      positionAccuracyM:finite(position.accuracyM)?position.accuracyM:null,
      positionAgeMs:finite(position.time)?Math.max(0,now-position.time):null,
      notes:[...notes,'Phone steps are not robot gait cycles; battery temperature is not room temperature. GPS is not indoor odometry.']};
  }
  function summary(s){
    if(s.mode==='paused')return s.notes[0];
    return ['Motion: '+s.motion+'. Image change: '+s.sceneMotion+'.',
      s.lightLux!==null?'Ambient light '+Math.round(s.lightLux)+' lux.':'Ambient light unknown.',
      ...s.notes].join(' ').slice(0,1000);
  }
  const api={reading,interpret,summary};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.OwlSensors=api;
})(typeof globalThis!=='undefined'?globalThis:this);

// Runtime adapter reads current state only. It never wakes a sensor or an agent.
function sensorAwarenessSnapshot(){
  const head=typeof HEAD!=='undefined'&&HEAD.state?.moving&&Date.now()-HEAD.lastSeen<2500;
  const body=!!S.running||(typeof NW!=='undefined'&&!!NW.running)||
    (typeof walkingStreamStatus==='function'&&!!walkingStreamStatus().active);
  return OwlSensors.interpret(S.native||{},{resting:APP.resting,bodyCommanded:body,
    headMoving:head,cameraLive:S.camOK,flow:S.flow});
}
function sensorAwarenessContext(){return OwlSensors.summary(sensorAwarenessSnapshot());}
