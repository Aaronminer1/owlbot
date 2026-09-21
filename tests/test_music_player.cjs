const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const OwlMusic=require('../app/src/main/assets/music-core.js');
const bytes=fs.readFileSync(__dirname+'/../app/src/main/assets/music/fur-elise.mid');
let clock=2000000,id=0,pause=[],nodes=[],fetchResolve,resumeResolve;
const timers=new Map(),elements=new Map();
const param=()=>({value:0,setValueAtTime(){},exponentialRampToValueAtTime(){}});
class AudioContext{
 constructor(){this.currentTime=0;this.state='running';}
 createGain(){return {gain:param(),connect(){},disconnect(){}};}
 createPeriodicWave(){return {};}
 createOscillator(){const n={frequency:param(),connect(){},disconnect(){},setPeriodicWave(){},start(t){this.startAt=t;},stop(t){this.endAt=t||0;}};nodes.push(n);return n;}
 resume(){return new Promise(r=>resumeResolve=r);}
}
const box={console,OwlMusic,Uint8Array,Float32Array,Date:{now:()=>clock},Math,JSON,Set,Map,Number,String,Error,
 localStorage:{getItem:()=>null,setItem(){}},window:{AudioContext},document:{hidden:false,addEventListener(){},getElementById:id=>elements.get(id)},
 setTimeout(fn,ms){timers.set(++id,{fn,at:clock+ms});return id;},clearTimeout(id){timers.delete(id);},
 fetch:async()=>({ok:true,arrayBuffer:async()=>bytes}),
 APP:{resting:false,settings:false},THERMAL:{paused:false},VOICE:{busy:false,holdMic:false,queue:[]},
 EARS:{handsFree:true,paused:false,on:false,handsFreeState:'listening'},NATIVE:{setMicPaused:v=>pause.push(v),setMelodyListening(){}},
 MIND:{on:true,voice:true,busy:false,lastHumanInputAt:0,userQueue:[]},S:{running:false},NW:{running:false},
 walkingStreamStatus:()=>({active:false}),socialInitiativeEnabled:()=>true,FACE:{set(){}},hush(){},caption(){},log(){}};
vm.createContext(box);vm.runInContext(fs.readFileSync(__dirname+'/../app/src/main/assets/music-player.js','utf8'),box);
const run=s=>vm.runInContext(s,box);
async function advance(seconds){
 for(let i=0;i<seconds*10;i++){
   clock+=100;run('if(MIDI_PLAYER.ctx)MIDI_PLAYER.ctx.currentTime+=.1');
   for(const n of nodes)if(n.endAt<=run('MIDI_PLAYER.ctx?.currentTime||0')&&!n.ended){n.ended=true;n.onended?.();}
   for(const [key,t] of [...timers])if(t.at<=clock){timers.delete(key);t.fn();}
   await Promise.resolve();
 }
}
(async()=>{
 const response=await run(`musicPlay({song:'fur_elise',instrument:'piano'})`);assert.match(response,/1041 notes/);
 assert.equal(run('MIDI_PLAYER.playing'),true);assert.equal(pause.at(-1),true);
 assert(nodes.length<25,'Rolling scheduler must not allocate the entire piece');
 await advance(91);assert(run('MIDI_PLAYER.playing'),'Must continue past old 90-second ceiling');
 await advance(66);assert.equal(run('MIDI_PLAYER.playing'),false);assert.equal(run('MIDI_PLAYER.scheduled'),1041);
 assert.equal(run('MIDI_PLAYER.lastResult.state'),'completed');
 assert.equal(pause.at(-1),false);assert.match(run('MUSIC.notice'),/Finished/);
 await run(`musicPlay({song:'fur_elise',instrument:'hum'})`);await advance(157);
 assert.equal(run('MIDI_PLAYER.scheduled'),541);assert.match(run('MUSIC.notice'),/Finished/);
 // A Stop during the fetch must cancel the pending start.
 run('MUSIC.cache=null');box.fetch=()=>new Promise(r=>fetchResolve=r);
 const loading=run(`musicPlay({song:'fur_elise'})`);run('musicStop()');fetchResolve({ok:true,arrayBuffer:async()=>bytes});await loading;
 assert.equal(run('MIDI_PLAYER.playing'),false);
 assert.equal(run('MIDI_PLAYER.lastResult.state'),'interrupted');
 // AudioContext resume has the same cancellation semantics.
 run(`MIDI_PLAYER.ctx.state='suspended'`);const resuming=run(`musicPlay({song:'fur_elise'})`);
 await Promise.resolve();run('musicHumanActivity()');resumeResolve();await resuming;assert.equal(run('MIDI_PLAYER.playing'),false);
 run(`MIDI_PLAYER.ctx.state='running'`);
 await run(`musicPlay({song:'fur_elise'})`);box.APP.resting=true;run('musicStop()');assert.equal(pause.at(-1),true,'Sleep must not reopen microphone');box.APP.resting=false;
 await run(`musicPlay({song:'fur_elise'})`);box.document.hidden=true;await advance(.2);assert.equal(run('MIDI_PLAYER.playing'),false);box.document.hidden=false;
 await run(`musicPlay({song:'fur_elise'})`);run('MIDI_PLAYER.ctx.currentTime+=4');await advance(.2);assert.match(run('MUSIC.notice'),/scheduling delay/);
 assert.equal(run(`musicHandleIntent("don't play Fur Elise")`),false);
 assert.equal(run(`musicHandleIntent('why do you play Fur Elise')`),false);
 run(`musicPreferences({favorite:'fur_elise',idle:true});MIND.lastHumanInputAt=Date.now()-200000;MUSIC.lastIdleAt=0;musicIdleTick()`);
 await Promise.resolve();await Promise.resolve();assert(run('MIDI_PLAYER.playing'));
 run('musicStop();musicIdleTick()');assert.equal(run('MIDI_PLAYER.playing'),false,'No idle replay loop');
 box.APP.resting=true;box.APP.settings=true;
 await assert.rejects(run(`musicPlay({song:'fur_elise'})`),/resting/);
 await run(`musicPlay({song:'fur_elise',preview:true})`);assert(run('MIDI_PLAYER.playing'),'Explicit Settings audio preview is allowed without waking the agent');
 assert.equal(box.APP.resting,true);assert.equal(run('MIDI_PLAYER.preview'),true);run('musicStop()');
 console.log('Music player: full piano/hum, bounded scheduling, fetch/resume cancellation, sleep/background, input, idle and timing interruption passed');
})().catch(e=>{console.error(e);process.exitCode=1});
