/* Direct human controls; no model requests and no legacy fixed-role gait. */
const DRIVE_ROBOT={busy:false,generation:0,channelSignature:''};
function cancelDriveRobot(){
  DRIVE_ROBOT.generation++;
  if(DRIVE_ROBOT.busy)$('#driveRobotStatus').textContent='Stop requested; check that motion has stopped.';
}
function stopDriveRobotIfActive(){
  if(DRIVE_ROBOT.busy||DRIVE_JOYSTICK.pointer!==null)return stopChannelAdjustment();
}
function driveTurnChannels(rows){
  return rows.filter(c=>c.enabled&&c.calibrated&&
    [c.a_name,c.b_name].some(n=>String(n).toLowerCase()==='open')&&
    [c.a_name,c.b_name].some(n=>String(n).toLowerCase()==='closed'));
}
function driveTurnTarget(rows,channel,direction){
  if(!['left','right'].includes(direction)||channel==='')throw Error('Choose the calibrated Turn servo channel.');
  const c=driveTurnChannels(rows).find(c=>c.channel===Number(channel));
  if(!c)throw Error('This channel needs saved Open and Closed endpoints.');
  const pulse=String(c.a_name).toLowerCase()==='closed'?c.a_us:c.b_us;
  return {channel:c.channel,pulse_us:pulse};
}
function renderDriveRobot(){
  const supported=isDog6(),ready=bodyControllerReady()&&!S.sim;
  $('#driveRobotControls').hidden=!supported;$('#legacyDriveControls').hidden=supported;
  const busy=DRIVE_ROBOT.busy||NW.running||CHANNEL_SETUP.live||CHANNEL_SETUP.busy;
  $('#driveRepeat').disabled=busy;
  $('#driveConnection').className='connectionBanner '+(ready?'connected':'disconnected');
  $('#driveConnectionState').textContent=ready?'Connected to Pico':'Disconnected';
  $('#driveConnectionDetail').textContent=ready
    ? (NW.plan?NW.plan.speed_us_s+' µs/s · '+(NW.plan.lift_percent??50)+'% lift':'Manual control works while asleep.')
    : 'No responding controller — Connect or Reconnect here.';
  const socket=S.ws?.readyState;
  $('#btnDriveConnect').textContent=socket===1&&!ready?'Reconnect':'Connect';
  $('#btnDriveConnect').disabled=ready||socket===0;
  $('#btnDriveDisconnect').disabled=!Boolean(S.link||socket===0||socket===1);
  for(const id of ['btnDriveForward','btnDriveBackward'])$('#'+id).disabled=!ready||busy;
  const turn=driveTurnChannels(CHANNEL_SETUP.saved),signature=JSON.stringify(turn);
  if(signature!==DRIVE_ROBOT.channelSignature){
    DRIVE_ROBOT.channelSignature=signature;
    const select=$('#driveTurnChannel'),old=select.value;
    select.replaceChildren(new Option('Choose Turn servo channel',''));
    for(const c of turn)select.add(new Option('Ch '+c.channel+' · '+c.name,c.channel));
    const named=turn.filter(c=>/^(?:turn|body turn|rotation)$/i.test(c.name.trim()));
    select.value=turn.some(c=>String(c.channel)===old)?old:named.length===1?String(named[0].channel):'';
  }
  $('#driveTurnChannel').disabled=busy;
  for(const id of ['btnDriveLeft','btnDriveRight'])$('#'+id).disabled=!ready||busy||$('#driveTurnChannel').value==='';
  const mapped=['left','right'].includes($('#turnAPhysical').value);
  $('#btnDriveLeft').textContent=mapped?'Turn left':'Turn A';
  $('#btnDriveRight').textContent=mapped?'Turn right':'Turn B';
  $('#turnAPhysical').disabled=busy;
}
async function runDriveTurn(direction,options={}){
  if(!['left','right','a','b'].includes(direction))throw Error('Unknown turn direction');
  const fraction=options.fraction??1;
  if(typeof fraction!=='number'||!Number.isFinite(fraction)||fraction<.02||fraction>1)throw Error('Choose a turn fraction from 0.02 to 1.');
  const observed=$('#turnAPhysical').value;
  const pattern=['a','b'].includes(direction)?direction:observed?(direction===observed?'a':'b'):(direction==='left'?'a':'b');
  const generation=CHANNEL_SETUP.generation;
  const guard=()=>{if(options.sessionGuard)options.sessionGuard();if(generation!==CHANNEL_SETUP.generation||!bodyControllerReady())throw Error('Turn interrupted by Stop or connection change.');};
  guard();
  const info=await channelCommand('info');guard();
  if(info.named_turn?.running||info.named_walk?.running||info.channel_state?.active!=null||info.channel_state?.queued)throw Error('Stop the current movement first.');
  if(info.named_turn?.turn_protocol!==2)throw Error('Update the Pico for Open/Closed turning.');
  if(fraction!==1&&!info.named_turn.partial_turn)throw Error('Update the Pico for small course corrections; no full turn was substituted.');
  const target=driveTurnTarget(info.channel_state.channels,$('#driveTurnChannel').value,'left');
  if(CHANNEL_SETUP.drafts[target.channel])throw Error('Save or discard edits for this Turn channel first.');
  const c=info.channel_state.channels.find(c=>c.channel===target.channel);
  const binding=Object.fromEntries(['name','a_name','b_name','a_us','b_us','center_us'].map(k=>[k,c[k]]));
  const ack=await channelCommand('turn_run',{turn_channel:c.channel,binding,pattern,...(fraction!==1?{fraction}:{})});
  const runId=ack.named_turn?.run_id;
  if(!runId)throw Error('Pico did not confirm a Turn cycle.');
  if(fraction!==1&&ack.named_turn.turn_fraction!==fraction){await channelCommand('turn_halt');throw Error('Pico did not confirm the small turn amount.');}
  const deadline=Date.now()+110000;
  while(Date.now()<deadline){
    await new Promise(r=>setTimeout(r,250));guard();
    const reply=await channelCommand('info');guard();
    const state=reply.named_turn;
    if(!state||state.run_id!==runId||state.error)throw Error(state?.error||'Turn state changed');
    if(!state.running){
      if(state.completed_cycles!==1||state.completed_steps!==state.total_steps)throw Error('Turn cycle incomplete');
      if(reply.channel_state.commanded?.[String(c.channel)]!==target.pulse_us)throw Error('Turn did not return to Closed');
      return 'Pico completed Turn '+pattern.toUpperCase()+': all feet down and plates commanded Closed. Please verify physical movement.';
    }
    try{
      await channelCommand('turn_keepalive',{run_id:runId});
    }catch(e){
      // The cycle can finish between info and keepalive. Re-read its final
      // state on the next poll; never restart motion or assume completion.
      if(e.message!=='no_matching_turn')throw e;
    }
    guard();
  }
  throw Error('Turn servo timed out.');
}
async function driveRobotAction(direction,options={}){
  if(!['forward','backward','left','right'].includes(direction))return;
  if(DRIVE_ROBOT.busy||NW.running||CHANNEL_SETUP.live||CHANNEL_SETUP.busy){$('#driveRobotStatus').textContent='Stop the current movement or slow adjustment first.';return;}
  if(!isDog6()||!bodyControllerReady()||S.sim){$('#driveRobotStatus').textContent='Connect a responding Pico first.';return;}
  DRIVE_ROBOT.busy=true;
  const generation=++DRIVE_ROBOT.generation,channelGeneration=CHANNEL_SETUP.generation;
  const active=()=>generation===DRIVE_ROBOT.generation&&channelGeneration===CHANNEL_SETUP.generation&&bodyControllerReady();
  const repeat=options.repeat===true||$('#driveRepeat').checked;
  const turning=['left','right'].includes(direction);
  if(turning)CHANNEL_SETUP.busy=true;
  renderDriveRobot();
  $('#driveRobotStatus').textContent=turning?'Running coordinated turn cycle…':'Running '+direction+' · cycle 1'+(repeat?' · press Stop to finish':'');
  try{
    if(turning){
      const result=await runDriveTurn(direction);
      if(active())$('#driveRobotStatus').textContent=result;
    }else{
      const result=await runNamedForwardWalk({direction,manual:true,continuous:repeat});
      if(active())$('#driveRobotStatus').textContent=result;
      if(!active()&&generation===DRIVE_ROBOT.generation)$('#driveRobotStatus').textContent='Walk interrupted by Stop or connection change. Press Forward or Backward to start again.';
    }
  }catch(e){
    if(generation===DRIVE_ROBOT.generation){
      await stopChannelAdjustment();
      $('#driveRobotStatus').textContent=e.message;
    }
  }finally{if(turning)CHANNEL_SETUP.busy=false;DRIVE_ROBOT.busy=false;renderDriveRobot();}
}
const DRIVE_JOYSTICK={pointer:null,direction:null,worker:null};
function joystickDirection(x,y){
  if(Math.hypot(x,y)<0.24)return null;
  // Horizontal direction is not assigned until the taught turn is observed.
  return Math.abs(y)>=Math.abs(x)?(y<0?'forward':'backward'):(['left','right'].includes($('#turnAPhysical').value)?(x<0?'left':'right'):null);
}
function cancelDriveJoystick(){
  DRIVE_JOYSTICK.pointer=null;DRIVE_JOYSTICK.direction=null;
  $('#driveStickKnob').style.transform='translate(-50%,-50%)';
}
function setDriveJoystickDirection(direction){
  if(direction===DRIVE_JOYSTICK.direction)return;
  const previous=DRIVE_JOYSTICK.direction;
  DRIVE_JOYSTICK.direction=direction;
  if(DRIVE_ROBOT.busy||previous)stopChannelAdjustment({preserveJoystick:true});
  if(!direction||DRIVE_JOYSTICK.worker)return;
  DRIVE_JOYSTICK.worker=(async()=>{
    while(DRIVE_JOYSTICK.pointer!==null&&DRIVE_JOYSTICK.direction){
      const requested=DRIVE_JOYSTICK.direction;
      await driveRobotAction(requested,{repeat:true});
      if(requested===DRIVE_JOYSTICK.direction)break;
    }
  })().finally(()=>{DRIVE_JOYSTICK.worker=null;});
}
function driveJoystickPoint(ev){
  if(ev.pointerId!==DRIVE_JOYSTICK.pointer)return;
  const r=$('#driveStick').getBoundingClientRect(),radius=Math.min(r.width,r.height)/2;
  let x=(ev.clientX-r.left-r.width/2)/radius,y=(ev.clientY-r.top-r.height/2)/radius;
  const magnitude=Math.max(1,Math.hypot(x,y));x/=magnitude;y/=magnitude;
  $('#driveStickKnob').style.transform='translate(calc(-50% + '+(x*55)+'px),calc(-50% + '+(y*55)+'px))';
  setDriveJoystickDirection(joystickDirection(x,y));
}
function bindDriveJoystick(){
  const pad=$('#driveStick');
  pad.onpointerdown=ev=>{
    if(DRIVE_JOYSTICK.pointer!==null||DRIVE_ROBOT.busy||NW.running||CHANNEL_SETUP.live||CHANNEL_SETUP.busy||!bodyControllerReady()||S.sim)return;
    ev.preventDefault();DRIVE_JOYSTICK.pointer=ev.pointerId;pad.setPointerCapture(ev.pointerId);driveJoystickPoint(ev);
  };
  pad.onpointermove=driveJoystickPoint;
  pad.onpointerup=pad.onpointercancel=pad.onlostpointercapture=ev=>{
    if(ev.pointerId!==DRIVE_JOYSTICK.pointer)return;
    cancelDriveJoystick();stopChannelAdjustment();
  };
}
for(const [id,direction]of [['btnDriveForward','forward'],['btnDriveBackward','backward'],['btnDriveLeft','left'],['btnDriveRight','right']])$('#'+id).onclick=()=>driveRobotAction(direction);
$('#btnDriveStop').onclick=async()=>{await stopChannelAdjustment();$('#driveRobotStatus').textContent='Stop requested; check that motion has stopped.';renderDriveRobot();};
$('#btnDriveConnect').onclick=()=>connect({manual:true});
$('#btnDriveDisconnect').onclick=disconnectBody;
$('#btnDriveTeach').onclick=()=>openSettingsCard('teach','Record a walking sequence');
$('#driveTurnChannel').onchange=renderDriveRobot;
$('#turnAPhysical').onchange=()=>{renderDriveRobot();prefsSave();};
// Explicit opt-in each app session; changing mode never starts movement.
$('#driveRepeat').checked=false;
bindDriveJoystick();
renderDriveRobot();
