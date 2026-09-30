const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=__dirname+'/../app/src/main/assets/',html=fs.readFileSync(root+'growbot-brain.html','utf8');
const part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
let clock=100000;
const box={Date:{now:()=>clock},now:()=>clock,localStorage:{setItem:()=>{}},$:()=>null,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
 APP:{resting:false},THERMAL:{paused:false},thermalSerious:()=>false,S:{phonePower:{levelPercent:80},fallen:false,running:true,cmdF:1,flow:{fwd:5}},
 BATT:{charging:false},AMBIENT:{},EARS:{on:false,partialAt:0},MIDI_PLAYER:{playing:false},VOICE:{busy:false,speaking:false},MIND:{busy:false,failures:0,on:true},
 PERCEPTION:{busy:false},INNER:{frustration:0,lastInteractionAt:clock},AUTONOMY:{enabled:false,state:'blocked',consecutiveFailures:8},SEEN:{present:false},FACE:{lastTouch:clock},BACKGROUND:{running:new Map()},verifiedIdentity:()=>null};
vm.createContext(box);vm.runInContext(part('const EXPRESSIONS = {','/* Particles:'),box);
const expressions=vm.runInContext('EXPRESSIONS',box);
for(const name of ['amused','mischievous','skeptical','embarrassed','empathetic','frustrated','musical','humming','serene','inspired','delighted','pondering','reassuring','disappointed']){
 assert(expressions[name]);assert(Object.values(expressions[name]).every(Number.isFinite));
 assert(box.setAffect(name,{source:'model',reason:'A contextual test',durationMs:2000,force:true}));
 box.VOICE.speaking=true;assert.equal(box.contextualFaceState().emotion,['musical','humming'].includes(name)?'happy':name);box.VOICE.speaking=false;clock+=2001;
}
assert.equal(box.interactionAffectForText('Pretend our spaceship is on fire!').emotion,'playful');
assert.equal(box.interactionAffectForText('For real, there is smoke and I need help.').emotion,'worried');
assert.equal(box.interactionAffectForText('I am upset. I do not want jokes.').emotion,'empathetic');
assert.equal(box.interactionAffectForText('Truce. Enough teasing.').emotion,'empathetic');
assert.equal(box.contextualFaceState().emotion,'focused','flow and an old disabled mission cannot imply successful travel');
box.S.running=false;assert.equal(box.contextualFaceState(),null,'old disabled mission does not freeze the face');
box.APP.resting=true;assert.equal(box.contextualFaceState().emotion,'sleepy');
box.APP.resting=false;box.musicFaceState=()=>({emotion:'humming',reason:'actual hum playback'});
assert.equal(box.contextualFaceState().emotion,'humming');
box.EARS.handsFreeState='hearing';assert.equal(box.contextualFaceState().emotion,'listening');
box.EARS.handsFreeState='transcribing';assert.equal(box.contextualFaceState().emotion,'pondering');
box.EARS.handsFreeState='paused';box.THERMAL.paused=true;assert.equal(box.contextualFaceState().emotion,'hot');box.THERMAL.paused=false;
box.APP.resting=true;assert.equal(box.contextualFaceState().emotion,'sleepy');box.APP.resting=false;box.musicFaceState=()=>null;
for(const name of ['musical','humming']){
 box.setAffect(name,{source:'model',reason:'Model claimed a performance',force:true});
 assert.equal(box.contextualFaceState().emotion,'happy','a model cannot sustain a phantom performance');
 assert.equal(box.groundedFaceEmotion(name),'happy');clock+=120001;
}
assert.equal(expressions.delighted.eyeArc,1);
assert(expressions.delighted.mouthOpen>expressions.neutral.mouthOpen);
assert.equal(expressions.serene.eyeArc,-1);
assert.equal(expressions.surprised.mouthRound,1);
assert(expressions.playful.eyeBias>.4);
box.setAffect('frustrated',{source:'model',reason:'Requested face demonstration',durationMs:2000,force:true});
box.VOICE.speaking=true;assert.equal(box.contextualFaceState().emotion,'frustrated');
clock+=2001;assert.notEqual(box.contextualFaceState().emotion,'frustrated','speech must not resurrect an expired demonstration');
box.VOICE.speaking=false;
box.setAffect('angry',{source:'model',reason:'Legacy long hold',durationMs:120000,force:true});
clock+=12001;assert.equal(box.contextualFaceState(),null,'a long emotional memory is not a stuck visible pose');
assert.equal(box.faceAffectFresh(),false);
assert(box.faceActing('playful',900,null).wink>.5);
assert.equal(box.faceActing('playful',1800,null).wink,0,'wink returns to an open eye');
assert(Math.abs(box.faceActing('frustrated',9000,null).tilt)<.00001,'entrance shake settles');
assert.notEqual(box.faceActing('amused',200,null).mouth,box.faceActing('amused',700,null).mouth);
assert.equal(expressions.loving.heartPupil,1);
assert.equal(expressions.inspired.starPupil,1);
box.BACKGROUND.jobs=[{id:'music',type:'midi',status:'queued'}];assert.equal(box.contextualFaceState(),null);
box.BACKGROUND.jobs[0].status='running';box.BACKGROUND.running.set('music',{});assert.equal(box.contextualFaceState().emotion,'inspired');
assert.match(html,/VERIFIED PERSON MEMORY/);assert.match(html,/const currentKey=verified\?\.personKey/);
const exec=fs.readFileSync(root+'executive-context.js','utf8');
const toolBox={MIND:{perceptionTurn:true},AUTONOMY:{enabled:false},conversationReplyTool:()=>({function:{name:'reply_to_person'}})};
vm.createContext(toolBox);vm.runInContext(exec.slice(0,exec.indexOf('function loadExecutiveTools(')),toolBox);
assert.deepEqual(Array.from(toolBox.executiveTools('old explore task'),t=>t.function.name),['reply_to_person']);
assert.match(html,/if\(observationOnlyTurn&&calls.length\)/,'offered schemas are backed by an execution guard');
// Exercise the renderer's own forced-pose path as well as contextual appraisal.
box.$=()=>({});box.chirp=()=>{};box.burst=()=>{};box.performance={now:()=>clock};
box.activeTask=box.activePersonalMission=box.activeWonder=()=>null;
box.BACKGROUND.jobs=[];box.BACKGROUND.running.clear();
vm.runInContext(part('const FACE = {','let recogListening = false;'),box);
vm.runInContext("FACE.set('angry',120000,{source:'model',reason:'demonstration'});",box);
assert.equal(vm.runInContext('FACE.forcedUntil-now()',box),12000);
assert.equal(vm.runInContext('FACE.mood()',box),'angry');
clock+=12001;
assert.notEqual(vm.runInContext('FACE.mood()',box),'angry','forced and contextual paths both release');
console.log('PASS: expression geometries and acting, appraisal/forced/speech expiry, fictional danger, empathy/truce, no pride from flow, paused-mission tools and stable person-memory keys.');
