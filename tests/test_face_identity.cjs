const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync(__dirname+'/../app/src/main/assets/face-identity.js','utf8');
let clock=100000,spoken=[],saved={},failSave=false;
const box={console,Math,Date,Map,Number,Boolean,String,Array,Error,JSON,now:()=>clock,setInterval:()=>0,setTimeout:()=>1,clearTimeout:()=>{},
 document:{createElement:()=>({getContext:()=>({})})},window:{},$:()=>null,APP:{resting:false,settings:false},S:{camOK:true,cameraFacing:'front'},
 MEM:{people:{},currentPerson:null},MIND:{busy:false,on:true},VOICE:{busy:false},EARS:{on:false,handsFreeState:'off'},PERCEPTION:{busy:false,abort:{abort:()=>{}}},NW:{running:false},
 localStorage:{getItem:k=>saved[k]||null,setItem:(k,v)=>{if(failSave)throw Error('full');saved[k]=v;}},
 say:t=>spoken.push(t),memSave:()=>{},needsAgentOnboarding:()=>false,enableCamera:()=>true,thermalModerate:()=>false,
 BEING:{identity:{name:'Andrew'}},NATIVE:{analyzeLocalFace:()=>assert.fail('unexpected native request')}};
vm.createContext(box);vm.runInContext(src,box);const id=vm.runInContext('IDENT',box);id.enabled=true;
const vec=(index=0)=>Array.from({length:128},(_,i)=>i===index?1:0),a=vec(),b=vec(1);
const observe=(v=a,count=1)=>{clock+=1600;box.identityObserve({engine:'sface-2021dec-v1',quality:count===1?'good':'one_person_only',count,embedding:v,elapsedMs:20});};
assert.equal(box.validFaceVector(a),true);assert.equal(box.validFaceVector([1,2]),false);
assert.equal(box.validFaceVector(a.map(()=>NaN)),false);
for(const no of ['okay, do not save my face','yes, no thanks','no','not now','do not remember my face','sure why not'])assert.equal(box.faceConsentAnswer(no),false,no);
for(const ambiguous of ['yes','okay','maybe later','yes remember his face','yesterday I said yes'])assert.equal(box.faceConsentAnswer(ambiguous),null,ambiguous);
assert.equal(box.faceConsentAnswer('Yes, remember my face!'),true);
assert.equal(box.beginFaceEnrollment('Aaron'),false,'direct enrollment cannot bypass consent');
observe();observe();observe();assert(id.awaitingName,'Andrew initiates introduction after stable unknown face');
box.handleIdentityReply('My name is Aaron');assert(id.awaitingConsent);assert.equal(id.profiles.length,0);assert.equal(box.MEM.currentPerson,null);
box.handleIdentityReply('okay, do not save my face');assert(!id.enrolling);assert(!id.awaitingConsent);assert.equal(Object.keys(saved).length,0,'decline persists no biometric data');
assert(box.requestFaceConsent('Aaron'));box.handleIdentityReply('yes');assert(!id.enrolling,'a bare yes is ambiguous');
box.handleIdentityReply('yes, remember my face');assert(id.enrolling);
observe(a,2);assert(!id.enrolling);assert.equal(id.profiles.length,0,'multiple faces cancel, not pick first face');
observe();assert(box.requestFaceConsent('Aaron'));observe(b);assert(!id.awaitingConsent,'person changing during consent cancels');
observe();assert(box.requestFaceConsent('Aaron'));box.handleIdentityReply('yes remember my face');observe();box.handleIdentityReply('stop');assert(!id.enrolling);assert.equal(id.profiles.length,0);
observe();assert(box.requestFaceConsent('Aaron'));box.handleIdentityReply('yes remember my face');
observe(a,0);assert(id.enrolling,'one missed frame pauses, not cancels');observe();assert(id.enrolling,'the same face may resume');
observe(b);assert(!id.enrolling,'a different returning face cancels');
observe();assert(box.requestFaceConsent('Aaron'));box.handleIdentityReply('yes remember my face');
for(let i=0;i<8;i++)observe();assert.equal(id.profiles.length,1);assert.equal(id.profiles[0].templates.length,8);
assert.equal(box.verifiedIdentity(),null,'saving enrollment is not independent recognition');
observe();observe();assert.equal(box.verifiedIdentity(),null);observe();assert.equal(box.verifiedIdentity().name,'Aaron');
assert.equal(box.MEM.currentPerson,id.profiles[0].id,'stable person ID, not fuzzy name merge');
assert(!box.requestFaceConsent('Aaron'),'existing profile cannot be overwritten by a claimed name');
observe(b);assert.equal(box.verifiedIdentity(),null,'different face is immediately unknown');
id.profiles.push({...id.profiles[0],id:'other',name:'Alex'});assert.equal(box.matchFace(a),null,'ambiguous equal matches remain unknown');id.profiles.pop();
const legacy={...id.profiles[0],engine:'pixels-v3'};assert.equal(box.validFaceProfile(legacy),false);
const noConsent={...id.profiles[0],consent:null};assert.equal(box.validFaceProfile(noConsent),false);
const personId=id.profiles[0].id;assert(box.forgetFaceProfile(personId));assert.equal(id.profiles.length,0);assert(box.MEM.people[personId],'face deletion does not delete conversation/person memory');
observe();assert(box.requestFaceConsent('Other'));box.handleIdentityReply('yes remember my face');failSave=true;
for(let i=0;i<8;i++)observe();assert.equal(id.profiles.length,0,'storage failure must not claim successful enrollment');failSave=false;
id.enabled=true;box.S.cameraFacing='back';
(async()=>{await box.detectFaceNative();assert.match(id.quality,/looking behind/);assert.equal(id.lastDescriptor,null);
 console.log('PASS: explicit consent, no-overwrite, canceled/changed/multiple faces, eight-sample enrollment, independent recognition, unknown/ambiguous rejection, local deletion, storage failure, front-only identity.');
})().catch(e=>{console.error(e);process.exitCode=1});
