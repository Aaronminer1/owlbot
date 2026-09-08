const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/named-walk.js'),'utf8');
let running=false,leases=0,resolveView,starts=0;const calls=[];
const b={Date,Promise,AbortController,APP:{resting:false,settings:false},CHANNEL_SETUP:{generation:1,live:false,busy:false},bodyControllerReady:()=>true,$:()=>({textContent:''}),setTimeout:cb=>setImmediate(cb),
 channelCommand:async(name,args)=>{
  calls.push(name);
  if(name==='info'&&!running)return {named_walk:{available:true,protocol:2,smooth_walk:true,moving_vision:true,visual_continuous:true}};
  if(name==='walk_run'){running=true;starts++;return {named_walk:{run_id:9,cycles:1,continuous:true}};}
  if(name==='walk_keepalive'){
   leases++;if(leases===8)resolveView?.({headGeneration:1,capturedAt:Date.now()});
   return {named_walk:{run_id:9,cycles:1,continuous:true,running:true,waiting_for_vision:true,completed_cycles:1}};
  }
  return {ok:true};
 }};vm.createContext(b);vm.runInContext(source.slice(0,source.indexOf("$('#btnNamedWalkSave').onclick=")),b);
b.checkNamedWalkPath=async()=>({headGeneration:1,capturedAt:Date.now()});
b.checkNamedWalkPathAligned=()=>new Promise(r=>{resolveView=r;});
(async()=>{
 const failTimer=setTimeout(()=>{console.error('Keepalive blocked behind inference');process.exit(1);},2000);
 try{await assert.rejects(b.runNamedForwardWalk({continuous:true,sessionGuard:()=>{if(leases>=12)throw Error('Owner Stop');}}),/Owner Stop/);
 assert.equal(starts,1);assert(leases>=12);assert(calls.includes('walk_preview'));assert(calls.includes('walk_halt'));
 console.log('PASS: controller keepalive continues during pending multi-stage vision at feet-down boundary; one run, Stop preserved.');
 }finally{clearTimeout(failTimer);}
})().catch(e=>{console.error(e);process.exitCode=1;});
