// Physical sensor telemetry must not become an indefinitely renewed face.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/../app/src/main/assets/growbot-brain.html','utf8');
let clock=100000,cue=null;
const box={Date:{now:()=>clock},now:()=>clock,localStorage:{setItem(){}},$:()=>null,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
 APP:{resting:false},THERMAL:{paused:false},thermalSerious:()=>false,S:{phonePower:{levelPercent:80},fallen:false,running:false},
 BATT:{},AMBIENT:{},FALL:{},EARS:{on:false,partialAt:0},MIDI_PLAYER:{},VOICE:{speaking:false,busy:false},MIND:{on:true},
 PERCEPTION:{},INNER:{frustration:0,lastInteractionAt:clock},AUTONOMY:{enabled:false},SEEN:{present:false},FACE:{lastTouch:clock},
 BACKGROUND:{running:new Map()},verifiedIdentity:()=>null,storyFaceState:()=>cue};
vm.createContext(box);vm.runInContext(html.slice(html.indexOf('const EXPRESSIONS = {'),html.indexOf('/* Particles:')),box);
function motion(){box.AMBIENT.lastShake=clock;box.AMBIENT.motionScore=16;box.AMBIENT.lastEvent='rock';box.AMBIENT.lastEventAt=clock;}
for(let i=0;i<600;i++){
 clock+=100;motion();
 box.EARS.handsFreeState='hearing';assert.equal(box.contextualFaceState().emotion,'listening');
 box.EARS.handsFreeState='paused';cue={emotion:'amused',reason:'Current story scene'};assert.equal(box.contextualFaceState().emotion,'amused');
 cue=null;box.S.running=true;box.S.cmdF=1;assert.equal(box.contextualFaceState().emotion,'focused','Commanded walking is not surprise from its own vibration');box.S.running=false;
 assert.equal(box.contextualFaceState(),null,'Quiet social context is not forced playful or surprised by repeated motion');
}
box.AMBIENT.freefallAt=clock;assert.equal(box.contextualFaceState(),null,'One candidate sample cannot claim a drop');
box.AMBIENT.lastDrop=clock;assert.equal(box.contextualFaceState().emotion,'surprised','Confirmed free-fall evidence still reaches the face');
clock+=1501;box.AMBIENT.freefallAt=0;assert.equal(box.contextualFaceState(),null);
box.setAffect('surprised',{source:'model',force:true,durationMs:1500,reason:'A genuinely unexpected story reveal'});
assert.equal(box.contextualFaceState().emotion,'surprised','The brain retains the full expression range');clock+=1501;
box.S.fallen=true;box.FALL.fallAt=clock;assert.equal(box.contextualFaceState().emotion,'afraid','Existing fall state still has priority');
box.APP.resting=true;assert.equal(box.contextualFaceState().emotion,'sleepy');
box.THERMAL.paused=true;assert.equal(box.contextualFaceState().emotion,'hot');
console.log('PASS: 60 seconds repeated motion cannot hijack listening, narration, walking or idle expressions; confirmed drop, fall, sleep, heat and model surprise remain distinct.');
