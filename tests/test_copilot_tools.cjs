const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=__dirname+'/../app/src/main/assets/';
const html=fs.readFileSync(root+'growbot-brain.html','utf8');
const exec=fs.readFileSync(root+'executive-context.js','utf8');
const box={MIND:{},activePersonalMission:()=>null,activeOwnerTask:()=>null,activeSelfTask:()=>null,
 conversationReplyTool:()=>({function:{name:'reply_to_person'}}),
 TOOLS:['recall','remember','inspect_capabilities','use_camera','look_at','move','start_walking','stop_walking','stop','read_sensors','express'].map(name=>({function:{name}}))};
vm.createContext(box);
vm.runInContext(html.slice(html.indexOf('function movementIntentText('),html.indexOf('function groundedSpokenReply(')),box);
vm.runInContext(exec.slice(0,exec.indexOf('function loadExecutiveTools(')),box);
for(const query of ['You are a waffle-headed goofball. Your move.', 'Your turn, Captain Waffle.', 'Right now, let us trade jokes.']){
 const names=Array.from(box.executiveTools(query,true),t=>t.function.name);
 for(const name of ['move','look_at','start_walking'])assert(!names.includes(name),query+' loaded '+name);
}
for(const query of ['Your move; now walk forward.', 'Turn left', 'Explore the room', 'Look at the box'])
 assert(box.executiveTools(query,false).some(t=>t.function.name==='move'),query);
box.MIND.autonomyTurn=true;
assert(box.executiveTools('',false).some(t=>t.function.name==='start_walking'));
console.log('PASS: playful turn-taking does not load motion tools; literal navigation and autonomy retain them.');
