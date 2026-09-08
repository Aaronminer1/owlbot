const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../app/src/main/assets/growbot-brain.html'),'utf8');
let cancelled=0,nextTimer=0;const timers=new Map();
const box={Promise,Map,Date,Error,DOMException,AbortController,LOCAL_VISION:{seq:0,pending:new Map()},localVisionReady:()=>true,NATIVE:{inferLocalVision(){},cancelLocalVisionInference(){cancelled++;}},setTimeout(fn){const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}};
vm.createContext(box);vm.runInContext(html.slice(html.indexOf('function localVisionInfer('),html.indexOf('if(NATIVE&&NATIVE.localVisionStatus)',html.indexOf('function localVisionInfer('))),box);
(async()=>{
  const controller=new AbortController();const first=box.localVisionInfer('image','prompt',controller.signal).catch(e=>e.name);
  controller.abort();assert.equal(await first,'AbortError');assert.equal(timers.size,0,'cancelled frame must not cancel a later request 90 seconds afterward');assert.equal(box.LOCAL_VISION.pending.size,0);assert.equal(cancelled,1);
  const second=box.localVisionInfer('image','prompt');const pending=[...box.LOCAL_VISION.pending.values()][0];pending.resolve({text:'CLEAR'});assert.equal((await second).text,'CLEAR');assert.equal(timers.size,0);assert.equal(cancelled,1);
  const stopped=new AbortController();stopped.abort();assert.equal(await box.localVisionInfer('image','prompt',stopped.signal).catch(e=>e.name),'AbortError');assert.equal(timers.size,0);
  console.log('PASS: local vision cancellation clears timers/listeners and cannot cancel a subsequent frame.');
})().catch(e=>{console.error(e);process.exitCode=1;});
