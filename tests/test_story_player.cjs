const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const OwlStory=require('../app/src/main/assets/story-core.js');
const source=fs.readFileSync(__dirname+'/../app/src/main/assets/story-player.js','utf8');
let serial=0,fail=false,hold=false,played=[],requests=[],timers=new Map(),paused=[];
const stored=new Map(),base={engine:'microsoft',name:'en-US-AnaNeural',pitch:0,rate:22,style:''};
const box={OwlStory,console,Date,Math,Map,Array,JSON,String,Number,Boolean,Error,Uint8Array,Promise,now:()=>12345,
 atob:s=>Buffer.from(s,'base64').toString('binary'),localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},
 setTimeout(fn){timers.set(++serial,fn);return serial;},clearTimeout(id){timers.delete(id);},
 window:{},document:{hidden:false,addEventListener(){},getElementById(){return null;}},
 APP:{resting:false,settings:false},THERMAL:{paused:false},MIND:{voice:true},EARS:{paused:false,handsFree:true},
 VOICE:{busy:false,holdMic:false,generation:0},FACE:{set(){}},caption(){},say(){},musicStop(){},
 voiceIdentitySnapshot:()=>({...base}),playBuffer:async bytes=>{played.push(Buffer.from(bytes).toString('utf8'));box.VOICE.holdMic=false;},sayDevice:async text=>played.push(text),
 NATIVE:{setMicPaused:p=>paused.push(p),keepAwake(){},speakNeural(text,name,pitch,rate,style,id){
   requests.push({text,name,pitch,rate,id});if(hold)return;
   Promise.resolve().then(()=>box.storyCaptureReply(JSON.stringify(fail?{id,error:'network unavailable'}:{id,audio:Buffer.from(text).toString('base64')}),fail));
 }}};
