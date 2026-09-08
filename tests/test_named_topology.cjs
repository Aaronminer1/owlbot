const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'app/src/main/assets/growbot-brain.html'),'utf8');
// Deliberately synthetic topology, not an exported robot calibration.
const rows=['Head','Turn','Left front leg','Left rear leg','Right rear leg','Right front leg','Slide'].map((name,channel)=>({channel,name,enabled:true,calibrated:true,a_name:'A',b_name:'B',a_us:1000,b_us:2000,center_us:1500}));
const plan={steps:rows.map(row=>({channel:row.channel,position:'A',binding:{...row}}))};
const box={CHANNEL_SETUP:{saved:structuredClone(rows),loaded:true},NW:{plan},bodyControllerReady:()=>true};
vm.createContext(box);vm.runInContext(html.slice(html.indexOf('function namedBodyTopology('),html.indexOf('function bodyDiagnosticSnapshot(')),box);
let result=box.namedBodyTopology();
assert.equal(result.bindingsMatch,true);assert.equal(result.fresh,true);assert.equal(result.physicalWiringVerified,false);
assert.equal(result.channels.find(c=>c.name==='Slide').channel,6);
assert.equal(result.channels.find(c=>c.name==='Right front leg').channel,5);
box.CHANNEL_SETUP.saved[1].a_us++;
assert.equal(box.namedBodyTopology().bindingsMatch,false,'actual endpoint drift must still be reported');
assert.equal(box.namedBodyTopology().mismatches[0].channel,1);
box.CHANNEL_SETUP.saved=structuredClone(rows);box.CHANNEL_SETUP.saved[1].enabled=false;
assert.equal(box.namedBodyTopology().bindingsMatch,false,'disabled gait channel cannot be ignored');
box.CHANNEL_SETUP.saved=structuredClone(rows);box.CHANNEL_SETUP.loaded=false;
assert.equal(box.namedBodyTopology().fresh,false,'cached bindings are not fresh controller evidence');
box.NW.plan=null;assert.equal(box.namedBodyTopology().bindingsMatch,null);
assert.doesNotMatch(html,/; MAP DISAGREEMENT/);
const executive=fs.readFileSync(path.join(root,'app/src/main/assets/executive-context.js'),'utf8');
const names=['use_camera','look_at','move','start_walking','stop_walking','stop','read_sensors','express'];
const toolsBox={MIND:{autonomyTurn:false,perceptionTurn:false},TOOLS:names.map(name=>({function:{name}})),activePersonalMission:()=>null,activeOwnerTask:()=>null,activeSelfTask:()=>null};
vm.createContext(toolsBox);vm.runInContext(executive.slice(0,executive.indexOf('function loadExecutiveTools(')),toolsBox);
for(const query of ['go explore','go look at the yellow bucket','walk forward']){
 const loaded=toolsBox.executiveTools(query).map(t=>t.function.name);
 assert(loaded.includes('start_walking'));assert(loaded.includes('stop_walking'));
}
assert(!toolsBox.executiveTools('Tell me a joke').some(t=>t.function.name==='start_walking'));
toolsBox.MIND.autonomyTurn=true;assert(toolsBox.executiveTools('').some(t=>t.function.name==='start_walking'));
console.log('PASS: actual saved gait bindings, real drift detection, cache freshness, no legacy wiring claim, continuous tools for exploration.');
