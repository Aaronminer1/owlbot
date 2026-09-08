const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'app/src/main/assets/head-controller.js'),'utf8');
assert.equal(source,fs.readFileSync(path.join(root,'app/src/main/assets/head-controller.js'),'utf8'));
const fields=new Proxy({headRoute:{value:'esp32'},headHost:{value:'10.0.0.6'},headKey:{value:'TEST_ONLY_NOT_A_REAL_KEY'}},{get:(o,k)=>o[k]||(o[k]={value:'',checked:false,textContent:''})});
const sent=[],sockets=[];let deferMove=false,late;
const state={config:{pan:{gpio:18,minimum:1250,maximum:1750},tilt:{gpio:19,minimum:1250,maximum:1750}},moving:false,commanded:{},targets:{}};
function applyHead(t,m={}){
  if(t==='move'){
    for(const axis of ['pan','tilt'])if(m.axis===axis)state.targets[axis]=m.pulse;
    else if(typeof m[axis]==='number')state.targets[axis]=Math.round(1500+m[axis]*250);
    state.commanded={...state.targets};state.holding=true;state.run_id=(state.run_id||0)+1;
  }
  if(t==='stop'){state.targets={};state.commanded={};state.holding=false;}
}
class Socket{
  constructor(url){this.url=url;this.readyState=0;sockets.push(this);}
  send(raw){const m=JSON.parse(raw);sent.push(m);if(m.t==='auth')return;
    applyHead(m.t,m);
    const reply=()=>this.onmessage({data:JSON.stringify({rid:m.rid,ok:true,state})});
    if(m.t==='move'&&deferMove)late=reply;else reply();}
  close(){this.readyState=3;}
}
const bodySocket={untouched:true};
const box={URL,WebSocket:Socket,setTimeout,clearTimeout,Date,APP:{resting:false,settings:false},MIND:{gazeArmed:true},S:{ws:bodySocket,pendingAcks:new Map(),recentAcks:new Map()},$:s=>fields[s.slice(1)]};
vm.createContext(box);vm.runInContext(source.slice(0,source.indexOf("$('#headRoute').onchange=")),box);
vm.runInContext('renderHead=()=>{};loadHeadSettings=()=>{}',box);
function authenticate(){box.connectHead();const ws=sockets.at(-1);ws.readyState=1;ws.onopen();assert.equal(box.headReady(),false);ws.onmessage({data:JSON.stringify({ok:true,kind:'owlbot-head',state})});return ws;}
(async()=>{
  authenticate();assert.equal(box.headReady(),true);
  assert.equal(box.S.ws,bodySocket,'head connect cannot replace body socket');
  assert.equal(box.headNamedTarget('body turn','left'),null);
  assert.equal(box.headNamedTarget('gimbal_pan','left').pan,-1);
  assert.equal(box.headNamedTarget('head tilt','up').tilt,1);
  assert.equal(box.headNamedTarget('tilt','max').pulse,1750);
  let result=await box.headMove({pan:1},false);assert.match(result,/ESP32 completed/);
  assert.equal(sent.filter(m=>m.t==='move').at(-1).slow,true);
  await box.headRequest('move',{tilt:0,slow:false});assert.equal(sent.at(-1).slow,true,'even explicit fast head commands are forced slow');
  box.NW={checkingPath:true};
  const headGeneration=vm.runInContext('HEAD.generation',box),moveCount=sent.length;
  result=await box.headMove({pan:-1},false);assert.match(result,/deferred/);
  await assert.rejects(box.headRequest('move',{pan:-1}),/deferred/);
  assert.equal(sent.length,moveCount,'ordinary and legacy head moves cannot disturb clearance');
  assert.equal(vm.runInContext('HEAD.generation',box),headGeneration,'deferred gaze does not invalidate a stable image');
  result=await box.headMove({pan:0,tilt:0},false,true);assert.match(result,/completed/);
  await box.headStop();assert.equal(state.holding,false,'Stop remains available during camera ownership');
  box.NW.checkingPath=false;
  result=await box.headMove({pan:1},false);assert.match(result,/completed/);
  assert.equal(box.headHeartbeatNeeded(),false,'a recent status request also keeps the link alive');
  vm.runInContext('HEAD.lastSent=Date.now()-1000',box);
  assert.equal(box.headHeartbeatNeeded(),true,'an idle link receives a heartbeat');
  vm.runInContext('HEAD.pending.set(-1,{})',box);
  assert.equal(box.headHeartbeatNeeded(),false,'do not stack heartbeats onto outstanding requests');
  vm.runInContext('HEAD.pending.delete(-1)',box);
  for(let i=0;i<25;i++)box.headEvent('test '+i);
  assert.equal(vm.runInContext('HEAD.events.length',box),20,'diagnostics stay bounded');
  box.APP.resting=true;const before=sent.length;result=await box.headMove({pan:-1},false);assert.match(result,/paused/);assert.equal(sent.length,before);
  result=await box.headMove({tilt:1},true);assert.match(result,/ESP32 completed/,'manual head controls work asleep');
  deferMove=true;const pending=box.headMove({pan:1},true);await box.headStop();late();result=await pending;
  assert.match(result,/interrupted/,'late move result cannot override Stop');deferMove=false;
  box.disconnectHead();assert.equal(box.headReady(),false);assert.equal(box.S.ws,bodySocket);
  await assert.rejects(box.headRequest('move',{pan:1}),/disconnected/);
  const html=fs.readFileSync(path.join(root,'app/src/main/assets/growbot-brain.html'),'utf8');
  assert.match(html,/headKey:"head_control"/,'pairing key uses native secret storage');
  const native=fs.readFileSync(path.join(root,'app/src/main/java/dev/owlbot/brain/MainActivity.java'),'utf8');
  const allowlist=native.slice(native.indexOf('private String checkedSecretName'),native.indexOf('private SecretKey secretKey'));
  assert.match(allowlist,/"head_control"\.equals\(name\)/,'Android must accept and persist the independent head key');
  assert.match(html,/externalHead&&\['look_at','release_gaze'\]\.includes\(name\)/,'head tools skip body preflight');
  assert.match(html,/startsWith\('gaze'\).*return headLegacySend/,'head movement uses the selected transport');
  fields.headRoute.value='pico';box.bodyControllerReady=()=>true;
  const picoCalls=[];box.channelCommand=async(action,args)=>{picoCalls.push([action,args]);applyHead(action.replace('head_',''),args);return {state};};
  const oldSent=sent.length;
  result=await box.headMove({pan:1},true);assert.match(result,/Pico completed/);
  assert.equal(picoCalls[0][0],'head_move');assert.equal(sent.length,oldSent,'Pico mode sends no ESP32 traffic');
  assert.equal(picoCalls[0][1].slow,true,'Pico head is always slow');
  fields.headPicoTiltInvert.checked=true;
  const originalLimits=JSON.stringify(state.config),beforeTilt=picoCalls.length;
  result=await box.headMove({tilt:1},true);assert.match(result,/Pico completed/);
  assert.equal(picoCalls[beforeTilt][1].tilt,-1,'semantic Up reverses at the single Pico transport boundary');
  assert.equal(state.commanded.tilt,1250);
  result=await box.headMove({tilt:-1},true);assert.match(result,/Pico completed/);
  assert.equal(state.commanded.tilt,1750);
  result=await box.headMove({tilt:-0.6,pan:0},true,true);assert.match(result,/Pico completed/);
  assert.equal(state.commanded.tilt,1650,'walking downward view uses the same reversal');
  await box.headAcknowledgedCommand({t:'gaze',tilt:1});assert.equal(state.commanded.tilt,1250,'legacy gaze uses the same reversal');
  result=await box.headMove({axis:'tilt',pulse:1430},true);assert.match(result,/Pico completed/);
  assert.equal(state.commanded.tilt,1430,'raw calibration pulses are never inverted');
  assert.equal(JSON.stringify(state.config),originalLimits,'travel limits are unchanged');
  fields.headPicoTiltInvert.checked=false;
  await box.headStop();assert.equal(picoCalls.at(-1)[0],'head_stop');
  box.channelCommand=async(action,args)=>{applyHead(action.replace('head_',''),args);if(action==='head_info')applyHead('stop');return {state};};
  result=await box.headMove({pan:1},true);assert.match(result,/released before completion/,'empty released state cannot masquerade as reached');
  console.log('PASS: Independent head authentication, Pico isolation, named gaze, sleep/manual behavior, late Stop, no fallback, secure key field.');
})().catch(e=>{console.error(e);process.exitCode=1;});
