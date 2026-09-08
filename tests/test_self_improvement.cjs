const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const dir=path.join(__dirname,'../app/src/main/assets');
const source=fs.readFileSync(path.join(dir,'self-improvement.js'),'utf8'),html=fs.readFileSync(path.join(dir,'growbot-brain.html'),'utf8');
const saved=new Map(),controls={btnSelfImprovement:{setAttribute(){}},btnReflect:{},selfImprovementStatus:{}};
let improvementAborts=0,researchAborts=0,humanAborts=0,pumps=0,fetches=0,providerResponse;
const box={localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},$:s=>controls[s.slice(1)],
 TASKS:{items:[{id:'a',title:'Self-improvement review',status:'active'},{id:'b',title:'Explore the box',status:'queued'}]},
 AUTONOMY:{mission:{id:'m',title:'Improve my personality',status:'active',expires:Date.now()+60000}},
 BACKGROUND:{jobs:[{id:'i',task:'self reflection'},{id:'r',task:'Research a moth'}],running:new Map([['i',{abort:()=>improvementAborts++}],['r',{abort:()=>researchAborts++}]])},
 MIND:{on:true,busy:false,activeUserTurn:true,abort:{abort:()=>humanAborts++}},taskSave:()=>{},autonomySave:()=>{},
 APP:{settings:false,resting:false},MEM:{episodes:[{t:2,what:'A recorded event'}],conversations:[],bodyExperiences:[],lastReflect:1,reflections:0},
 AbortController,FACE:{set:()=>{}},ago:()=>'',OwlContext:{clip:s=>s},mindHeaders:()=>({}),
 mindFetch:()=>{fetches++;return new Promise(resolve=>providerResponse=resolve);},humanConversationOwnsResources:()=>false,
 queueMicrotask,pumpUserMindQueue:()=>pumps++};
controls.mBase={value:'https://provider.invalid'};controls.mModel={value:'test'};
vm.createContext(box);vm.runInContext(source,box);
const reflectSource=html.slice(html.indexOf('async function reflect('),html.indexOf('setInterval(reflect,'));vm.runInContext(reflectSource,box);
(async()=>{
 assert.equal(box.selfImprovementEnabled(),false);await box.reflect(true);assert.equal(fetches,0,'even forced reflection must honor Off');
 box.setSelfImprovementEnabled(false);assert.equal(box.TASKS.items[0].status,'paused_improvement');assert.equal(box.TASKS.items[1].status,'queued');
 assert.equal(box.AUTONOMY.mission,null);assert.equal(box.AUTONOMY.pausedImprovementMissions[0].id,'m');
 assert.equal(improvementAborts,1);assert.equal(researchAborts,0);assert.equal(humanAborts,0);assert.equal(controls.btnReflect.disabled,true);
 assert.equal(box.improvementWorkAllowed({task:'Write a silly song'}),true);assert.equal(box.improvementWorkAllowed({objective:'Tune my responses'}),false);
 box.setSelfImprovementEnabled(true);assert.equal(saved.get('owlbot_self_improvement_v1'),'on');assert.equal(box.AUTONOMY.mission.id,'m');assert.equal(box.TASKS.items[0].status,'queued');
 assert.equal(controls.btnReflect.disabled,false);
 const reload={localStorage:box.localStorage};vm.createContext(reload);vm.runInContext(source,reload);assert.equal(reload.selfImprovementEnabled(),true,'explicit On survives reload');
 const work=box.reflect(true);assert.equal(fetches,1);box.setSelfImprovementEnabled(false);
 providerResponse({ok:true,json:async()=>{throw Error('late disabled response must never be consumed');}});await work;
 assert.equal(box.MIND.busy,false);await Promise.resolve();assert.equal(pumps,1,'human queue resumes after reflection ends');
 const reloadOff={localStorage:box.localStorage};vm.createContext(reloadOff);vm.runInContext(source,reloadOff);assert.equal(reloadOff.selfImprovementEnabled(),false);
 const tasksBefore=JSON.stringify(box.TASKS);box.reconcileImprovementWork();assert.equal(JSON.stringify(box.TASKS),tasksBefore,'pause reconciliation is idempotent');
 assert.doesNotMatch(source,/channelCommand\(|wsSend\(|fetch\(|setInterval\(/,'the switch itself spends no model calls and commands no hardware');
 console.log('PASS: default Off, persisted On/Off, disabled reflection spends zero calls, selective cancellation, late-result rejection, retained tasks/missions and human-queue recovery.');
})().catch(e=>{console.error(e);process.exitCode=1;});
