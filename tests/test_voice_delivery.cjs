const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=__dirname+'/../app/src/main/assets/';
const html=fs.readFileSync(root+'growbot-brain.html','utf8');
let clock=100000,release,fail=false,records=[],questions=[],delivered=[],games=[];
const b={console,Map,Date:{now:()=>clock},setTimeout,clearTimeout,Promise,
 window:{},APP:{resting:false,settings:false},THERMAL:{paused:false},thermalSerious:()=>false,
 MIND:{voice:true,activeRequest:{}},EARS:{on:true,paused:true,handsFreeState:'off'},
 SELF:{tuning:{repeatWindowSeconds:60,repeatSimilarity:.9}},MIDI_PLAYER:{playing:false},
 AFFECT:{emotion:'empathetic',reason:'Responding thoughtfully'},FACE:{talkStart(){},talkEnd(){}},
 spokenReply:t=>t,caption(){},replySimilarity:()=>0,log(){},now:()=>clock,
 recordSpokenModelReply:(text,kind)=>records.push({text,kind}),rememberSpokenQuestion:t=>questions.push(t),
 rememberDeliveredSpeech:(t,g)=>{delivered.push(t);if(g)games.push(g);},
 NATIVE:{},speechSynthesis:{cancel(){}},$:()=>({textContent:''})};
vm.createContext(b);
vm.runInContext(html.slice(html.indexOf('const VOICE = {'),html.indexOf('let captionTimer = null;')),b);
const run=s=>vm.runInContext(s,b),settle=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
b.waitForHumanSpeechBeforePlayback=async()=>{if(b.EARS.on)await new Promise(r=>release=r);};
b.speakVoiceChunk=async()=>{await b.waitForHumanSpeechBeforePlayback();b.window.onSpeechStart();if(fail)throw Error('test voice failure');await new Promise(r=>release=r);b.window.onSpeechEnd();};
(async()=>{
 assert.equal(b.say('An answer.',{allowRepeat:true,replyKind:'reply',privateGame:{action:'start',answer:'blue'}}),true);
 await settle();assert.equal(run('VOICE.lastDelivery.state'),'preparing');assert.equal(records.length,0);assert.equal(questions.length,0);assert.equal(delivered.length,0);
 b.EARS.on=false;release();await settle();assert.equal(run('VOICE.lastDelivery.state'),'playing');
 clock+=30000;assert.equal(run('VOICE.activeDelivery.emotion'),'empathetic','Expression belongs to playback, not an expired affect lease');
 release();await settle();assert.equal(run('VOICE.lastDelivery.state'),'completed');assert.equal(records.length,1);assert.equal(questions.length,1);assert.equal(run('VOICE.activeDelivery'),null);
 assert.deepEqual(delivered,['An answer.']);
 assert.equal(games.length,1);assert.equal(games[0].answer,'blue');
 fail=true;b.say('A failed answer.',{allowRepeat:true,replyKind:'reply'});await settle();
 assert.equal(run('VOICE.lastDelivery.state'),'failed');assert.equal(records.length,1);assert.equal(run('VOICE.activeDelivery'),null);assert.equal(run('VOICE.speaking'),false);
 fail=false;b.say('A cancelled answer.',{allowRepeat:true,replyKind:'reply',privateGame:{action:'finish'}});await settle();
 b.hush();release();await settle();assert.equal(run('VOICE.lastDelivery.state'),'cancelled');assert.equal(records.length,1);assert.equal(run('VOICE.activeDelivery'),null);
 assert.deepEqual(delivered,['An answer.'],'failed and cancelled playback never become shared spoken history');
 assert.equal(games.length,1,'cancelled speech cannot end a game');
 // Exercise the actual contextual face selector with expired global affect.
 Object.assign(b,{S:{phonePower:{levelPercent:80}},BATT:{},AMBIENT:{},BACKGROUND:{},EARS:{partialAt:0},musicFaceState:()=>null,storyFaceState:()=>null,faceAffectFresh:()=>false,groundedFaceEmotion:e=>e});
 vm.runInContext(html.slice(html.indexOf('function contextualFaceState(){'),html.indexOf('function currentAffectSnapshot(){')),b);
 run("VOICE.speaking=true;VOICE.activeDelivery={emotion:'empathetic',reason:'the actual reply'}");
 assert.equal(b.contextualFaceState().emotion,'empathetic');
 console.log('PASS voice delivery: capture overlap queues, completion-only records, playback-owned expression, failure and cancellation cleanup.');
})().catch(e=>{console.error(e);process.exitCode=1});
