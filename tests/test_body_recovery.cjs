const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../app/src/main/assets/growbot-brain.html'),'utf8');
const part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
function setup(){
  const calls={probes:0,connects:0,closed:0,waits:0};
  const box={Date,Promise,S:{sim:false,manualDisconnect:false,ws:{readyState:1},connectAttemptTimer:0},APP:{resting:false,settings:false},document:{hidden:false},BODY_INTEL:{repairs:[]},bodyIntelSave(){},resolveSelfIssue(){},noteBodyIncident(){},bodyDiagnosticSnapshot:()=>({}),bodyConnectionConfigured:()=>true,bodyControllerReady:()=>box.ready,
    async probeBodyController(){calls.probes++;return {ok:false};},
    async waitForCondition(predicate){calls.waits++;return predicate();},
    abandonBodySocket(s){assert.equal(s,box.S.ws);calls.closed++;box.S.ws=null;},
    connect(){calls.connects++;box.S.ws={readyState:1};box.ready=true;},log(){},scheduleBodyReconnect(){throw Error('unexpected reconnect');},setInterval(fn){box.heartbeat=fn;}
  };
  vm.createContext(box);vm.runInContext(part('let bodyRepairInFlight=', 'function bodyToolFailed('),box);
  const marker='// An OPEN WebSocket is not proof that the Pico is still reachable.';
  const heartbeat=html.slice(html.indexOf(marker),html.indexOf('},3000);',html.indexOf(marker))+9);
  vm.runInContext(heartbeat,box);
  return {box,calls};
}
(async()=>{
  {
    const {box,calls}=setup();let release;
    box.probeBodyController=()=>{calls.probes++;return calls.probes===1?new Promise(r=>release=r):Promise.resolve({ok:true});};
    const a=box.repairBodyRuntime('preflight'),b=box.repairBodyRuntime('maintenance');
    assert.equal(a,b,'concurrent recovery must share one promise');assert.equal(calls.probes,1);
    release({ok:false});assert.equal((await a).ok,true);await b;
    assert.equal(calls.closed,1);assert.equal(calls.connects,1);assert.equal(calls.probes,2);
    await box.repairBodyRuntime('subsequent healthy check');assert.equal(calls.probes,3,'completed lease must be released');
  }
  for(const change of ['sleep','disconnect','replacement','settings']){
    const {box,calls}=setup();let release;
    box.probeBodyController=()=>new Promise(r=>release=r);
    const pending=box.repairBodyRuntime('interrupted probe');
    if(change==='sleep')box.APP.resting=true;
    if(change==='settings')box.APP.settings=true;
    if(change==='disconnect')box.S.manualDisconnect=true;
    if(change==='replacement')box.S.ws={readyState:0};
    release({ok:false});assert.equal((await pending).ok,false);
    assert.equal(calls.connects,0,change+' must prevent redial');assert.equal(calls.closed,0);
  }
  {
    const {box,calls}=setup();box.S.ws.readyState=0;box.S.connectAttemptTimer=123;
    box.waitForCondition=async()=>{calls.waits++;box.S.ws.readyState=1;box.S.connectAttemptTimer=0;box.ready=true;return true;};
    box.probeBodyController=async()=>({ok:true});
    assert.equal((await box.repairBodyRuntime('already connecting')).ok,true);
    assert.equal(calls.waits,1);assert.equal(calls.connects,0);assert.equal(calls.closed,0);
  }
  {
    const {box,calls}=setup();box.S.ws.close=()=>calls.closed++;box.S.bodyLastSeenAt=0;
    box.S.connectAttemptTimer=123;box.heartbeat();assert.equal(calls.closed,0,'new socket gets startup grace');
    box.S.connectAttemptTimer=0;box.heartbeat();assert.equal(calls.closed,1,'stale established socket must still be closed');
    box.S.bodyLastSeenAt=Date.now();box.heartbeat();assert.equal(calls.closed,1,'fresh controller stays connected');
  }
  console.log('PASS shared recovery, startup grace, owner suspension and replacement races.');
})().catch(e=>{console.error(e);process.exitCode=1;});
