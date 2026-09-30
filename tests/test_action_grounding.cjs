// No hardware or model calls: exercise the exact deployed prompt/dispatch helpers.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=__dirname+'/../app/src/main/assets/';
const html=fs.readFileSync(root+'growbot-brain.html','utf8');
const part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
let sent;
const box={normalRoutineName:n=>String(n||'').replace('take a bow','bow'),isDog6:()=>true,
  clamp:(n,a,b)=>Math.min(b,Math.max(a,n)),headMove:async target=>{sent=target;return 'mock result';}};
vm.createContext(box);
vm.runInContext(part('function actionVisionQuestion(','async function describeFrameForBrain('),box);
vm.runInContext(part('async function commandGaze(','async function releaseGaze('),box);
(async()=>{
  const bow=box.actionVisionQuestion('Henu bow',[{tool:'gesture',args:{name:'bow'}}]);
  assert.match(bow,/bowing gesture, not an archery bow/);
  assert.match(bow,/not proof it moved/);assert.match(bow,/own head and feet may be outside/);
  assert.match(box.actionVisionQuestion('lookup',[{tool:'look_at',args:{tilt:1}}]),/pan or tilt its own head/);
  assert.equal(box.actionVisionQuestion('What is that archery bow?',[]),'What is that archery bow?');
  await box.commandGaze(undefined,1);assert.deepEqual(JSON.parse(JSON.stringify(sent)),{tilt:1});
  await box.commandGaze(-1,undefined);assert.deepEqual(JSON.parse(JSON.stringify(sent)),{pan:-1});
  await box.commandGaze(0,0);assert.deepEqual(JSON.parse(JSON.stringify(sent)),{pan:0,tilt:0});
  assert.match(part('function companionStylePrompt(','function conversationPrompt('),/Thinking or emotions do not explain real head drift/);
  assert.match(html,/actionVisionQuestion\(userTurn\|\|activeWonder\(\)\?\.question\|\|'',actionExperiences\)/);
  const inquiry=fs.readFileSync(root+'inquiry-progress.js','utf8');
  const body=inquiry.slice(inquiry.indexOf('function resumeInterruptedInvestigation('),inquiry.indexOf('function inquiryMigrateBlockedTasks('));
  const task={source:'owner',status:'blocked',requiresMotion:true,resumeOnConnection:true,blockedAt:1,evidence:[]};
  let shared=true;
  const recovery={APP:{},MIND:{on:true,motionArmed:true},AUTONOMY:{enabled:true},S:{bodyLastSeenAt:2},TASKS:{items:[task]},
    bodyControllerReady:()=>true,humanConversationOwnsResources:()=>shared,taskSave(){},autonomySave(){}};
  vm.createContext(recovery);vm.runInContext(body,recovery);
  assert.equal(recovery.resumeInterruptedInvestigation(),false);assert.equal(task.status,'blocked');
  shared=false;assert.equal(recovery.resumeInterruptedInvestigation(),true);assert.equal(task.status,'active');
  console.log('PASS action grounding: bow context, image limitations, single-axis looks, and conversation-priority reconnect recovery');
})().catch(e=>{console.error(e);process.exitCode=1;});
