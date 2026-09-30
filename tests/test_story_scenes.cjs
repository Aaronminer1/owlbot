const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root=__dirname+'/../app/src/main/assets/';
const OwlStory=require(root+'story-core.js'),html=fs.readFileSync(root+'growbot-brain.html','utf8');
const stored=new Map(),spoken=[],faces=[];let hold=false,release,fail=false;
const box={OwlStory,console,Date,Math,Map,Set,Array,JSON,String,Number,Boolean,Error,Promise,Uint8Array,AbortController,
 localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},
 setTimeout,clearTimeout,window:{},document:{hidden:false,addEventListener(){},getElementById(){return null;}},
 APP:{resting:false,settings:false},THERMAL:{paused:false},MIND:{voice:true},EARS:{paused:true},
 VOICE:{speaking:false,busy:false,holdMic:false,generation:0},FACE:{set(){}},caption(){},say(){},musicStop(){},now:()=>Date.now(),
 voiceIdentitySnapshot:()=>({engine:'device',pitch:0,rate:0}),NATIVE:{setMicPaused(){},keepAwake(){}}};
vm.createContext(box);
vm.runInContext(html.slice(html.indexOf('const EXPRESSIONS ='),html.indexOf('const AFFECT=')),box);
for(const file of ['story-library.js','story-scenes.js','story-player.js'])vm.runInContext(fs.readFileSync(root+file,'utf8'),box);
// Transport review is exercised separately in test_story_review; this test
// isolates full playback and cancellation with an approved narration plan.
box.prepareStoryPerformance=async(story,parts)=>parts;
const run=s=>vm.runInContext(s,box),settle=async()=>{for(let i=0;i<1000;i++)await Promise.resolve();};
box.hush=()=>{box.storyPause('Interrupted',false);box.VOICE.speaking=false;box.VOICE.busy=false;box.VOICE.holdMic=false;if(release){release();release=null;}};
box.sayDevice=async text=>{
 box.VOICE.speaking=true;spoken.push(text);faces.push(box.storyFaceState());
 if(hold)await new Promise(r=>{release=r;});
 box.VOICE.speaking=false;if(fail)throw Error('audio failed');
};
const draft={title:'The Surprise Parcel',scenes:[
 {text:'There was a mysterious parcel by the door.',emotion:'curious',reason:'The narrator wonders what arrived.'},
 {text:'A scary wolf was on the label, but it was just a silly picture. We laughed.',emotion:'amused',reason:'The supposedly scary picture is harmless and funny, not unresolved danger.'},
 {text:'Inside was a tiny rubber chicken. We laughed even harder.',emotion:'amused',reason:'The same shared joke continues; no forced change is needed.'},
 {text:'We put it away, happy with our little surprise. The end.',emotion:'content',reason:'The adventure ends peacefully.'}]};
(async()=>{
 assert.equal(box.narrativeTool().function.name,'narrate_story');
 const story=box.validateNarrative(draft),plan=box.storyScenePlan(story);
 assert.equal(plan.map(p=>p.text).join(' '),story.text);
 assert.deepEqual(Array.from(plan,p=>p.emotion),['curious','amused','amused','content']);
 assert.throws(()=>box.validateNarrative({...draft,scenes:[{...draft.scenes[0],emotion:'made-up'},draft.scenes[1]]}),/Invalid/);
 assert.throws(()=>box.validateNarrative({...draft,scenes:[{...draft.scenes[0],reason:''},draft.scenes[1]]}),/Invalid/);
 assert.throws(()=>box.validateNarrative({...draft,scenes:[{...draft.scenes[0],emotion:'humming'},draft.scenes[1]]}),/Invalid/,'Narration must not imply actual music');
 assert.equal(box.storyHandleIntent('Tell me an original story about a parcel'),false);
 hold=true;box.narrateStory(draft);await settle();
 assert.equal(box.storyFaceState().emotion,'curious');
 run('STORY.activeFace.createdAt=Date.now()-60000');
 assert.equal(box.storyFaceState().emotion,'curious','An audio-owned expression cannot expire halfway through a passage');
 box.VOICE.speaking=false;assert.equal(box.storyFaceState(),null,'No expression claims speech during synthesis');box.VOICE.speaking=true;
 box.storyPause();assert.equal(box.storyFaceState(),null);await settle();assert.equal(run('STORY.index'),0);
 assert.equal(run('STORY.checkpoint.format'),3);
 hold=false;spoken.length=0;faces.length=0;box.storyStart('original-current',{resume:true});await settle();
 assert.equal(run('STORY.lastResult.state'),'completed');
 assert.equal(spoken.join(' '),story.text,'Every passage including the ending is delivered without tool round limits');
 assert.deepEqual(faces.map(f=>f.emotion),['curious','amused','amused','content']);
 assert.equal(box.storyFaceState(),null);assert.equal(run('STORY.activeFace'),null);
 assert(!spoken.some(t=>t.includes('narrator wonders')),'Silent appraisal reasons are never spoken');
 hold=true;box.narrateStory(draft);await settle();box.storyPause();await settle();
 run('STORY.segments=[];STORY.checkpoint.index=2');hold=false;spoken.length=0;
 box.storyStart('original-current',{resume:true});await settle();
 assert.equal(spoken.join(' '),draft.scenes.slice(2).map(s=>s.text).join(' '),'Scene checkpoint survives reconstruction');
 fail=true;box.narrateStory(draft);await settle();assert.equal(run('STORY.lastResult.state'),'paused');assert.equal(box.storyFaceState(),null);assert.equal(run('STORY.index'),0);fail=false;
 // Preflight failure and late completion must never emit narration audio.
 const notices=[];box.say=t=>notices.push(t);spoken.length=0;
 box.prepareStoryPerformance=async()=>{throw Error('Story needs revision before playback: unsafe advice');};
 box.narrateStory(draft);await settle();assert.equal(spoken.length,0);assert.equal(notices.length,1);assert.equal(run('STORY.reading'),false);
 let reviewDone;box.prepareStoryPerformance=(story,parts)=>new Promise(r=>reviewDone=()=>r(parts));
 box.narrateStory(draft);box.storyPause();reviewDone();await settle();assert.equal(spoken.length,0);
 box.prepareStoryPerformance=async(story,parts)=>parts;
 const previous=stored.get('owlbot_original_story_v1');box.APP.resting=true;assert.throws(()=>box.narrateStory(draft),/Wake/);assert.equal(stored.get('owlbot_original_story_v1'),previous);
 assert(html.indexOf('if(narration)return narration;')<html.indexOf('if(VOICE.speaking){',html.indexOf('function contextualFaceState')));
 assert(html.includes("calls.some(c=>['narrate_story','read_story'].includes(c.function.name))&&STORY.reading"));
 console.log('Scene narration passed: model-selected repeated/contextual emotions, full text, audio ownership, cancellation, errors, resume, no spoken metadata.');
})().catch(e=>{console.error(e);process.exitCode=1});
