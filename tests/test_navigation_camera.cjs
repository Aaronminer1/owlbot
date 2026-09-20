const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.join(__dirname,'../app/src/main/assets');
const html=fs.readFileSync(path.join(root,'growbot-brain.html'),'utf8'),walk=fs.readFileSync(path.join(root,'named-walk.js'),'utf8');
const part=(a,z)=>html.slice(html.indexOf(a),html.indexOf(z,html.indexOf(a)));
const tick=()=>new Promise(setImmediate);
function fixture(){
 const pending=[],opened=[],streams=[],fields={},mount={value:'front'};
 const video={srcObject:null,play:async()=>{}};
 const b={Promise,Date,Error,APP:{resting:false},S:{camOK:false,cameraFacing:'front'},IDENT:{generation:0},WALK_STREAM:{session:null},MIND:{},
  $:s=>s==='#vid'?video:s==='#walkForwardCamera'?mount:fields[s]||(fields[s]={clientWidth:50,classList:{toggle(){}},getContext:()=>({})}),
  document:{createElement:()=>({getContext:()=>({})})},navigator:{mediaDevices:{getUserMedia:constraints=>new Promise(resolve=>{
   const facing=constraints.video.facingMode.exact;opened.push(facing);
   const track={stopped:false,stop(){this.stopped=true;},getSettings:()=>({facingMode:facing})};
   const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};streams.push(stream);pending.push(()=>resolve(stream));
  })}},readNativeSensors(){},readLocalVisionStatus(){},thermalModerate:()=>false,identityEnrollmentActive:()=>false,clearFaceVerification(){},schedulePrimaryCameraReturn(){},
  pill(){},log(){},requestAnimationFrame(){},flowLoop(){},FW:48,FH:36,lastRGBA:null};
 vm.createContext(b);
 vm.runInContext(walk.slice(0,walk.indexOf('const NW_ROLES')),b);
 vm.runInContext('let workCanvas,workCtx,flowCanvas,flowCtx,prevGray;'+part('let cameraPromise =','function disableCamera('),b);
 return {b,mount,video,opened,streams,resolve:()=>{assert(pending.length);pending.shift()();},setNW:(running,direction)=>vm.runInContext(`Object.assign(NW,{running:${running},direction:${JSON.stringify(direction)},cameraFacing:null})`,b)};
}
(async()=>{
 const f=fixture(),b=f.b;
 b.WALK_STREAM.session={active:true,phase:'starting',direction:'forward'};
 assert.equal(b.navigationCameraFacing(),'front');
 for(const phase of ['walking','waiting_for_path','waiting_for_vision','correcting','looking_for_route']){
  b.WALK_STREAM.session.phase=phase;assert.equal(await b.enableCamera('back'),false,phase);
 }
 assert.deepEqual(f.opened,[],'opposite request must not stop/reopen the current camera');
 const front=b.enableCamera('front');f.resolve();assert.equal(await front,true);
 assert.equal(b.S.cameraFacing,'front');assert.equal(f.streams[0].getTracks()[0].stopped,false);
 f.mount.value='back';assert.equal(b.navigationCameraFacing(),'front','mounting frozen for this session');
 b.WALK_STREAM.session.active=false;assert.equal(await b.enableCamera('back'),false,'Stop retains ownership through halt');
 b.WALK_STREAM.session.phase='stopped';assert.equal(b.navigationCameraFacing(),null);
 const rear=b.enableCamera('back');f.resolve();assert.equal(await rear,true,'rear inspection allowed after Stop');
 f.mount.value='front';b.WALK_STREAM.session={active:true,phase:'walking',direction:'backward'};
 assert.equal(b.navigationCameraFacing(),'back');assert.equal(await b.enableCamera('front'),false,'face/ambient requests cannot steal reverse view');
 b.WALK_STREAM.session={active:true,phase:'walking',direction:'forward'};f.mount.value='back';
 assert.equal(b.navigationCameraFacing(),'back','other physical mountings remain supported');
 b.WALK_STREAM.session=null;f.mount.value='front';f.setNW(true,'backward');assert.equal(b.navigationCameraFacing(),'back','bounded gait also owns view');
 f.setNW(false,null);assert.equal(b.navigationCameraFacing(),null);

 // Rear permission/activation was pending before forward walking began.
 const r=fixture(),oldRear=r.b.enableCamera('back');
 r.b.WALK_STREAM.session={active:true,phase:'starting',direction:'forward'};
 const newFront=r.b.enableCamera('front');r.resolve();assert.equal(await oldRear,false);await tick();
 assert(r.streams[0].getTracks()[0].stopped,'late rear stream disposed');
 r.resolve();assert.equal(await newFront,true);assert.equal(r.b.S.cameraFacing,'front');

 // Multiple waiters serialize, and a queued rear look rechecks ownership.
 const q=fixture(),first=q.b.enableCamera('front'),queued=q.b.enableCamera('back'),same=q.b.enableCamera('front');
 q.b.WALK_STREAM.session={active:true,phase:'starting',direction:'forward'};
 q.resolve();assert.equal(await first,true);assert.equal(await queued,false);assert.equal(await same,true);
 assert.deepEqual(q.opened,['user']);

 // The model gets a truthful refusal, not a successful rear-camera claim.
 vm.runInContext('async function cameraTool(name,args){'+part('    if(name==="use_camera"){','    if(name==="look_at"){')+'}',q.b);
 const reply=await q.b.cameraTool('use_camera',{facing:'back'});assert.match(reply,/^Not executed:/);assert.match(reply,/no camera switch/);
 assert.equal(q.b.MIND.oneShotVision,undefined);

 // Late model answers cannot attach rear pixels to a front-facing report.
 let finish;
 const v={Date,JSON,String,Number,Math,cameraGeneration:1,identityEnrollmentActive:()=>false,S:{cameraFacing:'back'},MIND:{},LOCAL_VISION:{status:{}},
  cachedVisionReport:()=>'',localVisionRoute:()=> 'local',localVisionReady:()=>true,
  localVisionInfer:()=>new Promise(resolve=>finish=()=>resolve({text:'Rear wall',backend:'test',latencyMs:1})),log(){},visualAttentionFromReport(){}};
 vm.createContext(v);vm.runInContext(part('function freshInvestigationPrompt(','function perceptionTerms('),v);
 const report=v.describeFrameForBrain('','','rear-image',null);v.S.cameraFacing='front';v.cameraGeneration++;finish();
 await assert.rejects(report,/Camera changed/);assert.equal(v.MIND.visionReport,undefined);
 vm.runInContext(part('function cachedVisionReport(','function visualAttentionFromReport('),v);
 v.MIND={visionReport:'old rear view',visionReportFacing:'back',visionReportAt:Date.now()};assert.equal(v.cachedVisionReport(),'');
 console.log('PASS: forward/reverse camera ownership, pauses/turns/halt, mounting freeze, pending-switch races, truthful tool refusal and stale report rejection.');
})().catch(e=>{console.error(e);process.exitCode=1;});
