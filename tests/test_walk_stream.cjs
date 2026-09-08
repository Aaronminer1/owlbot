const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'../app/src/main/assets');
const source=fs.readFileSync(path.join(root,'walk-stream.js'),'utf8');
let rejectWalk,options,halts=0;
const box={APP:{resting:false,settings:false},MIND:{on:false},NW:{running:false},bodyControllerReady:()=>true,
 ensureMotorControlForAction:()=>({ok:true}),runNamedForwardWalk:opts=>{options=opts;return new Promise((_,reject)=>rejectWalk=reject);},
 channelCommand:async name=>{assert.equal(name,'walk_halt');halts++;rejectWalk(Error('stopped'));},queueMicrotask,mindTick:()=>{}};
vm.createContext(box);vm.runInContext(source,box);
(async()=>{
 const started=box.startWalkingStream({direction:'forward',target:'yellow bucket'});
 assert.equal(started.accepted,true);assert.equal(started.physicalArrivalVerified,false);assert.equal(options.continuous,true);assert.equal(options.cycles,undefined);
 assert.throws(()=>box.startWalkingStream({}),/Already walking/);
 options.onProgress({completed_cycles:21});assert.equal(box.walkingStreamStatus().completedCycles,21);
 await box.stopWalkingStream('Owner Stop');assert.equal(halts,1);assert.equal(box.walkingStreamStatus().active,false);assert.equal(box.walkingStreamStatus().outcome,'Owner Stop');
 box.APP.resting=true;assert.throws(()=>box.startWalkingStream({}),/Wake/);box.APP.resting=false;
 const walkSource=fs.readFileSync(path.join(root,'named-walk.js'),'utf8');
 const code=walkSource.slice(0,walkSource.indexOf("$('#btnNamedWalkSave').onclick="));
 let running=false,cycles=0,calls=[];
 const app={Date,Promise,AbortController,APP:{resting:false,settings:false},CHANNEL_SETUP:{generation:1,live:false,busy:false},bodyControllerReady:()=>true,$:()=>({textContent:''}),setTimeout:f=>f(),
  channelCommand:async(name,args)=>{calls.push(name);
   if(name==='info'&&!running)return {named_walk:{available:true,protocol:2,smooth_walk:true,moving_vision:true,visual_continuous:true}};
   if(name==='walk_run'){running=true;assert.equal(args.continuous,true);assert.equal(args.bench,false);assert.equal(args.path_clear,true);assert.equal(args.cycles,undefined);return {named_walk:{run_id:4,cycles:1,continuous:true}};}
   if(name==='walk_keepalive')return {named_walk:{run_id:4,cycles:1,continuous:true,completed_cycles:++cycles,running:true,waiting_for_vision:false}};
   return {ok:true};
  }};
 vm.createContext(app);vm.runInContext(code,app);
 app.checkNamedWalkPath=async()=>({headGeneration:1,capturedAt:Date.now()});app.checkNamedWalkPathAligned=async()=>({headGeneration:1,capturedAt:Date.now()});
 await assert.rejects(app.runNamedForwardWalk({continuous:true,sessionGuard:()=>{if(cycles>=35)throw Error('course correction');}}),/course correction/);
 assert.equal(calls.filter(n=>n==='walk_run').length,1);assert.ok(calls.filter(n=>n==='walk_keepalive').length>=35);assert.ok(calls.includes('walk_halt'));
 assert.ok(calls.includes('walk_preview'),'continuous mode retains moving camera approvals');
 running=false;app.channelCommand=async()=>({named_walk:{available:true,protocol:2,smooth_walk:true,moving_vision:true}});
 await assert.rejects(app.runNamedForwardWalk({continuous:true}),/Update the Pico/);
 console.log('PASS: start/stop session, preserved target, no claimed arrival, 35 continuous cycles with one start, camera approvals, course correction and old-firmware refusal.');
})().catch(e=>{console.error(e);process.exitCode=1;});
