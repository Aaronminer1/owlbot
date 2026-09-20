const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/growbot-brain.html'),'utf8');
const calls=[],saved=new Map(),fields={vInputMode:{value:'push'},vSttUrl:{value:''},vSttModel:{value:''}};
let canceledWalks=0;
const box={EARS:{paused:true},APP:{resting:false,settings:false},THERMAL:{paused:false},VOICE:{holdMic:false,busy:false,queue:[]},HANDS_FREE_WANTED_KEY:'wanted',
  NATIVE:{setHandsFree:(...args)=>calls.push(args)},localStorage:{setItem:(k,v)=>saved.set(k,v)},$:s=>fields[s.slice(1)],prefsSave:()=>{},micBadge:()=>{},refreshHandsFreeUI:()=>{},caption:()=>{},thermalSerious:()=>false};
box.cancelWalkingSession=()=>canceledWalks++;
box.earsPause=p=>box.EARS.paused=p;vm.createContext(box);
vm.runInContext(html.slice(html.indexOf('function setHandsFreeConversation('),html.indexOf('function earsStart(')),box);
assert.equal(box.setHandsFreeConversation(true),true);assert.equal(box.EARS.paused,false);assert.equal(fields.vInputMode.value,'handsfree');assert.equal(saved.get('wanted'),'1');
box.setHandsFreeConversation(false);assert.equal(fields.vInputMode.value,'push');assert.equal(saved.get('wanted'),'0');
assert.equal(canceledWalks,0,'switching to push-to-talk must not cancel walking');
box.APP.resting=true;box.EARS.paused=true;let before=calls.length;
assert.equal(box.setHandsFreeConversation(true),false);assert.equal(calls.length,before,'sleep must not open recording');
assert.equal(fields.vInputMode.value,'handsfree','intent is saved for wake');
box.APP.resting=false;assert.equal(box.setHandsFreeConversation(true,{persist:false}),true);
box.EARS.paused=true;box.VOICE.holdMic=true;before=calls.length;
assert.equal(box.setHandsFreeConversation(true),false);assert.equal(calls.length,before,'speech hold remains authoritative');
box.VOICE.holdMic=false;box.THERMAL.paused=true;
assert.equal(box.setHandsFreeConversation(true),false);assert.equal(calls.length,before,'cooling remains authoritative');
const motorEvents=[],motorBox={MIND:{motionArmed:true},S:{running:false,learn:false},moveKnob(){},stopServoTest(){},refreshMotionButton(){},prefsSave(){},
 cancelWalkingSession:()=>motorEvents.push('cancel'),wsSend:m=>motorEvents.push(m.t)};
vm.createContext(motorBox);
vm.runInContext(html.slice(html.indexOf('const MOTOR_CONTROL='),html.indexOf('function ensureMotorControlForAction(')),motorBox);
assert.equal(motorBox.setMotorControlState(false).ok,true);
assert.deepEqual(motorEvents,['cancel','stop','release','gaze_release'],'actual motor-off cancels before releasing outputs');
motorEvents.length=0;motorBox.setMotorControlState(true);assert.deepEqual(motorEvents,[],'enabling permission alone must not move');
console.log('PASS: ears-open recovery, persisted mic mode, rest/speech/cooling gates, mic-mode isolation and immediate motor-off cancellation.');
