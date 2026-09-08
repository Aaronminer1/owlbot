const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=__dirname+'/../app/src/main/assets/',src=fs.readFileSync(root+'face-identity.js','utf8'),html=fs.readFileSync(root+'growbot-brain.html','utf8');
let clock=100000,spoken=[],affects=[],chirps=[];
const saved={};
const box={Math,Date:class extends Date{static now(){return clock}},Map,now:()=>clock,setInterval:()=>0,setTimeout:()=>1,clearTimeout:()=>{},
 document:{createElement:()=>({getContext:()=>({})})},window:{},$:()=>null,APP:{resting:false,settings:false},S:{camOK:true,cameraFacing:'front'},
 MEM:{people:{},currentPerson:null},MIND:{busy:false,on:true},VOICE:{busy:false},EARS:{on:false,handsFreeState:'off'},PERCEPTION:{busy:false},NW:{running:false},
 localStorage:{getItem:k=>saved[k]||null,setItem:(k,v)=>saved[k]=v},say:t=>spoken.push(t),setAffect:(...a)=>affects.push(a),
 memSave:()=>{},needsAgentOnboarding:()=>false,enableCamera:()=>true,thermalModerate:()=>false,BEING:{identity:{name:'Andrew'}},NATIVE:{},
 FACE:{lastTouch:0,set:(...a)=>affects.push(a)},chirp:t=>chirps.push(t),LIFE:{company:0},SEEN:{present:true},SELF:{tuning:{identityAskSeconds:10}},clamp:(v,a,b)=>Math.min(b,Math.max(a,v))};
vm.createContext(box);vm.runInContext(src,box);
vm.runInContext(html.slice(html.indexOf('function onSomeoneArrived(){'),html.indexOf('let lastRGBA = null;')),box);
const id=vm.runInContext('IDENT',box),vec=i=>Array.from({length:128},(_,n)=>n===i?1:0);
const profile=(name,i)=>({id:name.toLowerCase(),personKey:name.toLowerCase(),name,engine:'sface-2021dec-v1',consent:{granted:true},templates:Array.from({length:8},()=>vec(i)),lastSeen:0,matches:0});
id.enabled=true;id.profiles=[profile('Aaron',0),profile('Alex',1)];
saved.owlbot_face_recognition_enabled_v1='true';
const observe=(i,count=1)=>{clock+=1600;box.identityObserve({engine:'sface-2021dec-v1',quality:count===1?'good':'no_face',count,embedding:vec(i),elapsedMs:20});};
const match=i=>{observe(i);observe(i);observe(i);};
box.onSomeoneArrived();match(0);
assert.equal(box.verifiedIdentity().name,'Aaron');assert.equal(box.MEM.currentPerson,'aaron');
assert.equal(spoken.length,0,'first recognition is silent');assert.equal(chirps.length,0);assert.equal(affects.length,0);
const visits=box.MEM.people.aaron.times;
for(let i=0;i<50;i++)observe(0);
observe(0,0);box.onSomeoneLeft();assert.equal(box.verifiedIdentity(),null,'do not fake visual certainty during a dropout');
box.onSomeoneArrived();match(0);
assert.equal(box.MEM.people.aaron.times,visits,'a brief dropout after a long encounter is not a new visit');
assert.equal(spoken.length,0,'reacquisition cannot greet again');assert.equal(affects.length,0,'recognition cannot overwrite a contextual expression');
observe(1);assert.equal(box.verifiedIdentity(),null);assert.equal(box.MEM.currentPerson,null,'new identity needs its own stable match');
observe(1);observe(1);assert.equal(box.verifiedIdentity().name,'Alex');assert.equal(box.MEM.currentPerson,'alex');assert.equal(spoken.length,0);
match(0);assert.equal(box.MEM.currentPerson,'aaron');assert.equal(spoken.length,0,'switching among two known profiles is silent');
clock+=60000;box.onSomeoneLeft();box.onSomeoneArrived();match(0);assert.equal(spoken.length,0,'even a real return is not an automatic speech event');
// Reloading stored profiles does not introduce a greeting side effect.
box.faceSave();box.clearFaceVerification();box.faceLoad();match(0);assert.equal(box.verifiedIdentity().name,'Aaron');assert.equal(spoken.length,0);
// Genuine unknown people remain unknown, and enrollment is still consent-first.
clock+=130000;box.onSomeoneLeft();box.onSomeoneArrived();match(2);
assert.equal(box.verifiedIdentity(),null);assert.equal(box.MEM.currentPerson,null);
assert(id.awaitingName);assert.equal(spoken.length,1,'unknown introduction remains separate from matching known profiles');
box.handleIdentityReply('My name is Casey');assert(id.awaitingConsent);box.handleIdentityReply('No, do not save my face');assert(!id.enrolling);assert.equal(id.profiles.length,2);
assert.match(html,/Respond naturally when a person actually greets you/);
assert.match(fs.readFileSync(root+'executive-context.js','utf8'),/SILENT RECOGNITION/);
assert.match(fs.readFileSync(root+'social-initiative.js','utf8'),/face-recognition update is silent context/);
assert(!html.includes('say("Hello again.")'),'restoring the app cannot create a second independent hello loop');
console.log('PASS: silent initial/repeated/return/reload matching, distinct known identities, honest unknown state, stable visit count, no chirps/affect interruption, consent-first unknown enrollment, ordinary greetings preserved.');
