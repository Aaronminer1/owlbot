const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/named-walk.js'),'utf8');
const prefix=source.slice(0,source.indexOf("$('#btnNamedWalkSave').onclick="));
async function scenario({blocked=0,rest=false,settings=false,hot=false,fallen=false,bench=false,supervised=false,manual=false,continuous=false,smooth=true,enabled=false,stopAt=0,direction='forward'}={}){
  const singleCycle=bench||supervised||manual;
  const calls=[],ui={textContent:''};let checks=0,polls=0,started=false;
  const box={AbortController,APP:{resting:rest,settings},THERMAL:{paused:hot},S:{fallen},CHANNEL_SETUP:{generation:1,live:false,busy:false},thermalSerious:()=>hot,bodyControllerReady:()=>true,$:()=>ui,setTimeout:f=>f(),
    channelCommand:async(action,args)=>{
      calls.push([action,args]);
      if(action==='walk_run'){started=true;return {named_walk:{run_id:7,cycles:singleCycle?1:2,continuous:!!args.continuous}};}
      if(action==='walk_keepalive'){
        assert.equal(args.run_id,7);
        if(++polls===4)box.CHANNEL_SETUP.generation++;
        return {named_walk:{run_id:7,running:true,continuous:true,completed_cycles:polls}};
      }
      if(action==='info'){
        if(!started)return {named_walk:{available:true,protocol:2,running:false,smooth_walk:smooth}};
        const paused=!singleCycle&&++polls===1;
        return {named_walk:{run_id:7,running:paused,waiting_for_vision:paused,completed_cycles:paused?1:singleCycle?1:2,completed_steps:paused?15:singleCycle?15:25,total_steps:singleCycle?15:25}};
      }
      return {};
    }
  };
  vm.createContext(box);vm.runInContext(prefix,box);
  vm.runInContext('NW.supervised='+Boolean(enabled),box);
  box.mockCheck=async(dir,guard)=>{assert.equal(dir,direction);checks++;if(checks===stopAt)box.CHANNEL_SETUP.generation++;guard();if(checks===blocked)throw Error('I cannot proceed: obstacle');return {path:'clear'};};
  vm.runInContext('checkNamedWalkPath=mockCheck',box);
  let error;try{await box.runNamedForwardWalk({bench,direction,supervised,manual,continuous});}catch(e){error=e.message;}
  return {calls,checks,error};
}
(async()=>{
  const box={};vm.createContext(box);vm.runInContext(prefix,box);
  assert.equal(box.parseWalkClearance('{"path":"clear","floor_visible":true,"evidence":"Open floor immediately ahead"}').path,'clear');
  const clearancePrompt=box.namedWalkClearancePrompt('forward');
  assert.match(clearancePrompt,/ONLY the next single short gait cycle/);
  assert.match(clearancePrompt,/farther ahead is NOT by itself a blockage/);
  assert.match(clearancePrompt,/Do not invent a distance in feet or body lengths from image size alone/);
  assert.match(clearancePrompt,/Each fresh check authorizes only one bounded cycle/);
  assert.match(clearancePrompt,/checks may happen while the preceding cycle is moving/);
  for(const text of ['clear','{}','{"path":"clear","floor_visible":false,"evidence":"Cannot see the ground"}','{"path":"blocked","floor_visible":true,"evidence":"A box is in the path"}'])assert.throws(()=>box.parseWalkClearance(text));
  let s=await scenario();assert.equal(s.error,undefined);assert.equal(s.checks,2);assert.equal(s.calls.filter(([a])=>a==='walk_continue').length,1);
  s=await scenario({blocked:3});assert.equal(s.error,undefined,'a finished two-cycle walk must not request a third-cycle approval');assert.equal(s.checks,2);
  s=await scenario({blocked:1});assert(s.error);assert(!s.calls.some(([a])=>a==='walk_run'));
  s=await scenario({blocked:2});assert(s.error);assert(s.calls.some(([a])=>a==='walk_halt'));assert(!s.calls.some(([a])=>a==='walk_continue'));
  s=await scenario({rest:true});assert(s.error);assert.equal(s.checks,0);assert.equal(s.calls.length,0);
  assert.match(s.error,/Sleep is on/);assert.doesNotMatch(s.error,/hot|fallen/);
  s=await scenario({settings:true});assert.match(s.error,/Settings is open/);assert.equal(s.calls.length,0);
  s=await scenario({hot:true,fallen:true});assert.equal(s.error,undefined,'phone flags alone must not veto a Pico walk');assert.equal(s.checks,2,'every requested cycle retains a fresh camera gate');
  s=await scenario({hot:true,fallen:true,blocked:1});assert(s.error);assert(!s.calls.some(([a])=>a==='walk_run'),'advisory posture cannot bypass a failed camera check');
  s=await scenario({bench:true,rest:true});assert.equal(s.error,undefined);assert.equal(s.checks,0);
  s=await scenario({supervised:true});assert.match(s.error,/Enable supervised/);assert.equal(s.calls.length,0);
  s=await scenario({supervised:true,enabled:true,rest:true,settings:true,hot:true,fallen:true});assert.equal(s.error,undefined);assert.equal(s.checks,0);assert.deepEqual(JSON.parse(JSON.stringify(s.calls.find(([a])=>a==='walk_run')[1])),{direction:'forward',bench:true,path_clear:false});
  s=await scenario({enabled:true,blocked:1});assert(s.error,'test switch alone cannot bypass an autonomous camera check');assert(!s.calls.some(([a])=>a==='walk_run'));
  for(const direction of ['forward','backward']){
    s=await scenario({manual:true,settings:true,rest:true,direction});assert.equal(s.error,undefined);assert.equal(s.checks,0);
    assert.equal(s.calls.find(([a])=>a==='walk_run')[1].bench,true,'manual Drive page uses one Pico-owned cycle');
  }
  s=await scenario({direction:'backward'});assert.equal(s.error,undefined);assert.equal(s.calls.find(([a])=>a==='walk_run')[1].direction,'backward');
  s=await scenario({stopAt:2});assert(s.error);assert(!s.calls.some(([a])=>a==='walk_continue'),'late camera result cannot resume after Stop');
  for(const direction of ['forward','backward']){
    s=await scenario({manual:true,continuous:true,settings:true,rest:true,direction});
    assert.match(s.error,/interrupted/);assert.equal(s.checks,0);
    assert.equal(s.calls.filter(([a])=>a==='walk_run').length,1);
    assert.equal(s.calls.filter(([a])=>a==='walk_keepalive').length,4);
    assert.equal(s.calls.find(([a])=>a==='walk_run')[1].continuous,true);
  }
  s=await scenario({manual:true,continuous:true,smooth:false});
  assert.match(s.error,/Update the Pico/);assert(!s.calls.some(([a])=>a==='walk_run'));
  console.log('PASS: preflight, each-cycle clearance, reverse direction, blocked/invalid camera result, rest, bench and late Stop gating.');
})().catch(e=>{console.error(e);process.exitCode=1;});
