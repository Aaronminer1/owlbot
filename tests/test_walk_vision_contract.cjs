const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/named-walk.js'),'utf8');
const code=source.slice(0,source.indexOf("$('#btnNamedWalkSave').onclick="));
const box={};vm.createContext(box);vm.runInContext(code,box);
const valid={path:'clear',floor_visible:true,evidence:'Nearby connected floor is open',target_near:false};
assert.equal(box.parseWalkingVisionReport(JSON.stringify(valid),{target:'bucket'}).path,'clear');
assert.equal(box.parseWalkingVisionReport('```json\n'+JSON.stringify(valid)+'\n```').path,'clear');
assert.equal(box.parseWalkingVisionReport('CLEAR').path,'clear');
for(const text of ['probably clear','CLEAR then BLOCKED','', 'null','[]','{"path":"clear"}',JSON.stringify({...valid,floor_visible:false}),JSON.stringify({...valid,target_near:'false'})])assert.throws(()=>box.parseWalkingVisionReport(text));
assert.throws(()=>box.parseWalkingVisionReport(JSON.stringify({...valid,target_near:true}),{target:'bucket'}),/not confirmed arrival/);
assert.throws(()=>box.parseWalkingVisionReport('TARGET',{target:'bucket',useLocal:true}),/not confirmed arrival/);
assert.throws(()=>box.parseWalkingVisionReport('BLOCKED'),/cannot proceed/);
assert.throws(()=>box.parseWalkingVisionReport('UNKNOWN'),/cannot proceed/);
// Exercise the real moving-path function with a mocked provider, camera and
// head state. No real robot command, model request or camera activation.
let payload;const video={videoWidth:480,videoHeight:640,srcObject:{getVideoTracks:()=>[{getSettings:()=>({facingMode:'user'})}]},requestVideoFrameCallback:cb=>setImmediate(cb),cancelVideoFrameCallback:()=>{}};
Object.assign(box,{Date,Promise,setTimeout,clearTimeout,HEAD:{generation:7},S:{cameraFacing:'front'},NW:{},
 $:id=>id==='#vid'?video:{value:id==='#walkForwardCamera'?'front':'configured-test',textContent:''},
 enableCamera:async()=>true,localVisionRoute:()=> 'cloud',localVisionReady:()=>false,grabFrameDataUrl:async()=> 'data:image/jpeg;base64,test',
 PROVIDERS:{},mindHeaders:()=>({}),mindFetch:async(url,opts)=>{payload=JSON.parse(opts.body);return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(valid)}}]})};}
});
(async()=>{
 const result=await box.checkNamedWalkPathAligned('forward',()=>{},null,{keepAligned:true,headGeneration:7,target:'bucket'});
 assert.equal(result.path,'clear');assert.equal(payload.max_tokens,350);assert.match(payload.messages[0].content[0].text,/Return ONLY JSON/);
 assert.match(payload.messages[0].content[0].text,/target_near/);
 box.mindFetch=async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'CLEAR'}}]})});
 await assert.rejects(box.checkNamedWalkPathAligned('forward',()=>{},null,{keepAligned:true,headGeneration:7}),/truncated/);
 console.log('PASS: consistent provider JSON in motion, local labels, target stop, malformed/ambiguous/truncated response rejection.');
})().catch(e=>{console.error(e);process.exitCode=1});
