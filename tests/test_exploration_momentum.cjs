const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'../app/src/main/assets');
const html=fs.readFileSync(path.join(root,'growbot-brain.html'),'utf8');
const part=(a,z)=>html.slice(html.indexOf(a),html.indexOf(z,html.indexOf(a)));
let clock=200000,owner={id:'owner',requiresMotion:true},wonder={id:'shelf',target:'shelf',question:'label?',evidence:[]},held=false,ready=true,stops=[];
const b={Date:{now:()=>clock},Math,Number,JSON,Boolean,Error,Object,
 AUTONOMY:{enabled:true,world:[],blockedUntil:0,nextCycleAt:0},MIND:{on:true,motionArmed:true,userQueue:[],vision:true},APP:{resting:false,settings:false},S:{fallen:false},
 activeOwnerTask:()=>owner,activeSelfTask:()=>null,activePersonalMission:()=>null,activeWonder:()=>wonder,
 bodyEmbodimentReady:()=>true,bodyControllerReady:()=>ready,ownerBodyMotionProblem:()=>held?'held':'',autonomySave:()=>{},
 bodyToolFailed:r=>/failed|not executed/i.test(r),CHANNEL_SETUP:{generation:1},NW:{abort:{abort:()=>stops.push('abort')}},WALK_STREAM:{session:null},
 cancelWalkingSession:()=>stops.push('cancel'),channelCommand:async a=>stops.push(a),log:()=>{}};
vm.createContext(b);
vm.runInContext(part('function classifyActionResult(','function recordActionOutcome('),b);
vm.runInContext(fs.readFileSync(path.join(root,'exploration-momentum.js'),'utf8'),b);
vm.runInContext(part('function chooseInitiativeMode(','function freshLine('),b);
assert.equal(b.explorationMomentumReady(),true);
assert.equal(b.scheduleExplorationFollowThrough({perceptionTurn:true,outcomes:[{tool:'update_curiosity',result:'updated'}]}),true);
assert.equal(b.AUTONOMY.nextCycleAt,clock+10000);
b.scheduleExplorationFollowThrough({ownerEventTurn:true,outcomes:[{tool:'look_at',result:'Pico completed; physical position not measured'}]});
assert.equal(b.AUTONOMY.approachContinuity.stationaryTurns,2,'Another image/head target is not locomotion');
assert.equal(b.chooseInitiativeMode(null,null,false,true,clock),'approach_or_replan','Owner task must not hide stalled approach');
assert.match(b.explorationMomentumPrompt(),/explicitly defer/);
b.scheduleExplorationFollowThrough({autonomyTurn:true,outcomes:[]});assert.equal(b.AUTONOMY.nextCycleAt,clock+30000,'No-action retries back off');
b.scheduleExplorationFollowThrough({autonomyTurn:true,movementAttempted:true,lastPhysicalResult:'{"accepted":true}',outcomes:[{tool:'start_walking',result:'{"accepted":true,"active":true}'}]});
assert.equal(b.AUTONOMY.approachContinuity.stationaryTurns,0);assert.equal(b.AUTONOMY.nextCycleAt,clock+5000);
assert.equal(b.AUTONOMY.approachContinuity.lastStep,'locomotion_attempt','No inferred physical arrival');
b.recordExplorationContinuity([{tool:'move',result:'Not executed: blocked'}]);assert.equal(b.AUTONOMY.approachContinuity.stationaryTurns,1);
wonder={id:'cabinet',target:'cabinet',evidence:[1,2,3].map(()=>({predictionResult:'inconclusive'}))};
assert.match(b.explorationMomentumPrompt(),/"repeatedInconclusive":true/);
b.recordExplorationContinuity([]);assert.equal(b.AUTONOMY.approachContinuity.stationaryTurns,1,'New target resets stationary history');
held=true;assert.equal(b.explorationMomentumReady(),false);assert.equal(b.scheduleExplorationFollowThrough({autonomyTurn:true}),false);held=false;
owner.requiresMotion=false;assert.equal(b.explorationWorkPending(),false,'Conversation/non-motion task beats stale target');owner.requiresMotion=true;
ready=false;assert.equal(b.explorationMomentumReady(),false);ready=true;
b.MIND.pendingUser='hello';assert.equal(b.scheduleExplorationFollowThrough({autonomyTurn:true}),false);b.MIND.pendingUser=null;
b.WALK_STREAM.session={active:true};assert.equal(b.scheduleExplorationFollowThrough({autonomyTurn:true}),false);b.WALK_STREAM.session=null;
b.AUTONOMY.blockedUntil=clock+120000;b.scheduleExplorationFollowThrough({autonomyTurn:true});assert.equal(b.AUTONOMY.nextCycleAt,clock+120000);
// Pause cancels mind-owned locomotion without releasing the supported head.
b.MIND.activeLocomotion=true;b.pauseMindLocomotion();assert.deepEqual(stops,['abort','walk_halt','turn_halt']);assert.equal(b.CHANNEL_SETUP.generation,2);
stops=[];b.MIND.activeLocomotion=false;b.pauseMindLocomotion();assert.equal(stops.length,0,'Manual control is not owned by mind pause');
b.WALK_STREAM.session={active:true,mindOwned:true};b.pauseMindLocomotion();assert(stops.includes('cancel'));assert(!stops.some(x=>/release/.test(x)));
assert.throws(()=>b.mindActionGuard({aborted:true}),/cancelled/);
assert.match(html,/for\(const c of calls\)\{\s*if\(turnSignal\.aborted\|\|!MIND.on/);
assert.match(html,/cancelled during body preflight/);
assert.match(html,/pauseGeneration\|\|0\)!==pauseGeneration/,'Late recovery timer respects pause');
assert.match(html,/sessionGuard:\(\)=>mindActionGuard\(context.signal\)/);
// Real dispatcher must reject stale calls before any hardware work.
vm.runInContext(part('async function runTool(','function directBodyIntent('),b);
(async()=>{assert.match(await b.runTool('move',{turn:1},{signal:{aborted:true}}),/Not executed/);
 console.log('PASS: active-target follow-through, bounded planning backoff, observation versus locomotion, owner priority, pause cancellation and late-action rejection (synthetic).');
})().catch(e=>{console.error(e);process.exitCode=1;});
