"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app", "src", "main", "assets", "head-controller.js"), "utf8");
const start = source.indexOf("function headSemanticPosition(");
const end = source.indexOf("async function headFaceAttentionTick(", start);
assert(start >= 0 && end > start, "head attention math must be present");
const box = {};
vm.createContext(box);
vm.runInContext(source.slice(start, end), box);

function state(pan, tilt, invertPan = true, invertTilt = false) {
  return {config: {
    pan: {minimum: 1200, center: 1500, maximum: 1800, invert: invertPan},
    tilt: {minimum: 1300, center: 1500, maximum: 1700, invert: invertTilt},
  }, commanded: {pan, tilt}};
}

assert.equal(Math.abs(box.headSemanticPosition("pan", state(1500, 1500))), 0);
assert.equal(box.headSemanticPosition("pan", state(1800, 1500)), -1);
assert.equal(box.headSemanticPosition("pan", state(1800, 1500, false)), 1);
assert.equal(box.headSemanticPosition("tilt", state(1500, 1300)), -1);
assert.equal(box.headSemanticPosition("pan", {}), null);

// A face left in the mirrored selfie view calls for semantic leftward pan.
const left = box.headFaceTarget(state(1500, 1500), {x: 0.6, y: 0});
assert(left.pan < 0 && left.tilt === 0);
const rightUp = box.headFaceTarget(state(1500, 1500), {x: -0.6, y: -0.5});
assert(rightUp.pan > 0 && rightUp.tilt > 0);
assert.equal(box.headFaceTarget(state(1500, 1500), {x: 0.05, y: 0.05}), null);
const edge = box.headFaceTarget(state(1200, 1300), {x: 1, y: 1});
assert(edge.pan<1&&edge.pan>=1-60/300,'a wide intentional look approaches by at most the damped PWM lead');
assert.equal(edge.tilt,-1,'an outward face error cannot push beyond the attention envelope');
const near=box.headFaceTarget(state(1500,1500),{x:.14,y:0});
assert(Math.abs(near.pan*300)<10,'near-center lead tapers to less than ten microseconds');
const inFlight=state(1500,1500);
inFlight.targets={pan:1400,tilt:1600};inFlight.moving=true;
const brake=box.headFaceTarget(inFlight,{x:.05,y:.05});
assert.equal(Math.abs(brake.pan),0,'a centered face cancels outstanding pan lead');
assert.equal(Math.abs(brake.tilt),0,'a centered face cancels outstanding tilt lead');
inFlight.targets={pan:1500,tilt:1500};inFlight.moving=false;
assert.equal(box.headFaceTarget(inFlight,{x:.05,y:.05}),null,'a settled head must not receive repetitive hold targets');
const reverse=box.headFaceTarget(state(1500,1500),{x:-.14,y:0});
assert(reverse.pan>0&&reverse.pan*300<10,'a small sign reversal stays damped');

