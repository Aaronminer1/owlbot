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
for(const name of ['amused','mischievous','skeptical','embarrassed','empathetic','frustrated']){
 assert(expressions[name]);assert(Object.values(expressions[name]).every(Number.isFinite));
 assert(box.setAffect(name,{source:'model',reason:'A contextual test',durationMs:2000,force:true}));
 box.VOICE.speaking=true;assert.equal(box.contextualFaceState().emotion,name);box.VOICE.speaking=false;clock+=2001;
}
assert.equal(box.interactionAffectForText('Pretend our spaceship is on fire!').emotion,'playful');
assert.equal(box.interactionAffectForText('For real, there is smoke and I need help.').emotion,'worried');
assert.equal(box.interactionAffectForText('I am upset. I do not want jokes.').emotion,'empathetic');
assert.equal(box.interactionAffectForText('Truce. Enough teasing.').emotion,'empathetic');
assert.equal(box.contextualFaceState().emotion,'focused','flow and an old disabled mission cannot imply successful travel');
box.S.running=false;assert.equal(box.contextualFaceState(),null,'old disabled mission does not freeze the face');
box.APP.resting=true;assert.equal(box.contextualFaceState().emotion,'sleepy');
assert.match(html,/VERIFIED PERSON MEMORY/);assert.match(html,/const currentKey=verified\?\.personKey/);
const exec=fs.readFileSync(root+'executive-context.js','utf8');
const toolBox={MIND:{perceptionTurn:true},AUTONOMY:{enabled:false},conversationReplyTool:()=>({function:{name:'reply_to_person'}})};
vm.createContext(toolBox);vm.runInContext(exec.slice(0,exec.indexOf('function loadExecutiveTools(')),toolBox);
assert.deepEqual(Array.from(toolBox.executiveTools('old explore task'),t=>t.function.name),['reply_to_person']);
assert.match(html,/if\(observationOnlyTurn&&calls.length\)/,'offered schemas are backed by an execution guard');
console.log('PASS: six expression geometries, model/speech appraisal, fictional danger, empathy/truce, no pride from flow, paused-mission tool isolation and stable person-memory keys.');
