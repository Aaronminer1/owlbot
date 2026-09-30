const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'../app/src/main/assets');
const code=fs.readFileSync(path.join(root,'owner-motion-request.js'),'utf8');
const html=fs.readFileSync(path.join(root,'growbot-brain.html'),'utf8');
const storage=new Map(),calls=[];let tick=1000;
const box={Date:{now:()=>++tick},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
 MIND:{motionArmed:true,directBodyQueue:[{text:'old walk'}],userQueue:[{text:'question'}]},
 WALK_STREAM:{session:{active:true}},NW:{abort:{abort:()=>calls.push('abort')}},
 cancelWalkingSession:()=>{box.WALK_STREAM.session.active=false;calls.push('cancel');},
 channelCommand:async a=>calls.push(a),bodyControllerReady:()=>true,refreshMotionButton:()=>{},
 headNamedTarget:(subject)=>subject==='head'?{pan:0}:null};
vm.createContext(box);vm.runInContext(code,box);
for(const text of ['Keep your feet still for now and gently look left.','Please keep your body stationary.','Andrew, do not turn your body.','Just move your head.'])assert.equal(box.ownerMotionDirective(text),'hold',text);
for(const text of ['Walk forward eight cycles','Turn left','Go explore','Continue exploring','Resume walking','Back up','Take a bow','Can you walk forward?','I want you to walk forward.'])assert.equal(box.ownerMotionDirective(text),'resume',text);
for(const text of ['Look left','What is a computer mouse?','Why did you walk forward?','He said "walk forward".','Can you explain how to walk forward?','Do not approach the dog.','If I say walk forward, what happens?',"Don't walk into the wall.","Don't turn your body toward the dog."])assert.equal(box.ownerMotionDirective(text),null,text);
box.acceptOwnerMotionRequest('Keep your feet still for now and gently look left.');
assert.equal(box.ownerMotionSnapshot().feetStill,true);
assert.deepEqual(calls,['cancel','abort','walk_halt','turn_halt']);
assert.equal(box.MIND.motionArmed,true,'standing motor authority unchanged');
assert.equal(box.MIND.directBodyQueue.length,0,'do not replay old deferred leg commands');
assert.equal(box.MIND.userQueue.length,1,'retain conversation queue');
for(const name of ['move','start_walking','gesture','perform_body_sequence','test_body_output','test_servo','move_named_servos'])assert.match(box.ownerMotionToolProblem(name,{}),/Not executed/,name);
for(const name of ['look_at','stop','stop_walking','read_distance','use_camera','speak','load_tools','set_motor_control'])assert.equal(box.ownerMotionToolProblem(name,{}),'',name);
assert.equal(box.ownerMotionToolProblem('move_named_servos',{subject:'head'}),'');
box.acceptOwnerMotionRequest('How far is the doorway?');assert.equal(box.ownerMotionSnapshot().feetStill,true);
const reload={...box};vm.createContext(reload);vm.runInContext(code,reload);assert.equal(reload.ownerMotionSnapshot().feetStill,true,'hold survives app restart');
box.acceptOwnerMotionRequest('Walk forward eight cycles');assert.equal(box.ownerMotionSnapshot().feetStill,false);assert.equal(box.ownerMotionToolProblem('move',{}),'');
// Exercise the production dispatch gate, not merely the parser.
const start=html.indexOf('async function runTool(name, args, context={}){');
const gate=html.slice(start,html.indexOf("  if(name==='list_stories')",start))+"return 'allowed';}";
vm.runInContext(gate,box);
(async()=>{
 box.acceptOwnerMotionRequest('Keep your legs still.');
 assert.match(await box.runTool('move',{direction:'left'}),/Not executed/);
 assert.match(await box.runTool('start_walking',{direction:'forward'}),/Not executed/);
 assert.equal(await box.runTool('look_at',{pan:-.6}),'allowed');
 assert.equal(await box.runTool('stop',{}),'allowed');
 box.acceptOwnerMotionRequest('Go explore');assert.equal(await box.runTool('start_walking',{direction:'forward'}),'allowed');
 assert.match(html,/acceptOwnerMotionRequest\(t\)/);assert.match(html,/acceptOwnerMotionRequest\(text\)/);
 assert.match(html,/feet held by request/,'hold is visible in Controls');
 assert.match(html,/walking is still active\. Record progress, not arrival/);
 console.log('PASS: explicit feet hold, allowed head/read/Stop, no queue replay, normal exploration resumption, restart persistence and real dispatch gate.');
})().catch(e=>{console.error(e);process.exitCode=1;});
