const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.join(__dirname,'../app/src/main/assets');
const html=fs.readFileSync(path.join(root,'growbot-brain.html'),'utf8');
const box={};vm.createContext(box);vm.runInContext(fs.readFileSync(path.join(root,'face-wardrobe.js'),'utf8'),box);
const date=(m,d)=>new Date(2026,m-1,d,12);
assert.equal(box.resolveFaceCostume('none',date(10,31)),'none');
assert.equal(box.resolveFaceCostume('seasonal',date(10,30)),'none');
assert.equal(box.resolveFaceCostume('seasonal',date(10,31)),'halloween');
assert.equal(box.resolveFaceCostume('seasonal',date(11,1)),'none');
for(const day of [24,25])assert.equal(box.resolveFaceCostume('seasonal',date(12,day)),'christmas');
assert.equal(box.resolveFaceCostume('seasonal',date(12,26)),'none');
assert.equal(box.resolveFaceCostume('halloween',date(1,1)),'halloween');
assert.equal(box.resolveFaceCostume('christmas',date(6,1)),'christmas');
assert.equal(box.resolveFaceCostume('invalid',date(12,25)),'none');
vm.runInContext(html.slice(html.indexOf('const EXPRESSIONS = {'),html.indexOf('function affectLoad(){')),box);
const expressions=vm.runInContext('EXPRESSIONS',box),defaults=vm.runInContext('AFFECT_DEFAULTS',box);
assert.equal(Object.keys(expressions).length,48);
for(const [name,pose] of Object.entries(expressions)){
 assert(Object.values(pose).every(Number.isFinite),name+' geometry');assert(defaults[name],name+' affect defaults');
}
assert.match(html,/Outfits are decoration and must not decide personality or feeling/);
assert.match(html,/Do not simply match a word or mirror distress/);
assert.match(html,/<select id="faceCostume">\s*<option value="none">/);
// Exercise every expression, both costumes, and short/portrait viewports using
// the production canvas path, not a mock implementation of the renderer.
const {createCanvas}=require('@napi-rs/canvas');
Object.assign(box,{performance:{now:()=>0},APP:{resting:false},STAGES:[{scale:1,eyes:1}],LIFE:{stage:0},S:{running:false,phase:0,gimbal:{}},VOICE:{speaking:false},EARS:{},THERMAL:{},thermalSerious:()=>false,MIND:{on:false},SEEN:{},PARTS:[],activeTask:()=>null,bodyControllerReady:()=>false,$:()=>({value:box.costume}),clamp:(v,a,b)=>Math.max(a,Math.min(b,v))});
vm.runInContext(html.slice(html.indexOf('const FACE = {'),html.indexOf('let recogListening = false;')),box);
for(const costume of ['none','halloween','christmas'])for(const [w,h] of [[320,700],[640,320]])for(const name of Object.keys(expressions)){
 const canvas=createCanvas(w,h);Object.assign(box,{renderContext:canvas.getContext('2d'),costume,faceName:name,w,h});
 vm.runInContext(`Object.assign(FACE,{ctx:renderContext,w,h,name:faceName,moodSince:0,cur:{...EXPRESSIONS[faceName]},squash:0,blink:0,lookX:0,lookY:0,mouth:0,talking:false,musicVisual:null});FACE.draw(900);`,box);
}
console.log('PASS: 48 expressions, matching affect defaults, 288 production renders, costume dates/default/off/manual choices and context guidance.');
