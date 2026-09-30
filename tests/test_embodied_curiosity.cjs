const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'../app/src/main/assets');
const html=fs.readFileSync(path.join(root,'growbot-brain.html'),'utf8');
const part=(a,b)=>{const start=html.indexOf(a),end=html.indexOf(b,start);assert(start>=0&&end>start);return html.slice(start,end);};
let clock=200000,owner=null,task=null,mission=null,wonder=null,embodied=true,conversation=false;
const b={Date:{now:()=>clock},Math,Number,JSON,Set,clamp:(v,a,z)=>Math.max(a,Math.min(z,v)),
 APP:{resting:false,settings:false},MIND:{on:true,busy:false,motionArmed:true,vision:true,userQueue:[],initiativeExperiments:0},
 AUTONOMY:{enabled:true,world:[{t:clock}],initiativeMode:'explore',nextCycleAt:clock+60000,blockedUntil:0},
 S:{fallen:false},WALK_STREAM:{session:null},activeOwnerTask:()=>owner,activeSelfTask:()=>task,
 activePersonalMission:()=>mission,activeWonder:()=>wonder,bodyEmbodimentReady:()=>embodied,
 humanConversationOwnsResources:()=>conversation,autonomySave:()=>{},
 bodyToolFailed:r=>/failed|timeout|disconnected/i.test(r)};
vm.createContext(b);
vm.runInContext(part('function classifyActionResult(','function recordActionOutcome('),b);
vm.runInContext(part('function chooseInitiativeMode(','function freshLine('),b);
assert.equal(b.chooseInitiativeMode(null,null,true,true,clock),'explore','Quiet company must not suppress exploration');
assert.equal(b.chooseInitiativeMode(null,null,true,false,clock),'seek_useful_opportunity');
owner={source:'owner',requiresMotion:false};assert.equal(b.chooseInitiativeMode(null,null,true,true,clock),'owner_work');owner=null;
task={source:'self',requiresMotion:true};assert.equal(b.chooseInitiativeMode(task,null,false,true,clock),'self_work');task=null;
b.S.fallen=true;assert.equal(b.chooseInitiativeMode(null,null,false,true,clock),'recover');b.S.fallen=false;
b.AUTONOMY.planningOnlyCycles=2;assert.equal(b.chooseInitiativeMode(null,null,false,true,clock),'unstick');b.AUTONOMY.planningOnlyCycles=0;
conversation=true;assert.equal(b.nextAutonomyCycle(),'','Conversation/story owns the resource lane');conversation=false;
b.WALK_STREAM.session={active:true};assert.equal(b.nextAutonomyCycle(),'','Do not compete with active navigation');b.WALK_STREAM.session=null;
const next=(args={})=>b.scheduleExplorationFollowThrough({autonomyTurn:true,...args});
assert.equal(next(),true,'Retained exploration gets a follow-up even after a planning-only turn; momentum module applies bounded backoff');
b.MIND.initiativeExperiments=1;assert.equal(next(),true);assert.equal(b.AUTONOMY.nextCycleAt,clock+5000,'Fresh evidence gets a timely next step');
b.MIND.initiativeExperiments=0;
assert.equal(next({movementAttempted:true,lastPhysicalResult:'Controller completed; position not measured'}),true);
assert.equal(b.AUTONOMY.nextCycleAt,clock+5000);
assert.equal(next({movementAttempted:true,lastPhysicalResult:'{"accepted":false,"error":"blocked"}'}),true);
assert.equal(b.AUTONOMY.nextCycleAt,clock+15000,'Failure backs off rather than spinning');
b.AUTONOMY.blockedUntil=clock+120000;
next({movementAttempted:true,lastPhysicalResult:'failed'});assert.equal(b.AUTONOMY.nextCycleAt,clock+120000,'Do not override failure cooldown');b.AUTONOMY.blockedUntil=0;
assert.equal(b.classifyActionResult('{"accepted":false}'),'failed');
assert.equal(b.classifyActionResult('{"accepted":true,"active":true}'),'uncertain','Session acceptance is not arrival or a completed walk');
b.MIND.initiativeExperiments=1;
for(const [obj,key,value] of [[b.APP,'resting',true],[b.APP,'settings',true],[b.AUTONOMY,'enabled',false],[b.MIND,'on',false],[b.MIND,'motionArmed',false],[b.MIND,'pendingUser','hello']]){
 const prev=obj[key];obj[key]=value;assert.equal(next(),false,`${key} must prevent expedited exploration`);obj[key]=prev;
}
b.MIND.userQueue=['hello'];assert.equal(next(),false);b.MIND.userQueue=[];
embodied=false;assert.equal(next(),false);embodied=true;
b.WALK_STREAM.session={active:true};assert.equal(next(),false);b.WALK_STREAM.session=null;
owner={requiresMotion:false};assert.equal(next(),false,'Do not hijack a non-motion owner task');
owner={requiresMotion:true};assert.equal(next({autonomyTurn:false,movementAttempted:true}),true,'Keep owner walking follow-through');owner=null;
b.AUTONOMY.initiativeMode='self_work';task={requiresMotion:true};assert.equal(next(),true);task=null;
assert.equal(next(),false,'Unrelated self-work uses its ordinary cadence');
wonder={target:'unfamiliar container'};assert.equal(next(),true);wonder=null;
// Only useful evidence feeds learning; asking/predicting must not reset hunger.
b.CURIOSITY={drive:.8,appetite:.5,lastFedAt:clock-60000,questions:0,experiments:0,discoveries:0,recentMoves:[]};
b.LIFE={curiosity:.4};b.curiositySave=()=>{};b.replySimilarity=(a,c)=>a===c?1:0;
vm.runInContext(part('function curiosityAppetite(','function isVisibleCuriosityLine('),b);
const fed=b.CURIOSITY.lastFedAt,appetite=b.curiosityAppetite();
b.recordCuriosityMove('question','What is inside that container?');
b.recordCuriosityMove('prediction','Perhaps it holds tools');
assert.equal(b.CURIOSITY.lastFedAt,fed);assert.equal(b.curiosityAppetite(),appetite);assert.equal(b.LIFE.curiosity,.4);
b.recordCuriosityMove('experiment','closer label','The label says screws.');
assert(b.LIFE.curiosity>.4);assert(b.curiosityAppetite()<appetite);
const learned=b.LIFE.curiosity;
b.recordCuriosityMove('experiment','closer label','The label says screws.');assert.equal(b.LIFE.curiosity,learned,'Repeated evidence earns no second reward');
b.recordCuriosityMove('experiment','failed head look','Head movement failed: timeout');assert.equal(b.LIFE.curiosity,learned);
const lifeSection=part('/* ---- curiosity: learning,','/* ---- care score');
assert.doesNotMatch(lifeSection,/seeing\s*\?/,'Optical flow alone must not satisfy curiosity');
assert.match(html,/\['move','start_walking','look_at'/,'Continuous walking shares physical-action arbitration');
assert.match(html,/\['move','start_walking','perform_body_sequence'/,'Continuous walking counts as an attempt, not another invitation to move');
console.log('PASS embodied curiosity: quiet company, owner priority, evidence-driven appetite, 5s follow-through/15s failure backoff, cooldowns, conversation/sleep/settings/power-authority gates and honest walk acceptance; synthetic only.');
