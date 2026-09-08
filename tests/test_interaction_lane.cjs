const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const base=path.join(__dirname,'../app/src/main/assets');
const html=fs.readFileSync(path.join(base,'growbot-brain.html'),'utf8');
const lane=fs.readFileSync(path.join(base,'interaction-lane.js'),'utf8');
const extract=(name,end)=>html.slice(html.indexOf('function '+name+'('),html.indexOf(end,html.indexOf('function '+name+'(')));
let clock=100000,aborted=0,timers=[];
const fields={typeIn:{value:''},inputDelivery:{textContent:''}};
const box={Date:{now:()=>clock},MIND:{userSequence:0,userQueue:[],busy:true,on:true},EARS:{paused:false,on:false,handsFreeState:'ready'},VOICE:{busy:false,generation:1},APP:{resting:false,settings:false},THERMAL:{paused:false},
 PERCEPTION:{abort:{abort:()=>aborted++}},BACKGROUND:{running:new Map([['job',{abort:()=>aborted++}]])},
 $:s=>fields[s.slice(1)],setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimeout:()=>{},mindLog:()=>{},now:()=>clock,
 FACE:{set:()=>{}},LIFE:{company:.5},INNER:{interactions:{talk:0}},clamp:(n,a,b)=>Math.max(a,Math.min(n,b)),
 thermalSerious:()=>false,normalizeMovementTranscript:s=>String(s).trim(),goalEvent:()=>{},innerSave:()=>{},log:()=>{},showHeard:()=>{},appraiseUserInteraction:()=>{},adaptGoalToSituation:()=>{},
 handleAgentOnboarding:()=>false,handleIdentityReply:()=>false,handleExactSpeechRequest:()=>false,handleDirectBodyIntent:()=>false,
 ownerRejectsCurrentWork:()=>{},ownerTopicBoundary:()=>{},captureSocialAnswer:t=>'context '+t,rememberVisualCorrection:()=>{},
 startMind:()=>{},mindTick:()=>{},delegateBackgroundTask:()=>{}};
