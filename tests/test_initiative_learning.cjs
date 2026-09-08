const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/growbot-brain.html'),'utf8');
const part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
let clock=100000,owner=null,task=null,mission=null;
const box={Date:{now:()=>clock},Math,APP:{settings:false,resting:false},MIND:{on:true,busy:false,vision:true,motionArmed:true},
  AUTONOMY:{enabled:true,world:[],nextCycleAt:0,candidates:[],cycles:0},SELF:{tuning:{initiativeIntervalSeconds:60}},
  INNER:{lastInteractionAt:0},BEING:{embodiment:{phoneMount:'mounted',bodyAssembly:'assembled_body'}},S:{fallen:false},
  activeOwnerTask:()=>owner,activeTask:()=>task,activePersonalMission:()=>mission,activeWonder:()=>null,
  humanEngagementRecent:()=>false,bodyControllerReady:()=>true,bodyEmbodimentReady:()=>true,bodyBenchControlReady:()=>true,
  retireEmbodimentImpossibleSelfTask:()=>'',retireFixatedMission:()=>'',retireDetachedOrCoolingSelfTasks:()=>'',retireStaleBlockedSelfWork:()=>'',activateNextTask:()=>{},
  autonomySave:()=>{},intrinsicMotiveSummary:()=>'curiosity and exploration',taskSummary:t=>t.title,setInitiativeMode:m=>m};
vm.createContext(box);vm.runInContext(part('function chooseInitiativeMode(','function freshLine('),box);
let event=box.nextAutonomyCycle();assert.match(event,/AUTONOMY CYCLE/);assert.match(event,/nobody requested it/,'initiative does not require a sensor event or user');
assert.equal(box.nextAutonomyCycle(),'','cycle cadence must prevent polling/request floods');
clock+=60000;box.AUTONOMY.world=[{t:clock}];assert.equal(box.chooseInitiativeMode(null,null,false,true,clock),'explore','quiet unchanged scene permits chosen exploration');
box.AUTONOMY.planningOnlyCycles=2;assert.equal(box.chooseInitiativeMode(null,null,false,true,clock),'unstick');
box.APP.resting=true;assert.equal(box.nextAutonomyCycle(),'','sleep means no initiatives');box.APP.resting=false;
box.APP.settings=true;assert.equal(box.nextAutonomyCycle(),'','settings means no model initiatives');box.APP.settings=false;
box.AUTONOMY.enabled=false;assert.equal(box.nextAutonomyCycle(),'');
const tuning={SELF:{tuning:{initiativeIntervalSeconds:60},applied:[]},SELF_LIMITS:{initiativeIntervalSeconds:[45,180]},clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),Date,selfSave:()=>{}};
vm.createContext(tuning);vm.runInContext(part('function proposeSelfAdjustment(','function refreshSelfUI('),tuning);
assert.match(tuning.proposeSelfAdjustment('initiativeIntervalSeconds',100,'Several quiet cycles gained no new evidence'),/applied/);
assert.equal(tuning.SELF.tuning.initiativeIntervalSeconds,100);
assert.match(tuning.rollbackSelfAdjustment('initiativeIntervalSeconds','Longer gaps lost task continuity'),/rolled back/);
assert.equal(tuning.SELF.tuning.initiativeIntervalSeconds,60);
assert.match(tuning.rollbackSelfAdjustment('initiativeIntervalSeconds','retry'),/no matching/,'a rolled-back revision must not undo repeatedly');
const outcomes={};vm.createContext(outcomes);vm.runInContext(part('function classifyActionResult(','function recordActionOutcome('),outcomes);
assert.equal(outcomes.classifyActionResult('Walk interrupted by Stop'),'failed');
assert.equal(outcomes.classifyActionResult('Not executed: inspect first'),'failed');
assert.equal(outcomes.classifyActionResult('Controller completed; physical position is not measured'),'uncertain');
assert.match(html,/const bodySince=\(MEM.bodyExperiences\|\|\[\]\)/,'reflection must learn from embodied episodes too');
assert.match(html,/finish_reason==='length'\)return;[\s\S]{0,700}!Array\.isArray\(reflection.growth\)/,'truncated or malformed reflection cannot become a learned lesson');
console.log('PASS: self-initiated quiet-scene exploration, no-action recovery, rest and cadence, learned tuning with one-time rollback.');
