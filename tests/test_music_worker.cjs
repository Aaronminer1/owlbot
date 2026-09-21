const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/../app/src/main/assets/growbot-brain.html','utf8');
const start=html.indexOf('function waitForMidiWorker('),end=html.indexOf('async function runBackgroundJob(',start);
let clock=0,check;
const state={playing:true,duration:156.25,generation:20};
const box={MIDI_PLAYER:state,Date:{now:()=>clock},Math,Promise,setInterval(fn){check=fn;return 1;},clearInterval(){check=null;}};
vm.createContext(box);vm.runInContext(html.slice(start,end),box);
(async()=>{
 let finished=false;const wait=box.waitForMidiWorker(20,{}).then(x=>{finished=true;return x;});
 clock=100000;check();await Promise.resolve();assert.equal(finished,false,'95-second deadline cannot complete a full piece');
 state.playing=false;state.generation=21;state.lastResult={generation:20,state:'completed'};check();assert.equal((await wait).state,'completed');
 state.playing=true;state.generation=22;
 const cancelled=box.waitForMidiWorker(22,{aborted:true});check();assert.equal((await cancelled).state,'interrupted');
 const superseded=box.waitForMidiWorker(22,{});state.generation=23;check();assert.equal((await superseded).state,'interrupted');
 assert.match(html,/if\(usedMidi\)break/,'No extra model/composition loop after playback starts');
 assert.match(html,/job.status='cancelled'[\s\S]{0,180}Music interrupted; not replayed/);
 console.log('Music worker: full-length deadline, true completion, cancellation and supersession passed');
})().catch(e=>{console.error(e);process.exitCode=1});
