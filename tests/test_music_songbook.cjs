const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const OwlMusic=require('../app/src/main/assets/music-core.js');
const source=fs.readFileSync(__dirname+'/../app/src/main/assets/music-player.js','utf8');
const storage=new Map();
function world(){
 const box={console,OwlMusic,window:{},document:{hidden:false,addEventListener(){},getElementById(){}},
   localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
   MIND:{lastHumanInputAt:100},BACKGROUND:{jobs:[],running:new Map()},backgroundSave(){},
   APP:{resting:false},EARS:{},VOICE:{},clearTimeout(){},log(){}};
 vm.createContext(box);vm.runInContext(source,box);return box;
}
const box=world(),songs=[];
for(let seed=1;seed<=100;seed++){
 const p=OwlMusic.improvise(seed,seed%2?'playful':'gentle');
 const s=box.musicGeneratedScore(p);songs.push(JSON.stringify(p.events));
 assert(s.duration>=15&&s.duration<=30);assert(s.notes.length>40);assert(p.events.length<=160);
 assert.equal(p.events.at(-1).notes[1]-p.events.at(-1).notes[0],12,'Tonic octave ending');
 assert.deepEqual(OwlMusic.improvise(seed,seed%2?'playful':'gentle'),p,'Seeds preserve exact notes');
}
assert(new Set(songs).size>95,'Improvisations vary');
const one=OwlMusic.improvise(123,'mysterious'),id=box.musicRememberComposition({...one,_procedural:true});
assert.equal(box.musicCompositions().length,1);assert.equal(box.musicRememberComposition(one),id);
assert.equal(box.musicCompositions()[0].origin,'offline improvisation');
const reloaded=world();assert.equal(reloaded.musicCompositions()[0].id,id,'Exact song survives restart');
assert.equal(vm.runInContext('MUSIC_BOOK[0].events.length',reloaded),one.events.length);
for(let i=0;i<49;i++)box.musicRememberComposition(OwlMusic.improvise(300+i));
assert.equal(box.musicCompositions().length,50);
assert.equal(box.musicRememberComposition(OwlMusic.improvise(9999)),null);
assert.equal(box.musicCompositions()[0].id,id,'A full songbook never silently deletes old compositions');
storage.clear();const unavailable=world();unavailable.localStorage.setItem=()=>{throw Error('full');};
assert.equal(unavailable.musicRememberComposition(one),null);assert.equal(unavailable.musicCompositions().length,0);
let aborted=false;box.BACKGROUND.jobs=[{id:'a',type:'midi',status:'queued'},{id:'b',type:'research',status:'queued'}];
box.BACKGROUND.running.set('a',{abort(){aborted=true;}});box.musicStopByUser();
assert(aborted);assert.equal(box.BACKGROUND.jobs[0].status,'cancelled');assert.equal(box.BACKGROUND.jobs[1].status,'queued');
assert.throws(()=>box.musicValidateWorkerScore({id:'j',musicRequest:{variation:true}},{compositionId:id}),/new piece/);
console.log('Songbook: 100 structured improvisations, variation, exact persistence, deduplication, retention, storage failure and Stop cancellation passed');
