const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/growbot-brain.html'),'utf8');
const source=html.slice(html.indexOf('const BEING_KEY='),html.indexOf('function beingSave(){'));
for(const [name,age] of [['Sample',6],['Andrew',9]]){
 const saved={schema:4,identity:{name,named:true,developmentalAge:age,ownerPersona:'Owner-chosen personality',personaConfigured:true,continuityId:'synthetic-continuity',firstAwake:1234,wakeCount:2},personality:{traits:{curiosity:.9},affinities:{},signature:['likes stories'],learnedPreferences:['music']},soul:{coreValues:['kindness'],growth:{}},beliefs:[],commitments:[],autobiography:[{event:'synthetic fixture'}]};
 const box={localStorage:{getItem:()=>JSON.stringify(saved)},MEM:{conversations:[]},beingSave(){}};vm.createContext(box);vm.runInContext(source+'\nbeingLoad();globalThis.loaded=BEING;',box);
 for(const k of ['name','developmentalAge','ownerPersona','continuityId','firstAwake'])assert.equal(box.loaded.identity[k],saved.identity[k]);
 assert.equal(box.loaded.autobiography.length,1);assert.equal(box.loaded.schema,5);
}
assert(!html.includes('aaron-precocious-nine-2026-09-07'));
console.log('PASS: public updates preserve individual name, age, persona and continuity without owner-specific migrations.');
