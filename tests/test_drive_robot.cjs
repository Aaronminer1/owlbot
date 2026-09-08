const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),file=path.join(root,'app/src/main/assets/drive-robot.js'),source=fs.readFileSync(file,'utf8');
assert.equal(source,fs.readFileSync(path.join(root,'app/src/main/assets/drive-robot.js'),'utf8'));
new vm.Script(source);
const calls=[],fields={turnAPhysical:{value:''},driveRepeat:{checked:false},driveTurnChannel:{value:'7'},driveRobotStatus:{textContent:''},driveStickKnob:{style:{}}};
const rows=[{channel:7,name:'Turn',enabled:true,calibrated:true,a_name:'Closed',a_us:1515,b_name:'Open',b_us:1019,center_us:1267}];
let commanded={},stopAfterMove=false,walkHook=null,timerHook=null,ready=true;
const box={NW:{running:false},APP:{settings:true,resting:true},CHANNEL_SETUP:{generation:1,live:false,busy:false,drafts:{},saved:rows},S:{sim:false},
  bodyControllerReady:()=>ready,isDog6:()=>true,$:s=>fields[s.slice(1)],setTimeout:f=>{if(timerHook)timerHook();f();},
  runNamedForwardWalk:async options=>{calls.push(['walk',options]);if(walkHook)await walkHook();return 'controller cycle completed';},
  stopChannelAdjustment:async(options={})=>{if(!options.preserveJoystick)box.cancelDriveJoystick();box.cancelDriveRobot();box.CHANNEL_SETUP.generation++;calls.push(['stop']);},
  channelCommand:async(action,args)=>{
    calls.push([action,args]);
    if(action==='info')return {channel_state:{channels:rows,active:null,queued:0,commanded},named_turn:{turn_protocol:2,available:true,run_id:1,running:false,completed_cycles:1,completed_steps:15,total_steps:15},named_walk:{running:false,max_speed_us_s:800},walk_plan:{speed_us_s:800}};
    if(action==='turn_run'){commanded={'7':1515};if(stopAfterMove)box.CHANNEL_SETUP.generation++;return {named_turn:{run_id:1}};}
    if(action==='move'){commanded={[args.targets[0].channel]:args.targets[0].pulse_us};if(stopAfterMove)box.CHANNEL_SETUP.generation++;return {accepted:1};}
  }};
