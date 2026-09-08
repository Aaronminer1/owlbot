const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/named-walk.js'),'utf8');
async function scenario(cycles,{saved=3,blocked=0,stopAt=0,direction='forward',badHalt=false,pace,paceSupport=true,badPace=false}={}){
  let running=false,waiting=false,completed=0,runId=0,checks=0,total=0;
  const calls=[],ui={};
  const speeds={creep:200,slow:600,fast:1000,run:1600};
  const status=()=>({available:true,protocol:2,smooth_walk:true,pace_control:paceSupport,pace_speeds:speeds,speed_us_s:badPace?999:speeds[pace]||1000,run_id:runId,running,waiting_for_vision:waiting,cycles:saved,completed_cycles:completed,completed_steps:5+completed*10,total_steps:5+saved*10});
  const box={AbortController,Date,Promise,setTimeout:f=>f(),APP:{resting:false,settings:false},CHANNEL_SETUP:{generation:1,live:false,busy:false},bodyControllerReady:()=>true,$:()=>ui,
    channelCommand:async(action,args)=>{
      calls.push({action,args});
      if(action==='walk_run'){assert.equal(running,false);assert.equal(args.direction,direction);assert.equal(args.bench,false);assert.equal(args.path_clear,true);runId++;completed=0;running=true;waiting=false;}
      else if(action==='info'&&running&&!waiting){completed++;total++;waiting=completed<saved;running=waiting;}
      else if(action==='walk_continue'){assert.equal(waiting,true);assert.equal(args.completed_cycles,completed);waiting=false;}
      else if(action==='walk_halt'){if(!badHalt){running=false;waiting=false;}}
      return {named_walk:status(),walk_plan:{cycles:saved},channel_state:{channels:[]}};
    }};
  vm.createContext(box);vm.runInContext(source.slice(0,source.indexOf("$('#btnNamedWalkSave').onclick=")),box);
  box.checkNamedWalkPath=async(dir,guard)=>{assert.equal(dir,direction);checks++;if(checks===stopAt)box.CHANNEL_SETUP.generation++;guard();if(checks===blocked)throw Error('I cannot proceed in that direction: box');};
  let result,error;try{result=await box.runNamedForwardWalk({cycles,direction,pace});}catch(e){error=e.message;}
  assert.equal(vm.runInContext('NW.running',box),false);
  assert(!calls.some(c=>c.action==='walk_save'),'per-request count must not edit saved routine');
  return {result,error,calls,total,checks};
}
(async()=>{
  for(const saved of [1,3,5])for(const cycles of [1,2,3,4,7,10,18,30])for(const direction of ['forward','backward']){
    const r=await scenario(cycles,{saved,direction});assert.equal(r.error,undefined);assert.equal(r.total,cycles);
    assert.equal(r.checks,cycles,'exactly one fresh approval per actual cycle');
    assert.equal(r.calls.filter(c=>c.action==='walk_run').length,Math.ceil(cycles/saved));
    assert.equal(r.calls.filter(c=>c.action==='walk_halt').length,cycles%saved?1:0);
    assert.match(r.result,new RegExp('finished '+cycles+' '+direction));
  }
  for(const cycles of [0,31,-1,1.5,'2',NaN]){const r=await scenario(cycles);assert.match(r.error,/1 to 30/);assert.equal(r.calls.length,0);}
  let r=await scenario(7,{blocked:4});assert.match(r.error,/cannot proceed/);assert.equal(r.total,3);assert.equal(r.calls.filter(c=>c.action==='walk_run').length,1);
  r=await scenario(7,{stopAt:4});assert.match(r.error,/interrupted/);assert.equal(r.total,3);assert.equal(r.calls.filter(c=>c.action==='walk_run').length,1);
  r=await scenario(1,{badHalt:true});assert.match(r.error,/stop was not confirmed/);assert.equal(r.total,1);
  for(const pace of ['creep','slow','fast','run'])for(const direction of ['forward','backward']){
    const p=await scenario(4,{pace,direction});assert.equal(p.error,undefined);
    assert(p.calls.filter(c=>c.action==='walk_run').every(c=>c.args.pace===pace));
  }
  r=await scenario(1,{pace:'run',paceSupport:false});assert.match(r.error,/Update the Pico/);assert(!r.calls.some(c=>c.action==='walk_run'));
  r=await scenario(1,{pace:'warp'});assert.match(r.error,/Choose creep/);assert.equal(r.calls.length,0);
  r=await scenario(1,{pace:'slow',badPace:true});assert.match(r.error,/did not confirm/);assert(r.calls.some(c=>c.action==='walk_halt'));
  const html=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/growbot-brain.html'),'utf8'),parser={namedChannelIntent:()=>null};vm.createContext(parser);
  vm.runInContext(html.slice(html.indexOf('function directBodyIntent('),html.indexOf('function scheduleRouteRecovery(')),parser);
  for(const [text,pace,cycles] of [['Andrew, creep forward','creep',1],['walk backward slowly for two cycles','slow',2],['walk forward fast for 4 cycles','fast',4],['run forward one cycle','run',1]]){
    const p=parser.directBodyIntent(text);assert.equal(p.pace,pace);assert.equal(p.cycles,cycles);
  }
  console.log('PASS: variable 1-30 forward/backward cycles on saved 1/3/5-cycle plans; feet-down stop, fresh per-cycle clearance, no saved-plan writes, blocked path and Stop prevent additional segments.');
})().catch(e=>{console.error(e);process.exitCode=1;});
