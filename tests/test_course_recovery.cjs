const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'../app/src/main/assets');
const source=fs.readFileSync(path.join(root,'walk-stream.js'),'utf8');
const tick=()=>new Promise(setImmediate);
function fixture(mode='normal'){
 let walks=0,turns=0,checks=0,rejectWalk,rejectTurn,resolveTurn;const calls=[];
 const b={Date,Promise,AbortController,APP:{resting:false,settings:false},MIND:{on:false},NW:{running:false},CHANNEL_SETUP:{generation:1},bodyControllerReady:()=>true,motorControlAvailable:()=>true,ensureMotorControlForAction:()=>({ok:true}),queueMicrotask,mindTick(){},
  runNamedForwardWalk:async o=>{calls.push({kind:'walk',options:o});walks++;
   if(walks===1||mode==='repeat'){if(mode==='hazard')throw Error('blocked');throw Object.assign(Error('drift'),{courseCorrection:'right',completedCycles:mode==='repeat'?0:4});}
   o.onProgress({completed_cycles:1});return await new Promise((r,j)=>rejectWalk=j);
  },
  checkNamedWalkPath:async()=>{checks++;if(mode==='stale')throw Error('stale camera');return mode==='cleared'?{path:'clear'}:{path:'clear',steering:mode==='disagree'?'left':'right'};},
  runDriveTurn:async(d,o)=>{turns++;assert.equal(d,'right');assert.equal(o.fraction,mode==='repeat'?[.08,.12,.16][turns-1]:.08);calls.push({kind:'turn',fraction:o.fraction});if(mode==='stop-turn'||mode==='disconnect')await new Promise((r,j)=>{resolveTurn=r;rejectTurn=j});o.sessionGuard();},
  channelCommand:async name=>{calls.push({kind:name});if(name==='walk_halt')rejectWalk?.(Error('stop'));if(name==='turn_halt')rejectTurn?.(Error('stop'));}
 };vm.createContext(b);vm.runInContext(source,b);return {b,calls,counts:()=>({walks,turns,checks}),resolveTurn:()=>resolveTurn?.()};
}
(async()=>{
 for(const mode of ['normal','cleared','disagree']){
  const f=fixture(mode),s=f.b.startWalkingStream({target:'doorway mat',corridor:'bins left; tape right'});await tick();
  const now=f.b.walkingStreamStatus();assert.equal(now.id,s.id);assert.equal(now.target,'doorway mat');assert.equal(now.completedCycles,5);assert.equal(now.physicalArrivalVerified,false);assert.equal(now.active,true);
  assert.deepEqual(f.counts(),{walks:2,turns:mode==='normal'?1:0,checks:1});
  assert.equal(f.calls.filter(c=>c.kind==='walk')[1].options.corridor,'bins left; tape right');
  await f.b.stopWalkingStream('Owner Stop');assert.equal(f.b.walkingStreamStatus().active,false);assert.equal(f.counts().walks,2);
 }
 for(const mode of ['hazard','stale','repeat']){
  const f=fixture(mode);f.b.startWalkingStream({target:'door'});await tick();
  assert.equal(f.b.walkingStreamStatus().active,false);assert.equal(f.b.walkingStreamStatus().target,'door');
  if(mode==='repeat'){assert.equal(f.counts().turns,3);assert.match(f.b.walkingStreamStatus().outcome,/Repeated steering/);}
  else assert.equal(f.counts().turns,0);
 }
 for(const mode of ['stop-turn','disconnect']){
  const f=fixture(mode);f.b.startWalkingStream({target:'door'});await tick();assert.equal(f.b.walkingStreamStatus().phase,'correcting');
  if(mode==='stop-turn')await f.b.stopWalkingStream('Owner Stop');
  else{f.b.CHANNEL_SETUP.generation++;f.resolveTurn();await tick();}
  assert.equal(f.b.walkingStreamStatus().active,false);assert.equal(f.counts().walks,1,'no resumed walk after Stop or disconnect during correction');assert(f.calls.some(c=>c.kind==='turn_halt'));
 }
 const named=fs.readFileSync(path.join(root,'named-walk.js'),'utf8');const b={Date,Promise};vm.createContext(b);vm.runInContext(named.slice(0,named.indexOf("$('#btnNamedWalkSave').onclick=")),b);
 assert.equal(b.parseWalkingVisionReport('CLEAR RIGHT',{courseCorrection:true}).steering,'right');
 assert.equal(b.parseWalkingVisionReport('CLEAR LEFT',{courseCorrection:true}).steering,'left');
 assert.equal(b.parseWalkingVisionReport('CLEAR CENTER',{courseCorrection:true}).steering,undefined);
 for(const text of ['RIGHT','CLEAR','RIGHT maybe','LEFT then CLEAR','UNKNOWN','BLOCKED','BLOCKED LEFT','UNKNOWN RIGHT','CLEAR UNKNOWN','CLEAR TARGET'])assert.throws(()=>b.parseWalkingVisionReport(text,{courseCorrection:true}));
 assert.throws(()=>b.parseWalkingVisionReport('RIGHT',{}));
 let grant=0,halt=0,steer=0;
 const w=b.createWalkPreviewWorker({clock:()=>1000,check:async()=>({capturedAt:900,steering:'left'}),guard(){},grant:async()=>grant++,halt:async()=>halt++,onSteering:()=>steer++});
 w.request(1);await w.wait();w.request(2);await w.wait();assert.equal(steer,1);assert.equal(grant,0);assert.equal(halt,0,'drift withholds next approval instead of halting mid-step');
 console.log('PASS: same goal/session recovery, fresh stationary recheck, small turn, cleared drift, hazards/stale input, bounded no-progress, Stop and disconnect during correction.');
})().catch(e=>{console.error(e);process.exitCode=1});
