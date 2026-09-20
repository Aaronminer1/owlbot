const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'../app/src/main/assets');
const html=fs.readFileSync(path.join(root,'growbot-brain.html'),'utf8');
const stream=fs.readFileSync(path.join(root,'walk-stream.js'),'utf8');
function fixture(){
  const spoken=[],conversations=[],logs=[];let reject,options,starts=0;
  const box={APP:{resting:false,settings:false},MIND:{on:false,motionArmed:true,directBodyQueue:[],directBodyBusy:false},
    NW:{running:false,supervised:false},PERCEPTION:{},FACE:{set:()=>{}},INNER:{helped:0},window:{},
    ensureMotorControlForAction:()=>({ok:true}),bodyControllerReady:()=>true,isDog6:()=>true,
    directBodyIntent:()=>({action:'cycle',routine:'drive_forward',label:'forward walk'}),
    runNamedForwardWalk:opts=>{starts++;options=opts;return new Promise((_,r)=>reject=r);},
    say:text=>spoken.push(text),rememberConversation:(user,reply)=>conversations.push({user,reply}),
    MEM:{conversations:[]},mindLog:text=>logs.push(text),caption:()=>{},goalEvent:()=>{},innerSave:()=>{},
    queueMicrotask,mindTick:()=>{},setTimeout,clearTimeout,now:Date.now};
  vm.createContext(box);vm.runInContext(stream,box);
  vm.runInContext(html.slice(html.indexOf('function quietPhysicalRequest('),html.indexOf('function groundedSpokenReply(')),box);
  vm.runInContext(html.slice(html.indexOf('function reportDirectWalkingOutcome('),html.indexOf('window.owlDirectBodyIntent=')),box);
  return {box,spoken,conversations,logs,fail:reason=>reject(Error(reason)),progress:n=>options.onProgress({completed_cycles:n}),starts:()=>starts};
}
const flush=()=>new Promise(r=>setImmediate(r));
(async()=>{
  const t=fixture();assert.equal(t.box.handleDirectBodyIntent('Andrew walk forward'),true);await flush();
  assert.deepEqual(t.spoken,['Checking the path before I walk.']);
  assert.equal(t.box.MIND.directBodyBusy,false,'pending stream does not hold direct command queue');
  assert.equal(t.starts(),1);
  t.fail('I cannot proceed in that direction: A person is in the next foot placement area.');await flush();
  assert.equal(t.spoken.length,2,'async failure reaches owner even when the mind loop is off');
  assert.match(t.spoken[1],/camera check reported/);assert.doesNotMatch(t.spoken.join(' '),/[{}]|accepted|startedAt|physicalArrivalVerified/);
  assert.match(t.conversations.at(-1).reply,/could not complete/);
  assert.equal(t.box.walkingStreamStatus().completedCycles,0);
  for(const request of ['walk forward','Why did you stop walking?']){
    assert.equal(t.box.physicalActionSpeech(JSON.stringify({accepted:true,active:true,completedCycles:0}),request),'Checking the path before I walk.');
    assert.equal(t.box.physicalActionSpeech('{"active":',request),'I could not confirm the movement result.');
    assert.equal(t.box.physicalActionSpeech('{"secret":"internal diagnostic"}',request),'I could not confirm the movement result.');
  }
  const d=fixture();d.box.bodyControllerReady=()=>false;d.box.repairBodyRuntime=async()=>({ok:false,privateDiagnostic:'do not speak'});
  d.box.handleDirectBodyIntent('walk forward');await flush();assert.equal(d.starts(),0);
  assert.match(d.spoken[0],/controller is not responding/);assert.doesNotMatch(d.spoken[0],/privateDiagnostic|[{}]/);
  const moved=fixture();moved.box.MIND.on=true;moved.box.handleDirectBodyIntent('walk forward');await flush();moved.progress(2);
  moved.fail('Pico connection lost');await flush();assert.match(moved.spoken.at(-1),/^Walking stopped.*lost contact/);
  assert.match(moved.box.MIND.pendingAgentEvent,/already received/);
  const sleeping=fixture();sleeping.box.handleDirectBodyIntent('walk forward');await flush();sleeping.box.APP.resting=true;
  sleeping.fail('rest interrupted walking');await flush();assert.equal(sleeping.spoken.length,1,'rest suppresses late speech');
  const c=fixture();c.box.startWalkingStream({onOutcome:()=>{throw Error('notification error');}});c.fail('camera failed');await flush();
  assert.equal(c.box.walkingStreamStatus().active,false,'notification failures cannot leave a session running');
  assert.equal(t.box.walkingStreamSpeech({outcome:'The owner said Stop.'}),'Stopped as requested.');
  console.log('PASS: direct walk startup, async blocked outcome, completed-cycle report, disconnect, raw JSON guard, rest, and callback failure; all hardware mocked.');
})().catch(e=>{console.error(e);process.exitCode=1;});