vm.createContext(box);vm.runInContext(source.slice(0,source.indexOf('for(const [id,direction]')),box);vm.runInContext('renderDriveRobot=()=>{}',box);
(async()=>{
  for(const direction of ['forward','backward']){
    calls.length=0;await box.driveRobotAction(direction);
    assert.equal(calls.length,1);assert.equal(calls[0][0],'walk');assert.equal(calls[0][1].direction,direction);assert.equal(calls[0][1].manual,true);
  }
  fields.driveRepeat.checked=true;
  for(const direction of ['forward','backward']){
    calls.length=0;
    walkHook=async()=>{await box.stopChannelAdjustment();};
    await box.driveRobotAction(direction);
    assert.equal(calls.filter(([a])=>a==='walk').length,1,'Pico owns all repeats in one run');
    assert(calls.filter(([a])=>a==='walk').every(([,o])=>o.direction===direction&&o.manual&&o.continuous));
    assert.match(fields.driveRobotStatus.textContent,/Stop requested/,'late completion preserves Stop status');
  }
  // A pending response after Stop cannot restart walking; duplicate taps cannot queue runs.
  calls.length=0;let finish;
  walkHook=()=>new Promise(r=>{finish=r;});
  const pending=box.driveRobotAction('forward');
  await box.driveRobotAction('backward');assert.equal(calls.length,1);
  await box.stopChannelAdjustment();finish();await pending;
  assert.equal(calls.filter(([a])=>a==='walk').length,1);
  walkHook=null;
  // Stop in the between-cycle yield, navigation cancellation, and connection generation change.
  for(const stop of [()=>box.stopChannelAdjustment(),()=>box.stopDriveRobotIfActive(),()=>{box.CHANNEL_SETUP.generation++;},()=>{ready=false;}]){
    calls.length=0;walkHook=stop;await box.driveRobotAction('forward');
    assert.equal(calls.filter(([a])=>a==='walk').length,1);ready=true;
  }
  timerHook=null;walkHook=null;
  // Controller errors end repetition, never retry automatically.
  calls.length=0;walkHook=()=>{throw Error('controller error');};
  await box.driveRobotAction('forward');assert.equal(calls.filter(([a])=>a==='walk').length,1);
  assert.match(fields.driveRobotStatus.textContent,/controller error/);walkHook=null;
  fields.driveRepeat.checked=false;
  calls.length=0;await box.driveRobotAction('left');
  assert.equal(calls.find(([a])=>a==='turn_run')[1].turn_channel,7);
  assert(!calls.some(([a])=>a==='move'),'turn is one controller-owned cycle, not individual phone servo commands');
  assert.match(fields.driveRobotStatus.textContent,/plates commanded Closed/);
  calls.length=0;await box.driveRobotAction('right');assert.equal(calls.find(([a])=>a==='turn_run')[1].pattern,'b');
  fields.turnAPhysical.value='right';calls.length=0;await box.driveRobotAction('left');assert.equal(calls.find(([a])=>a==='turn_run')[1].pattern,'b');
  fields.turnAPhysical.value='';
  fields.driveTurnChannel.value='5';calls.length=0;await box.driveRobotAction('left');
  assert(!calls.some(([a])=>a==='turn_run'),'no fallback to old fixed-role leg channel');
  fields.driveTurnChannel.value='7';stopAfterMove=true;calls.length=0;await box.driveRobotAction('left');
  assert.match(fields.driveRobotStatus.textContent,/interrupted/);assert(calls.some(([a])=>a==='stop'));
  stopAfterMove=false;box.CHANNEL_SETUP.live=true;calls.length=0;await box.driveRobotAction('forward');assert.equal(calls.length,0);
  assert.match(source,/btnDriveStop'[\s\S]{0,100}stopChannelAdjustment/);
  assert.doesNotMatch(source,/runTool\(|mindFetch\(|dog_cycle|sendDogDrive\(/);
  const html=fs.readFileSync(path.join(root,'app/src/main/assets/growbot-brain.html'),'utf8');
  assert.match(html,/\$\("#btnStop"\)\.onclick = \(\)=>\{\s*stopChannelAdjustment\(\)/);
  for(const name of ['selectSettingsTab','filterSettings','leaveControls'])assert.match(html,new RegExp('function '+name+'\\([^]*?stopDriveRobotIfActive'));
  assert.match(html,/function invalidateControllerChannels\(\)\{\s*if\(typeof cancelDriveRobot/);
  assert.match(source,/\$\('#driveRepeat'\)\.checked=false/);
  assert.equal(box.joystickDirection(0,0),null);
  for(const [x,y,d]of [[0,-1,'forward'],[0,1,'backward'],[-1,0,null],[1,0,null]])assert.equal(box.joystickDirection(x,y),d);
  box.CHANNEL_SETUP.live=false;stopAfterMove=false;calls.length=0;
  fields.driveStick={getBoundingClientRect:()=>({left:0,top:0,width:180,height:180}),setPointerCapture:()=>{}};
  box.bindDriveJoystick();
  walkHook=()=>new Promise(r=>{finish=r;});
  fields.driveStick.onpointerdown({pointerId:4,clientX:90,clientY:0,preventDefault(){}});
  assert.equal(calls[0][1].direction,'forward');assert.equal(calls[0][1].continuous,true);
  fields.driveStick.onpointermove({pointerId:4,clientX:180,clientY:90});
  assert(calls.some(([a])=>a==='stop'),'changing joystick direction stops the old movement');
  const worker=vm.runInContext('DRIVE_JOYSTICK.worker',box);finish();await worker;
  assert(!calls.some(([a])=>a==='turn_run'),'unverified turn direction is not assigned to horizontal joystick');
  fields.driveStick.onpointercancel({pointerId:4});
  assert.equal(vm.runInContext('DRIVE_JOYSTICK.pointer',box),null);
  assert.equal(calls.at(-1)[0],'stop');walkHook=null;
  // Fractional requests must never degrade into full turns on old firmware.
  calls.length=0;fields.turnAPhysical.value='right';
  await assert.rejects(box.runDriveTurn('right',{fraction:.08}),/Update the Pico/);
  assert(!calls.some(([a])=>a==='turn_run'));
  const originalCommand=box.channelCommand;
  for(const echo of [.08,1]){
    calls.length=0;
    box.channelCommand=async(action,args)=>{
      const reply=await originalCommand(action,args);
      if(action==='info')reply.named_turn.partial_turn=true;
      if(action==='turn_run')reply.named_turn.turn_fraction=echo;
      return reply;
    };
    if(echo===.08){await box.runDriveTurn('right',{fraction:.08});assert.equal(calls.find(([a])=>a==='turn_run')[1].fraction,.08);}
    else{await assert.rejects(box.runDriveTurn('right',{fraction:.08}),/did not confirm/);assert(calls.some(([a])=>a==='turn_halt'));}
  }
  box.channelCommand=originalCommand;
  console.log('PASS: Single/repeating forward and backward, sequential cycles, late-response Stop, duplicate taps, navigation, link loss, errors, semantic turn endpoints, and no model/legacy gait.');
})().catch(e=>{console.error(e);process.exitCode=1;});