vm.createContext(box);vm.runInContext(lane,box);
vm.runInContext(extract('queueUserMindTurn','/* the native host calls these back */'),box);
vm.runInContext(extract('sendTyped','$("#btnType").onclick'),box);
for(const state of ['paused','on']){
 box.EARS[state]=true;fields.typeIn.value='Hello '+state;box.sendTyped();
 assert.equal(fields.typeIn.value,'');assert.equal(box.MIND.userQueue.at(-1).text,'Hello '+state);
 assert.equal(box.EARS.pending,undefined,'typing must not enter the PTT transcript buffer');box.EARS[state]=false;
}
for(const target of [box.APP,box.THERMAL]){
 const key=target===box.APP?'resting':'paused';target[key]=true;fields.typeIn.value='keep my draft';box.sendTyped();
 assert.equal(fields.typeIn.value,'keep my draft');assert.equal(box.MIND.lastDelivery.status,'not_sent');target[key]=false;
}
box.APP.settings=true;box.sendTyped();assert.equal(fields.typeIn.value,'keep my draft');box.APP.settings=false;
let count=box.MIND.userQueue.length;box.submitHeard('same','typed');box.submitHeard('same','typed');assert.equal(box.MIND.userQueue.length,count+2);
box.submitHeard('voice');count=box.MIND.userQueue.length;box.submitHeard('voice');assert.equal(box.MIND.userQueue.length,count,'duplicate voice final must not enqueue twice');
box.MIND.busy=false;box.pumpUserMindQueue();assert.equal(box.MIND.pendingUser,'Hello paused');assert.equal(box.MIND.pendingAnswerContext,'context Hello paused');
box.beginHumanDelivery(box.MIND.pendingUser);assert.equal(box.MIND.activeRequest.attempts,1);
box.retryHumanDelivery('Hello paused',Error('network error'));assert.equal(box.MIND.lastDelivery.status,'retrying');assert.equal(timers.at(-1).ms,3000);
box.beginHumanDelivery('Hello paused');box.retryHumanDelivery('Hello paused',Error('network error'));assert.equal(timers.at(-1).ms,6000);
box.beginHumanDelivery('Hello paused');fields.typeIn.value='';box.retryHumanDelivery('Hello paused',Error('network error'));
assert.equal(box.MIND.activeRequest,null);assert.equal(box.MIND.pendingUser,null);assert.equal(fields.typeIn.value,'Hello paused');assert.equal(box.MIND.failedRequests.length,1);
box.pumpUserMindQueue();assert.equal(box.MIND.pendingUser,'Hello on','terminal failure must release the next FIFO request');
box.beginHumanDelivery('Hello on');box.MIND.activeRequest.sideEffects=true;
assert.equal(box.retryHumanDelivery('Hello on',Error('timeout')),false,'never replay a turn after a possible side effect');
box.beginHumanDelivery('long cooldown');assert.equal(box.retryHumanDelivery('long cooldown',{name:'ModelRateDeferred',retryAfterMs:180000}),false);
box.MIND.userQueue=[];box.MIND.pendingUser=null;box.MIND.lastHumanInputAt=0;
assert.equal(box.humanConversationOwnsResources(),false);
for(const state of ['hearing','transcribing']){box.EARS.handsFreeState=state;assert.equal(box.humanConversationOwnsResources(),true);}
box.EARS.handsFreeState='ready';box.VOICE.busy=true;assert.equal(box.humanConversationOwnsResources(),true);box.VOICE.busy=false;
box.MIND.activeUserTurn=true;box.MIND.abort={abort:()=>assert.fail('hearing must not abort an older human answer')};box.markHumanActivity();
box.MIND.activeUserTurn=false;box.MIND.abort={abort:()=>aborted++};box.markHumanActivity();assert.ok(aborted>2);assert.equal(box.humanConversationOwnsResources(),true);
clock+=30000;assert.equal(box.humanConversationOwnsResources(),true,'a conversational pause does not invite old investigations');
clock+=15001;assert.equal(box.humanConversationOwnsResources(),false,'quiet time restores background initiative');
for(const name of ['pumpBackgroundJobs','selfScheduleTick','perceptionTick'])assert.match(extract(name,'\n}'),/humanConversationOwnsResources\(\)/);
assert.match(extract('earsStart','function earsFinish'),/MIND\.abort&&!MIND\.activeUserTurn/);
assert.doesNotMatch(lane,/wsSend\(|runTool\(|channelCommand\(/,'conversation arbitration must not command hardware');
const execSource=fs.readFileSync(path.join(base,'executive-context.js'),'utf8');
const promptBox={OwlContext:{clip:s=>s},verifiedIdentity:()=>null,IDENT:{enabled:false},activePersonalMission:()=>null,activeOwnerTask:()=>null,activeSelfTask:()=>null,MIND:{},conversationalTurn:()=>true,conversationPrompt:(t,i)=>'casual '+t+' '+i};
vm.createContext(promptBox);vm.runInContext(execSource.slice(0,execSource.indexOf('const contextWindowControl=')),promptBox);assert.match(promptBox.buildExecutiveContext('Tell me a joke'),/^casual Tell me a joke/);
(async()=>{
 box.EARS.handsFreeState='hearing';timers=[];
 let finished=false;const waiting=box.waitForHumanSpeechBeforePlayback(1).then(()=>finished=true);await Promise.resolve();assert.equal(finished,false);
 box.EARS.handsFreeState='ready';timers.at(-1).fn();await waiting;assert.equal(finished,true);
 box.EARS.handsFreeState='transcribing';box.VOICE.generation=2;
 await assert.rejects(box.waitForHumanSpeechBeforePlayback(1),/cancelled/);
 console.log('PASS: typed delivery, voice deduplication, FIFO, bounded retries, no action replay, conversation priority, playback arbitration and casual prompt routing.');
})().catch(e=>{console.error(e);process.exitCode=1;});
