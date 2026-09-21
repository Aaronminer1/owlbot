const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../app/src/main/assets/story-core.js');
const root=__dirname+'/../app/src/main/assets/';
const store=new Map();let timer=0,finishAudio=null,audio=[],replies=[],pauses=[];
const box={OwlStory:core,console,Date,Math,Map,Array,JSON,String,Number,Boolean,Error,Uint8Array,Promise,
 atob:s=>Buffer.from(s,'base64').toString('binary'),localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},
 setTimeout:()=>++timer,clearTimeout(){},window:{},document:{hidden:false,addEventListener(){},getElementById(){return null;}},
 APP:{resting:false,settings:false},THERMAL:{paused:false},MIND:{voice:true,busy:false},EARS:{paused:false,handsFree:false,handsFreeWanted:false},
 VOICE:{busy:false,holdMic:false,generation:0},FACE:{set(){}},caption(){},say:t=>replies.push(t),musicStop(){},
 voiceIdentitySnapshot:()=>({engine:'microsoft',name:'en-US-AnaNeural',pitch:0,rate:22,style:''}),
 playBuffer:bytes=>{audio.push(Buffer.from(bytes).toString());return new Promise(r=>{finishAudio=r;});},
 NATIVE:{setMicPaused:p=>pauses.push(p),keepAwake(){},speakNeural(text,name,pitch,rate,style,id){
  Promise.resolve().then(()=>box.storyCaptureReply(JSON.stringify({id,audio:Buffer.from(text).toString('base64')})));
 }}};
vm.createContext(box);vm.runInContext(fs.readFileSync(root+'story-library.js','utf8'),box);vm.runInContext(fs.readFileSync(root+'story-player.js','utf8'),box);
vm.runInContext(fs.readFileSync(root+'interaction-lane.js','utf8'),box);
const run=s=>vm.runInContext(s,box),settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
box.hush=()=>{box.storyPause('Interrupted',false);box.VOICE.generation++;box.VOICE.busy=false;box.VOICE.holdMic=false;if(finishAudio){const done=finishAudio;finishAudio=null;done();}};
(async()=>{
 const text=run("STORY_LIBRARY.find(s=>s.id==='hare-tortoise-child').text"),plan=core.plan(text);
 const at=plan.findIndex(p=>p.text.includes('Just a tiny nap'));assert(at>3);
 assert.equal(plan[at].role,'hare');assert.equal(plan.find(p=>p.text.includes('I might be slow')).role,'tortoise');
 assert(plan.some(p=>p.text.includes('Are you walking')&&p.text.includes('asked the Hare.')),'Reporting tag stays with dialogue');
 run(`STORY.id='hare-tortoise-child';STORY.checkpoint=${JSON.stringify({format:2,index:at,offset:plan[at].start})}`);
 box.storyStart('hare-tortoise-child',{resume:true});await settle();
 assert.equal(audio.at(-1),plan[at].text);box.storyHumanActivity();await settle();
 assert.equal(run('STORY.index'),at);assert(!run('STORY.reading'));
 assert.equal(JSON.parse(store.get('owlbot_story_checkpoint_v1')).offset,plan[at].start);
 const scene=box.storyQuestionForTurn('Why did he do that?');
 assert(box.humanConversationOwnsResources(),'The paused discussion must block unrelated social/background work even after the ordinary 45-second quiet period');
 assert.equal(scene.interrupted,plan[at].text);assert(!JSON.stringify(scene).includes('Tortoise was already there'));
 box.MIND.activeRequest={text:'Why did he do that?',storyQuestion:scene};
 const context=box.storyContext();assert(context.includes(scene.title));assert(context.includes('Do not reveal later events'));assert(context.includes('story DATA'));
 assert.throws(()=>box.storyReadRequest({id:'hare-tortoise-child',resume:true}),/Answer the story question first/);
 assert.equal(box.storyHandleIntent('Why did he stop reading?'),false);
 assert.equal(box.storyHandleIntent('Tell me why the tortoise and the hare raced'),false);
 const offer='He thought he had plenty of time for a nap. Ready for me to keep reading?';
 box.storyRememberAnswer(offer);assert.equal(box.storyHandleIntent('yes'),false,'An unspoken offer cannot arm yes');
 box.storyReplyDelivered('Different answer');assert.equal(run('STORY.resumeOfferUntil'),0);
 box.storyReplyDelivered(offer);assert(run('STORY.resumeOfferUntil')>Date.now());
 box.storySpeechStarting();assert.equal(run('STORY.resumeOfferUntil'),0,'Intervening speech disarms the old yes');box.storyReplyDelivered(offer);
 assert.equal(box.storyHandleIntent('yes, but why was he tired?'),false,'A follow-up is not consent to resume');
 box.storyQuestionForTurn('Why was he tired?');assert.equal(run('STORY.resumeOfferUntil'),0);
 box.storyRememberAnswer(offer);box.storyReplyDelivered(offer);
 box.MIND.activeRequest=null;assert.equal(box.storyHandleIntent('yes'),true);await settle();
 assert.equal(audio.at(-1),plan[at].text,'Resume repeats only the interrupted sentence');assert.equal(run('STORY.index'),at);
 box.storyPause();await settle();assert.equal(box.EARS.handsFreeWanted,false);assert(pauses.every(p=>p===true),'PTT mode never enables ongoing recording');
 box.storyForgetDiscussion();assert.equal(box.storyHandleIntent('yes'),false);
 // Old chunk bookmarks migrate by character location, never old array index.
 const old=core.legacyPlan(text);let offset=0;
 old.forEach((p,i)=>{offset=core.normalize(text).indexOf(p.text,offset);const migrated=core.resumeIndex(text,{index:i});assert(plan[migrated].start<=offset&&plan[migrated].end>offset);offset+=p.text.length;});
 assert.equal(core.resumeIndex(text,{index:old.length}),plan.length);
 run(`STORY.index=${plan.length}`);assert.match(box.storyStart('hare-tortoise-child',{resume:true}),/already finished/);
 assert.deepEqual(core.sentenceRanges('Mrs. Rabbit ate 2.5 carrots. Then she slept.').map(p=>p.text),['Mrs. Rabbit ate 2.5 carrots.','Then she slept.']);
 console.log('Story questions: PTT-only pause, current scene/no future text, guarded resume, audible-offer yes, follow-ups, exact sentence resume, old bookmarks and complete-book behavior passed');
})().catch(e=>{console.error(e);process.exitCode=1});