vm.createContext(box);vm.runInContext(fs.readFileSync(__dirname+'/../app/src/main/assets/story-library.js','utf8'),box);vm.runInContext(source,box);
box.hush=()=>{box.storyPause('Interrupted',false);box.VOICE.generation++;box.VOICE.busy=false;box.VOICE.holdMic=false;};
const run=s=>vm.runInContext(s,box);
async function settle(){for(let i=0;i<2000;i++)await Promise.resolve();}
(async()=>{
 box.storyStart('velveteen-rabbit');await settle();
 assert.equal(run('STORY.reading'),false);assert.equal(run('STORY.lastResult.state'),'completed');
 const text=run("STORY_LIBRARY.find(s=>s.id==='velveteen-rabbit').text");
 assert.equal(played.join('').replace(/\s/g,''),text.replace(/\s/g,''),'Every word of the longest book reaches playback, not a summary');
 assert.equal(run('STORY.index'),run('STORY.segments.length'));assert(requests.length>30);
 assert.equal(box.MIND.lastSpoke,12345,'Finished narration starts the ordinary social speech cooldown');
 assert(requests.every(r=>r.name===base.name&&r.rate<base.rate));
 assert.equal(base.pitch,0);assert.equal(base.rate,22);assert.equal(paused.at(-1),false);
 // Stop before synthesis returns: late audio cannot advance/restart the story.
 hold=true;played=[];requests=[];box.storyStart('goldilocks');const pending=requests[0];box.storyPause();
 box.storyCaptureReply(JSON.stringify({id:pending.id,audio:Buffer.from(pending.text).toString('base64')}));await settle();
 assert.equal(played.length,0);assert.equal(run('STORY.index'),0);assert(!run('STORY.reading'));
 hold=false;fail=true;requests=[];box.storyStart('hare-tortoise');await settle();
 assert(!run('STORY.reading'));assert.equal(run('STORY.index'),0);assert.equal(requests.length,2,'Only one same-passage retry');
 fail=false;played=[];box.storyStart('hare-tortoise',{resume:true});await settle();assert.equal(run('STORY.lastResult.state'),'completed');
 // Resume at passage 2; no beginning replay, no omitted ending.
 run("STORY.id='peter-rabbit';STORY.index=2");played=[];box.storyStart('peter-rabbit',{resume:true});await settle();
 assert.equal(played.join('').replace(/\s/g,''),run("STORY.segments.slice(2).map(p=>p.text).join('').replace(/\\s/g,'')"));
 assert.throws(()=>{box.APP.resting=true;box.storyStart('hare-tortoise');},/Wake/);
 box.APP.settings=true;box.storyStart('fox-grapes',{preview:true});await settle();assert.equal(run('STORY.lastResult.state'),'completed');assert(box.APP.resting);
 box.APP.resting=false;box.APP.settings=false;run('STORY.comfortUntil=Date.now()+120000');
 assert.throws(()=>box.storyStart('three-pigs'),/gentle/);box.storyStart('hare-tortoise');await settle();
 const before=JSON.stringify(base);assert.equal(box.emotionalVoiceIdentity(base,'excited').pitch,-1,'Comfort suppresses excited delivery');assert.equal(JSON.stringify(base),before);
 run('STORY.comfortUntil=0');assert.equal(box.emotionalVoiceIdentity(base,'excited').pitch,9);
 assert.equal(box.emotionalVoiceIdentity(base,'sad').pitch,-7);
 // A cancelled Settings preview cannot play a synthesis result that arrives late.
 box.APP.resting=true;box.APP.settings=true;hold=true;played=[];requests=[];
 const preview=box.storyVoicePreview('excited').catch(e=>e.message);
 const sample=requests[0];box.storyPause();
 box.storyCaptureReply(JSON.stringify({id:sample.id,audio:Buffer.from(sample.text).toString('base64')}));
 await preview;await settle();assert.equal(played.length,0);assert(!run('STORY.reading'));
 // Android completion belongs to one id AND generation, never a stale passage.
 let tagged;
 box.NATIVE.speakTagged=(text,id)=>{tagged=id;};
 box.window.onSpeechStart=()=>{};box.window.onSpeechEnd=()=>{};
 let done=false;const local=box.deviceSpeakTagged('A complete passage.',base).then(()=>{done=true;});
 box.window.onNativeDeviceSpeech('voice-old|done');await Promise.resolve();assert(!done);
 box.window.onNativeDeviceSpeech(tagged+'|done');await local;assert(done);assert.equal(box.VOICE.deviceRequest,null);
 // Every adaptation reaches playback in full, including the long Rabbit story.
 hold=false;box.APP.resting=false;box.APP.settings=false;
 for(const id of run("STORY_LIBRARY.filter(s=>s.kind==='child').map(s=>s.id)")){
   played=[];box.storyStart(id);await settle();
   assert.equal(run('STORY.lastResult.state'),'completed',id);
   assert.equal(played.join('').replace(/\s/g,''),run(`STORY_LIBRARY.find(s=>s.id===${JSON.stringify(id)}).text`).replace(/\s/g,''));
 }
 // Both the short intent path and the model tool default to retellings.
 hold=true;
 box.storyHandleIntent('tell me the tortoise and the hare');assert.equal(run('STORY.id'),'hare-tortoise-child');box.storyPause();
 box.storyHandleIntent('read the original tortoise and hare');assert.equal(run('STORY.id'),'hare-tortoise');box.storyPause();
 box.storyHandleIntent('tell me a bedtime story');assert.equal(run('STORY.id'),'hare-tortoise-child');box.storyPause();
 box.storyReadRequest({id:'goldilocks'});assert.equal(run('STORY.id'),'goldilocks-child');box.storyPause();
 box.storyReadRequest({id:'goldilocks-child',historical:true});assert.equal(run('STORY.id'),'goldilocks');box.storyPause();
 run('STORY.index=2');box.storyReadRequest({id:'goldilocks-child',resume:true});assert.equal(run('STORY.id'),'goldilocks');assert.equal(run('STORY.index'),2);box.storyPause();
 assert.throws(()=>box.storyReadRequest({id:'peter-rabbit',resume:true}),/different story/);
 await settle();
 console.log('Story player: full longest text, bounded retry, interruption/late callbacks, saved-place resume, sleep/preview, comfort and immutable voice passed');
})().catch(e=>{console.error(e);process.exitCode=1});
