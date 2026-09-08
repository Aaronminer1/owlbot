const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const dir=path.join(__dirname,'../app/src/main/assets');
const html=fs.readFileSync(path.join(dir,'growbot-brain.html'),'utf8');
const walk=fs.readFileSync(path.join(dir,'named-walk.js'),'utf8');
async function check({active=true,limited=false,headChanged=false,headFailure=false}={}){
  let clock=100000,requests=0,alignments=0;
  const video={srcObject:{getVideoTracks:()=>[{getSettings:()=>({facingMode:'user'})}]},requestVideoFrameCallback:cb=>{queueMicrotask(cb);return 1},cancelVideoFrameCallback:()=>{}};
  const fields={walkForwardCamera:{value:'front'},vid:video,mVisionModel:{value:'kimi-k2.7-code'},mBase:{value:'https://ollama.com/v1'},mProvider:{value:'ollama-cloud'},namedWalkStatus:{}};
  const box={Date:{now:()=>clock},console,Promise,JSON,Math,Error,Number,String,Boolean,Array,AbortController,
    setTimeout:()=>1,clearTimeout:()=>{},localStorage:{getItem:()=>null,setItem:()=>{}},log:()=>{},
    $:s=>fields[s.slice(1)],PROVIDERS:{'ollama-cloud':{}},MIND:{activeUserTurn:active,userQueue:[]},S:{cameraFacing:'front'},
    enableCamera:async()=>true,grabFrameDataUrl:async()=>'data:image/jpeg;base64,test',localVisionRoute:()=> 'cloud',mindHeaders:()=>({})};
  vm.createContext(box);
  vm.runInContext(html.slice(html.indexOf('const MODEL_RATE_KEY='),html.indexOf('async function mindFetch(')),box);
  vm.runInContext(walk.slice(0,walk.indexOf("$('#btnNamedWalkSave').onclick=")),box);
  box.HEAD={generation:0};
  box.headMove=async(values,owner,alignment)=>{
    assert.equal(vm.runInContext('NW.checkingPath',box),true);
    assert.equal(alignment,true);assert.equal(values.pan,0);assert.equal(values.tilt,-0.6);
    alignments++;box.HEAD.generation++;
    return headFailure?'Head movement failed: disconnected':'Pico completed the head target within its saved limits';
  };
  vm.runInContext('MODEL_RATE.starts=[50000,51000,52000,53000,54000,55000];MODEL_RATE.lastStart=55000;'+(limited?'MODEL_RATE.blockedUntil=160000;':''),box);
  box.mindFetch=async(url,options)=>{
    // Exercise the real scheduler with the class supplied by the real camera
    // gate. Keep the user turn active while waiting, as happens on the phone.
    for(let i=0;i<8;i++){
      const decision=await box.modelRateDecision(options.rateClass);
      if(decision.blocked)throw Error('provider cooldown');
      if(decision.wait){clock+=decision.wait;continue;}
      requests++;
      if(headChanged)box.HEAD.generation++;
      return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({path:'clear',floor_visible:true,evidence:'Clear floor for the next cycle'})}}]})};
    }
    throw Error('camera request starved behind its own active user turn');
  };
  let error;try{await box.checkNamedWalkPath('forward',()=>{},new AbortController().signal);}catch(e){error=e.message;}
  assert.equal(vm.runInContext('NW.checkingPath',box),false,'camera ownership releases on success, stop and failure');
  return {requests,error,alignments,wait:clock-100000};
}
(async()=>{
  for(const active of [true,false]){
    const result=await check({active});
    assert.equal(result.error,undefined);
    assert.equal(result.requests,1,'clearance must reach inference despite a full background bucket');
    assert.equal(result.alignments,1,'head centers before the image is captured');
    assert(result.wait<=10000,'clearance cannot wait for its own turn to finish');
  }
  const limited=await check({limited:true});
  assert.equal(limited.requests,0);assert.match(limited.error,/provider cooldown/);
  const changed=await check({headChanged:true});assert.match(changed.error,/head moved or stopped/);
  const failed=await check({headFailure:true});assert.equal(failed.requests,0);assert.match(failed.error,/could not face straight ahead/);
  console.log('PASS: real walking camera gate and scheduler resolve active-turn dependency; provider cooldown remains authoritative.');
})().catch(e=>{console.error(e);process.exitCode=1;});
