const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/face-identity.js'),'utf8');
const start=source.indexOf('async function detectFaceNative(');
const fn=source.slice(start,source.indexOf('setInterval(()=>{',start));
async function check(count,tracking,fastGaze=false){
  const observed=[],seen=[];let fallbackCalls=0;
  const box={APP:{resting:false,settings:false},thermalModerate:()=>false,fdBusy:false,
    S:{camOK:true,cameraFacing:'front'},NW:{running:false},walkingStreamStatus:()=>({active:false}),
    IDENT:{enabled:true,generation:1},lastFaceDetectAt:0,now:()=>10000,
    headFaceTrackingRequested:()=>tracking,$:()=>({readyState:4,videoWidth:640,videoHeight:480}),
    headFaceSamplingActive:()=>fastGaze,
    fdCanvas:{toDataURL:()=>'<temporary-camera-frame>'},fdCtx:{drawImage:()=>{}},
    requestLocalFace:async()=>({count,x:.2,y:.2,width:.3,height:.4,confidence:.95}),
    NATIVE:{analyzeLocalFace:true,detectFace:()=>{fallbackCalls++;return JSON.stringify({found:true,x:.1,y:.2,width:.2,height:.3,confidence:1});}},
    identityObserve:r=>observed.push(r),markSeen:(...args)=>seen.push(args),
    clearFaceVerification:()=>{},refreshFaceUI:()=>{}};
  vm.createContext(box);vm.runInContext(fn,box);await box.detectFaceNative();
  assert.equal(observed.length,1);assert.equal(observed[0].count,count,'only the recognition result reaches identity matching');
  assert.equal(box.fdBusy,false);
  return {fallbackCalls,seen};
}
(async()=>{
  const miss=await check(0,true);assert.equal(miss.fallbackCalls,1);assert.equal(miss.seen.length,1);
  const disabled=await check(0,false);assert.equal(disabled.fallbackCalls,0);assert.equal(disabled.seen.length,0);
  const match=await check(1,true);assert.equal(match.fallbackCalls,0);assert.equal(match.seen.length,1);
  const crowd=await check(2,true);assert.equal(crowd.fallbackCalls,0);assert.equal(crowd.seen.length,0);
  const owned=await check(1,true,true);assert.equal(owned.seen.length,0,'slow recognition must not overwrite the faster gaze sample');
  console.log('Presence fallback, identity separation and multiple-face tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
