const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/named-walk.js'),'utf8');
const code=src.slice(0,src.indexOf("$('#btnNamedWalkSave').onclick="));
const box={Date,Promise};vm.createContext(box);vm.runInContext(code,box);
const make=box.createWalkPreviewWorker;
(async()=>{
  assert.equal(box.parseLocalWalkClearance('CLEAR').path,'clear');
  for(const answer of ['BLOCKED','UNKNOWN','probably clear','CLEAR then BLOCKED',''])assert.throws(()=>box.parseLocalWalkClearance(answer));
  let calls=[],resolve,clock=1000;
  let w=make({clock:()=>clock,check:()=>new Promise(r=>resolve=r),grant:async(...a)=>calls.push(a),guard(){},halt:async()=>calls.push('halt')});
  w.request(1);w.request(2);assert.equal(calls.length,0);
  resolve({capturedAt:900});await w.wait();assert.equal(calls.length,1);assert.equal(calls[0][0],1);assert.equal(calls[0][1],2400);
  w.request(1);assert.equal(calls.length,1,'do not queue redundant views for one granted cycle');
  clock=1800;w.request(1);resolve({capturedAt:1750});await w.wait();
  assert.equal(calls.length,2,'keep refreshing while still inside the same physical cycle');
  w.request(2);w.close();resolve({capturedAt:1750});await w.wait();assert.equal(calls.length,2,'late image after Stop cannot grant or halt a later action');
  for(const mode of ['stale','blocked','guard']){
    calls=[];
    w=make({clock:()=>5000,check:async()=>{if(mode==='blocked')throw Error('obstacle');return {capturedAt:mode==='stale'?1000:4900};},grant:async()=>calls.push('grant'),guard(){if(mode==='guard')throw Error('changed');},halt:async()=>calls.push('halt')});
    w.request(1);await w.wait();
    if(mode==='stale'){assert(!w.error());assert.deepEqual(calls,[]);w.request(1);await w.wait();w.request(1);await w.wait();}
    assert(w.error());assert.deepEqual(calls,['halt']);
  }
  // A rejected preview is discarded; only a NEW capture can approve the next
  // cycle. Keep the same session, bounded retries, and Stop semantics.
  calls=[];let captures=0,rejections=0;
  w=make({clock:()=>5000,check:async()=>({capturedAt:4900+captures++}),grant:async(boundary,left,view)=>{calls.push(view.capturedAt);return ++rejections<3?{refreshRequired:true}:{};},guard(){},halt:async()=>calls.push('halt')});
  for(let i=0;i<3;i++){w.request(1,true);await w.wait();}
  assert.deepEqual(calls,[4900,4901,4902]);assert.equal(w.error(),null);
  calls=[];w=make({clock:()=>5000,check:async()=>({capturedAt:4900}),grant:async()=>({refreshRequired:true}),guard(){},halt:async()=>calls.push('halt')});
  for(let i=0;i<3;i++){w.request(1,true);await w.wait();}
  assert(w.error());assert.deepEqual(calls,['halt']);
  w.close();w.request(1,true);await w.wait();assert.deepEqual(calls,['halt'],'Stop cannot trigger another refresh');
  const calls2=[];let started=false,cycle=0;
  const app={Date,Promise,AbortController,APP:{resting:false,settings:false},CHANNEL_SETUP:{generation:1,live:false,busy:false},bodyControllerReady:()=>true,$:()=>({textContent:''}),setTimeout:f=>f(),
    channelCommand:async(action,args)=>{
      calls2.push([action,args]);
      if(action==='walk_run'){started=true;assert.equal(args.cycles,6);return {named_walk:{run_id:8,cycles:6}};}
      if(action==='walk_preview')return {ok:1};
      if(action==='info')return !started?{named_walk:{available:true,protocol:2,moving_vision:true,per_request_cycles:true}}:{named_walk:{run_id:8,cycles:6,completed_cycles:++cycle,completed_steps:cycle*10,total_steps:60,running:cycle<6,waiting_for_vision:false}};
      return {};
    }};
  vm.createContext(app);vm.runInContext(code,app);
  app.checkNamedWalkPath=async()=>({headGeneration:42,capturedAt:Date.now()});
  let movingCaptures=0;
  app.checkNamedWalkPathAligned=async(direction,guard,signal,options)=>{assert(started,'next view should be captured after walk starts');assert(options.keepAligned);assert.equal(options.headGeneration,42);movingCaptures++;return {capturedAt:Date.now()};};
  const result=await app.runNamedForwardWalk({cycles:6});
  assert.match(result,/6 forward/);assert(movingCaptures>0);
  assert.equal(calls2.filter(c=>c[0]==='walk_run').length,1,'one request owns all six cycles; no routine restart every three');
  assert(calls2.some(c=>c[0]==='walk_preview'));assert(!calls2.some(c=>c[0]==='walk_continue'));
  // Long approaches retain firmware's ten-cycle bound, with local continuation.
  for(const interrupt of ['', 'blocked', 'stop']){
    let run=0,count=0,completed=0,checks=0;const runs=[];
    const longer={...app,CHANNEL_SETUP:{generation:1,live:false,busy:false},channelCommand:async(action,args)=>{
      if(action==='walk_run'){run++;count=args.cycles;completed=0;runs.push(count);assert(count<=10);return {named_walk:{run_id:run,cycles:count}};}
      if(action==='info')return !run?{named_walk:{available:true,protocol:2,moving_vision:true,per_request_cycles:true}}:{named_walk:{run_id:run,cycles:count,completed_cycles:++completed,completed_steps:completed*10,total_steps:count*10,running:completed<count,waiting_for_vision:false}};
      assert.notEqual(action,'walk_save');return {ok:1};
    }};
    vm.createContext(longer);vm.runInContext(code,longer);
    longer.checkNamedWalkPath=async(direction,guard)=>{checks++;if(checks===2&&interrupt==='blocked')throw Error('blocked path');if(checks===2&&interrupt==='stop')longer.CHANNEL_SETUP.generation++;guard();return {headGeneration:42,capturedAt:Date.now()};};
    longer.checkNamedWalkPathAligned=async()=>({capturedAt:Date.now()});
    if(interrupt){await assert.rejects(longer.runNamedForwardWalk({cycles:18}),/blocked|interrupted/);assert.deepEqual(runs,[10]);}
    else{assert.match(await longer.runNamedForwardWalk({cycles:18}),/18 forward/);assert.deepEqual(runs,[10,8]);assert.equal(checks,2);}
  }
  let preference=null;const pref={localStorage:{getItem:()=>preference}};vm.createContext(pref);vm.runInContext(code,pref);
  assert.equal(pref.preferredApproachCycles(),6);preference='18';assert.equal(pref.preferredApproachCycles(),18);preference='31';assert.equal(pref.preferredApproachCycles(),6);
  console.log('PASS: capture while walking, one in-flight view, no stop/look loop, stale/blocked/late checks, six-cycle single run.');
})().catch(e=>{console.error(e);process.exitCode=1;});
