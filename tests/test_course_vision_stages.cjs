const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/named-walk.js'),'utf8');
const code=source.slice(0,source.indexOf("$('#btnNamedWalkSave').onclick="));
let clock=1000,frame=0,replies=[],calls=[],route='local';
const video={videoWidth:480,videoHeight:640,srcObject:{getVideoTracks:()=>[{getSettings:()=>({facingMode:'user'})}]},requestVideoFrameCallback:cb=>setImmediate(cb),cancelVideoFrameCallback(){}};
const b={Date,Promise,setTimeout,clearTimeout,performance:{now:()=>++clock},HEAD:{generation:7},S:{cameraFacing:'front'},
 $:id=>id==='#vid'?video:{value:id==='#walkForwardCamera'?'front':'configured',textContent:''},enableCamera:async()=>true,
 localVisionRoute:()=>route,localVisionReady:()=>true,document:{createElement:()=>({getContext:()=>({drawImage(){}}),toDataURL:()=> 'frame-'+(++frame)})},
 localVisionInfer:async(image,prompt)=>{calls.push({image,prompt});clock+=1500;return {text:replies.shift()};}
};vm.createContext(b);vm.runInContext(code,b);
const options={keepAligned:true,headGeneration:7,target:'doorway mat',corridor:'bins left, tape right',courseCorrection:true};
(async()=>{
 replies=['LEFT','CLEAR'];let result=await b.checkNamedWalkPathAligned('forward',()=>{},null,options);
 assert.equal(result.steering,'left');assert.equal(result.path,'clear');assert.equal(calls.length,2);assert.notEqual(calls[0].image,calls[1].image);
 assert.match(calls[0].prompt,/image.*Route data/);assert.match(calls[1].prompt,/immediate connected floor/);
 assert(clock-result.capturedAt<2500,'grant clock belongs to NEW clearance image, not older heading image');
 for(const hazard of ['BLOCKED','UNKNOWN','TARGET']){calls=[];replies=['LEFT',hazard];await assert.rejects(b.checkNamedWalkPathAligned('forward',()=>{},null,options));assert.equal(calls.length,2);}
 calls=[];replies=['UNKNOWN'];await assert.rejects(b.checkNamedWalkPathAligned('forward',()=>{},null,options));assert.equal(calls.length,1);
 calls=[];replies=['CENTER','CLEAR'];result=await b.checkNamedWalkPathAligned('forward',()=>{},null,options);assert.equal(result.steering,undefined);
 calls=[];replies=['RIGHT','CLEAR'];let guarded=0;await assert.rejects(b.checkNamedWalkPathAligned('forward',()=>{if(calls.length===1&&++guarded>=1)throw Error('Owner Stop');},null,options),/Owner Stop/);assert.equal(calls.length,1);
 route='cloud';calls=[];replies=['CENTER',JSON.stringify({path:'clear',floor_visible:true,evidence:'Nearby floor is visibly clear'})];
 b.PROVIDERS={configured:{}};b.mindHeaders=()=>({});b.grabFrameDataUrl=async()=> 'cloud-frame-'+(++frame);
 b.mindFetch=async(url,opts)=>{calls.push({image:'cloud',prompt:JSON.parse(opts.body).messages[0].content[0].text});return {ok:true,json:async()=>({choices:[{message:{content:replies.shift()},finish_reason:'stop'}]})};};
 b.localVisionInfer=()=>assert.fail('Cloud-selected navigation must not silently use local inference');
 result=await b.checkNamedWalkPathAligned('forward',()=>{},null,options);assert.equal(result.path,'clear');assert.equal(calls.length,2);
 assert.equal(b.walkingUsesLocalVision('local',false),false);assert.equal(b.walkingUsesLocalVision('cloud',true),false);
 console.log('PASS: selected cloud/local navigation routes, separate fresh clearance, hazard/unknown/target priority and Stop between stages.');
})().catch(e=>{console.error(e);process.exitCode=1;});
