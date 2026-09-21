'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const sensors=require('../app/src/main/assets/sensor-awareness.js');
const t=100000;
function sample(){
  const n={sensorMode:'full',motion:{accelerationMps2:[0,0,9.81],linearAccelerationMps2:[0,0,0],
    gravityMps2:[0,9.81,0],gyroscopeRadS:[0,0,0],magneticFieldUt:[10,20,30],
    orientationDegAzimuthPitchRoll:[20,0,0],stepsSinceBoot:20},
    environment:{lightLux:80,proximityCm:5,pressureHpa:1000},samples:{}};
  for(const key of [...Object.keys(n.motion),...Object.keys(n.environment)])
    n.samples[key]={active:true,sampleAt:t-10,accuracy:3,onChange:/light|proximity|steps/.test(key),maximumRange:5};
  return n;
}
const ctx={cameraLive:true,flow:{sampleAt:t-10,conf:.8,yaw:2,tilt:0,fwd:0}};
let n=sample(),s=sensors.interpret(n,ctx,t);
assert.match(s.sceneMotion,/scene change candidate/);
assert.match(s.motion,/not proof of being stationary/);
assert.equal(s.proximityNear,false);
assert(!JSON.stringify(s).includes('latitude'));
assert.match(sensors.interpret(n,{...ctx,headMoving:true},t).sceneMotion,/self-motion/);
assert.match(sensors.interpret(n,{...ctx,bodyCommanded:true},t).notes.join(' '),/not measured travel/);
n.motion.gyroscopeRadS=[0,.4,0];s=sensors.interpret(n,ctx,t);
assert.equal(s.gravityAxisRotationRadS,.4);assert.match(s.sceneMotion,/self-motion/);
n.samples.gyroscopeRadS.sampleAt=t-5000;s=sensors.interpret(n,ctx,t);
assert.equal(s.rotationRadS,null);assert.match(s.sceneMotion,/self-motion unknown/);
// Fresh accelerometer does not renew a stale gyro; a frozen frame is not current.
assert.equal(sensors.interpret(sample(),{...ctx,flow:{...ctx.flow,sampleAt:t-5000}},t).sceneMotion,'unavailable');
n=sample();n.samples.lightLux.sampleAt=1;
assert.equal(sensors.reading(n,'lightLux',t).value,80,'active on-change values remain current');
n.samples.lightLux.sampleAt=0;assert.equal(sensors.reading(n,'lightLux',t).value,null,'no new subscription sample');
n=sample();n.samples.proximityCm.maximumRange=3;n.environment.proximityCm=3;
assert.equal(sensors.interpret(n,ctx,t).proximityNear,false,'maximum range is far, not a nearby obstacle');
n.environment.proximityCm=0;n.environment.lightLux=0;s=sensors.interpret(n,ctx,t);
assert(s.proximityNear);assert.match(s.notes.join(' '),/covered or shaded/);
n.motion.gyroscopeRadS=[NaN,0,0];assert.equal(sensors.reading(n,'gyroscopeRadS',t).valid,false);
n.samples.magneticFieldUt.accuracy=0;assert.match(sensors.interpret(n,ctx,t).heading,/unreliable/);
n.samples.magneticFieldUt.accuracy=1;assert.match(sensors.interpret(n,ctx,t).heading,/unreliable/,'low compass accuracy is not trusted');
n.sensorMode='paused';assert.equal(sensors.reading(n,'lightLux',t).value,null);
assert.equal(sensors.interpret(n,ctx,t).motion,'unknown');
assert.equal(sensors.interpret(sample(),{...ctx,resting:true},t).mode,'paused');
assert.match(sensors.summary(sensors.interpret({},ctx,t)),/unknown/);
assert(sensors.summary(s).length<=1000);
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'app/src/main/assets/growbot-brain.html'),'utf8');
const java=fs.readFileSync(path.join(root,'app/src/main/java/dev/owlbot/brain/MainActivity.java'),'utf8');
assert.match(java,/hardwareSensorsPaused = true/);assert.match(java,/micPaused = true/);
assert.match(java,/event\.timestamp/);assert.match(java,/sensorSampleTimes\.clear\(\)/);
assert.match(java,/nativeSensorAt - ageMs < sensorSessionAt/);
assert.match(html,/applyHearingUI\(false\);\s*if\(APP.resting\)pauseRestingSensors\(\)/);
// Already-resting must reassert privacy without changing motor authority or waking.
const calls=[];const box={APP:{resting:true},S:{},earsPause:v=>calls.push(['ears',v]),
  disableCamera:()=>calls.push('camera'),disableMic:()=>calls.push('mic'),pauseMotionSensors:()=>calls.push('motion'),
  NATIVE:{pauseHardwareSensors:()=>calls.push('native'),keepAwake:v=>calls.push(['awake',v])}};
vm.createContext(box);
vm.runInContext(html.slice(html.indexOf('function pauseRestingSensors('),html.indexOf('function wakeFromRest(')),box);
box.restNow();box.restNow();assert.equal(calls.filter(x=>x==='native').length,2);assert.equal(box.APP.resting,true);
console.log('Sensor awareness: freshness, on-change, self-motion, limits, sleep and missing-data cases passed');