async function dispatchTests(){
  const sent=[],toggle={checked:true};
  const live={HEAD:{faceBusy:false,faceLastSeenAt:0,faceSuppressedUntil:0,explicitMoves:0,
      generation:1,faceCommands:0,state:state(1800,1700)},
    APP:{resting:false,settings:false},document:{hidden:false},thermalModerate:()=>false,
    MIND:{gazeArmed:true},S:{cameraFacing:'front',camOK:true,sim:false,running:false},
    NW:{running:false,checkingPath:false},walkingStreamStatus:()=>({active:false}),
    headReady:()=>true,separateHead:()=>false,$:id=>id==='#headAutoFace'?toggle:{checked:false},now:()=>100000,
    SEEN:{method:'native-face',found:true,conf:1,lastSeen:99900,x:.6,y:-.5},
    headRequest:async(t,args)=>{sent.push({t,args});return {state:state(1500,1500)};}};
  vm.createContext(live);
  vm.runInContext(source.slice(source.indexOf('function headFaceTrackingRequested('),
    source.indexOf('async function headAcknowledgedCommand(')),live);
  await live.headFaceAttentionTick();
  assert.deepEqual(sent.map(x=>x.t),['info','move'],'a fresh performance-clock face must dispatch a head target');
  assert(sent[1].args.pan<0,'target must use fresh commanded center, not stale cached PWM');
  assert.equal(live.HEAD.faceCommands,1);
  await live.headFaceAttentionTick();
  assert.equal(sent.length,2,'the same camera sample must not queue another correction');
  live.SEEN.lastSeen=97000;
  await live.headFaceAttentionTick();
  assert.equal(sent.length,2,'stale faces must not move the head');
  live.SEEN.lastSeen=99950;
  for(const [obj,key] of [[live.NW,'running'],[live.NW,'checkingPath'],[live.HEAD,'explicitMoves'],[live.APP,'resting']]){
    obj[key]=true;await live.headFaceAttentionTick();obj[key]=false;
    assert.equal(sent.length,2,'walking, alignment, explicit looks and sleep take priority');
  }
  toggle.checked=false;await live.headFaceAttentionTick();assert.equal(sent.length,2);
  toggle.checked=true;
  live.headRequest=async t=>{sent.push({t});live.HEAD.generation++;return {state:state(1500,1500)};};
  await live.headFaceAttentionTick();
  assert.equal(sent.length,3,'a newer head command during the status request cancels this correction');
  assert.equal(live.HEAD.faceBusy,false);
  live.HEAD.faceSuppressedUntil=0;
  const beforeHold=sent.length;
  assert.equal(live.headSetAttention('hold').ok,true);
  await live.headFaceAttentionTick();assert.equal(sent.length,beforeHold,'attention hold sends no motion or release');
  assert.equal(live.headFaceTrackingReady(),false,'hold outlasts the old dwell timer');
  assert.equal(live.headSetAttention('face').ok,true);
  assert.equal(live.headFaceTrackingReady(),true,'Andrew can explicitly return to face attention');
  live.APP.resting=true;
  assert.equal(live.headSetAttention('face').ok,false,'attention selection cannot bypass sleep');
  live.APP.resting=false;
  assert.equal(live.headSetAttention('invalid').ok,false);
  const centered=state(1500,1500);Object.assign(centered,{holding:true,moving:false,run_id:1,targets:{pan:1500,tilt:1500}});
  live.headRequest=async()=>({state:centered});
  vm.runInContext(source.slice(source.indexOf('async function headMove('),source.indexOf('function headFaceTrackingRequested(')),live);
  const result=await live.headMove({pan:0,tilt:0},false);
  assert.match(result,/completed/);
  live.HEAD.faceSuppressedUntil=0;
  assert.equal(live.HEAD.attentionMode,'hold','an intentional look takes lasting attention ownership');
  assert.equal(live.headFaceTrackingReady(),false,'face loop cannot reclaim a deliberate look when dwell expires');
  live.headSetAttention('face');
  await live.headMove({pan:0,tilt:0},true,true);
  assert.equal(live.HEAD.attentionMode,'face','walking alignment does not overwrite the chosen attention mode');
  console.log('Andrew head-attention math, dispatch, clock, priority and cancellation tests passed');
}
function sampleTests(){
  let time=10000,found=true,ready=true,calls=0,marks=0;
  const canvas={getContext:()=>({drawImage:()=>{}}),toDataURL:()=>'<temporary-frame>'};
  const sample={HEAD:{},headFaceTrackingReady:()=>ready,now:()=>time,
    document:{createElement:()=>canvas},$:()=>({readyState:4,videoWidth:640,videoHeight:480}),
    NATIVE:{detectFace:()=>{calls++;return JSON.stringify({found,x:.2,y:.2,width:.3,height:.3,confidence:1});}},
    markSeen:()=>{marks++;}};
  vm.createContext(sample);vm.runInContext(source.slice(source.indexOf('function headFaceSamplingActive('),
    source.indexOf('function headSemanticPosition(')),sample);
  assert.equal(sample.headSampleFace(),true);assert.equal(calls,1);assert.equal(marks,1);
  assert.equal(sample.headSampleFace(),false);assert.equal(calls,1,'sampling is bounded');
  time+=250;found=false;assert.equal(sample.headSampleFace(),false);assert.equal(marks,1,'missed frames cannot replay old face error');
  ready=false;time+=250;sample.headSampleFace();assert.equal(calls,2,'paused head attention does not consume camera inference');
}
sampleTests();dispatchTests().catch(error=>{console.error(error);process.exitCode=1;});
