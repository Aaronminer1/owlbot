const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'../app/src/main/assets'),source=fs.readFileSync(path.join(root,'walk-stream.js'),'utf8');
const tick=()=>new Promise(setImmediate),error=(kind,msg=kind)=>Object.assign(Error(msg),{navigationKind:kind});
function fixture(mode){
 let runs=0,checks=0,turns=0,pauses=0,resolvePause,resolveView,resolveTurn,rejectWalk,ready=true;const seen=[],reports=[],commands=[];
 const b={Date,Promise,AbortController,Number,Set,Math,setTimeout,clearTimeout,APP:{resting:false,settings:false},MIND:{on:false},NW:{running:false},HEAD:{generation:1},CHANNEL_SETUP:{generation:1},
  bodyControllerReady:()=>ready,motorControlAvailable:()=>true,ensureMotorControlForAction:()=>({ok:true}),walkVisionClock:()=>1000,queueMicrotask,mindTick(){},
  runNamedForwardWalk:async opts=>{runs++;seen.push(opts);opts.sessionGuard();
   if(mode==='uncertain'&&runs<=2)throw error('uncertain');
   if(mode==='format')throw error('vision_format');
   if(mode==='unconfirmed')throw Object.assign(error('blocked'),{stopUnconfirmed:true});
   if(mode!=='uncertain'&&runs<=(['detour','stale','none','late-view','late-turn'].includes(mode)?2:1))throw error('blocked');
   if(mode==='stale'||mode==='none')throw error('blocked');
   opts.onProgress({completed_cycles:1});
   if(opts.continuous===false){assert.equal(opts.cycles,1);return 'one cycle confirmed';}
   return new Promise((_,r)=>rejectWalk=r);
  },
  checkNamedWalkPath:async(d,guard,signal,opts)=>{checks++;guard();assert(opts.detour);if(mode==='late-view')await new Promise(r=>resolveView=r);return {direction:mode==='none'?'none':'left',capturedAt:mode==='stale'?-3000:1000,headGeneration:1};},
  runDriveTurn:async(d,opts)=>{opts.sessionGuard();opts.beforeStart();assert.equal(d,'left');assert.equal(opts.fraction,.08);turns++;if(mode==='late-turn')await new Promise(r=>resolveTurn=r);opts.sessionGuard();},
  channelCommand:async name=>{commands.push(name);if(name==='walk_halt')rejectWalk?.(Error('stop'));return {};}
 };vm.createContext(b);vm.runInContext(source,b);
 b.walkRecoveryPause=async(ms,guard,signal)=>{pauses++;assert(ms>=1000&&ms<=15000);
  if(['stop','disconnect','off','sleep','none'].includes(mode)||mode==='stale'&&pauses>=3)await new Promise((resolve,reject)=>{resolvePause=resolve;signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});});
  guard();
 };
 const start=()=>b.startWalkingStream({target:'doorway',onRecovery:s=>reports.push(s),onOutcome:s=>reports.push(s)});
 return {b,start,seen,reports,commands,counts:()=>({runs,checks,turns,pauses}),release:()=>resolvePause?.(),releaseView:()=>resolveView?.(),releaseTurn:()=>resolveTurn?.(),disconnect:()=>{ready=false;},reconnect:()=>{ready=true;}};
}
(async()=>{
 for(const mode of ['clears','uncertain','detour']){
  const f=fixture(mode),start=f.start();await tick();const status=f.b.walkingStreamStatus();
  assert(status.active);assert.equal(status.id,start.id);assert.equal(status.target,'doorway');assert(status.goalRetained);assert.equal(status.physicalArrivalVerified,false);
  if(mode==='detour'){assert.equal(f.counts().turns,1);assert.equal(f.seen[2].continuous,false);assert.equal(f.seen[2].courseCorrection,false);assert.equal(f.seen[3].continuous,true);assert.equal(status.completedCycles,2);}
  else assert.equal(f.counts().turns,0);
  assert.equal(f.reports.length,1,'one recovery notice per failure category, not every retry');
  await f.b.stopWalkingStream('The owner said Stop.');assert.equal(f.b.walkingStreamStatus().active,false);
 }
 for(const mode of ['stop','disconnect','off','sleep','none','stale']){
  const f=fixture(mode);f.start();await tick();const before=f.counts().runs;
  if(mode==='disconnect')f.disconnect();
  else if(mode==='off')f.b.motorControlAvailable=()=>false;
  else if(mode==='sleep')f.b.APP.resting=true;
  else f.b.cancelWalkingSession('Owner Stop');
  f.release();await tick();assert.equal(f.b.walkingStreamStatus().active,false,mode);assert.equal(f.counts().runs,before,mode+' must not restart');assert.equal(f.counts().turns,0);
  f.reconnect();await tick();assert.equal(f.counts().runs,before,'reconnect is not movement permission');
 }
 for(const mode of ['format','unconfirmed']){
  const f=fixture(mode);f.start();await tick();assert.equal(f.b.walkingStreamStatus().active,false);assert.equal(f.counts().turns,0);assert(f.b.walkingStreamStatus().goalRetained);
  assert.equal(f.counts().runs,mode==='format'?4:1);
 }
 for(const mode of ['late-view','late-turn']){
  const f=fixture(mode);f.start();await tick();assert.equal(f.counts().runs,2);
  const stopped=f.b.stopWalkingStream('The owner said Stop.');f.releaseView();f.releaseTurn();await stopped;await tick();
  assert.equal(f.counts().runs,2,'late callback cannot restart forward travel');assert.equal(f.counts().turns,mode==='late-view'?0:1);
  assert.equal(f.b.walkingStreamStatus().failureKind,null,'Stop is not mislabeled as a camera fault');
  if(mode==='late-turn')assert(f.commands.includes('turn_halt'));
 }
 const b={};vm.createContext(b);const named=fs.readFileSync(path.join(root,'named-walk.js'),'utf8');vm.runInContext(named.slice(0,named.indexOf("$('#btnNamedWalkSave').onclick=")),b);
 for(const kind of ['blocked','uncertain'])assert.throws(()=>b.parseWalkClearance(JSON.stringify({path:kind,floor_visible:true,evidence:'The immediate corridor assessment'})),e=>e.navigationKind===kind);
 const clear={direction:'left',floor_visible:true,sweep_clear:true,evidence:'Floor and swept space visibly clear'};
 assert.equal(b.parseWalkDetour(JSON.stringify(clear)).direction,'left');
 for(const patch of [{floor_visible:false},{sweep_clear:false},{direction:'none'}])assert.equal(b.parseWalkDetour(JSON.stringify({...clear,...patch})).direction,'none');
 assert.throws(()=>b.parseWalkDetour('{bad'),e=>e.navigationKind==='vision_format');
 assert.throws(()=>b.parseWalkDetour(JSON.stringify({...clear,sweep_clear:'yes'})),e=>e.navigationKind==='vision_format');
 // Real timer wait is cancellable, including before a new frame is requested.
 const timers={Date,Promise,setTimeout,clearTimeout,AbortController,NW:{},MIND:{},APP:{}};vm.createContext(timers);vm.runInContext(source,timers);
 const controller=new AbortController(),waiting=timers.walkRecoveryPause(15000,()=>{},controller.signal);controller.abort();await assert.rejects(waiting,/cancelled/);
 console.log('PASS: retained goal, moved obstacle, uncertain view, checked small detour plus fresh one-cycle approach, stale/unknown turn refusal, bounded service retries, Stop/sleep/motor-off/disconnect and no reconnect replay.');
})().catch(e=>{console.error(e);process.exitCode=1;});
