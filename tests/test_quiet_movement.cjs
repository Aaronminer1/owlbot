const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/growbot-brain.html'),'utf8');
assert.match(html,/name:"speak",description:/,'speech handler must also have a discoverable tool schema');
const box={};vm.createContext(box);
vm.runInContext(html.slice(html.indexOf('function quietPhysicalRequest('),html.indexOf('function groundedSpokenReply(')),box);
for(const request of ['Andrew walk forward','Turn left','Tilt up','Look at me','Explore the room','ROUTE RECOVERY requested by the owner','AUTONOMOUS PERCEPTION UPDATE']){
  assert.equal(box.quietPhysicalRequest(request),true,request);
  for(const result of ['I finished three walk cycles.','Pico completed Turn B: all feet down.','Let me execute it.','The immediate path is blocked. I am looking for another route.'])assert.equal(box.physicalActionSpeech(result,request),'');
}
for(const request of ['Why did you stop walking?','Describe what you see','Tell me how the turn went','Say happy birthday','What can you see?']){
  assert.equal(box.quietPhysicalRequest(request),false,request);
  assert.equal(box.physicalActionSpeech('Your requested explanation.',request),'Your requested explanation.');
}
assert.equal(box.physicalActionSpeech('Head movement failed: ack timeout','look left'),'Movement paused. The controller is not responding.');
assert.equal(box.physicalActionSpeech('Fire nearby','Explore the room',true),'Fire nearby');
assert.equal(box.quietPhysicalRequest('Andrew are you enjoying your walk around the room'),false);
const complete='I am enjoying seeing the room from a new angle. '+ 'The yellow container is interesting because its label might tell us what it is used for, although I cannot see what is inside it from here.';
assert.equal(box.physicalActionSpeech(complete,'Andrew are you enjoying your walk around the room'),complete);
assert.equal(box.physicalActionSpeech("What's that? Let me move closer.",'Explore the room'),"What's that?");
assert.equal(box.physicalActionSpeech('I wonder what that dial controls. I am scanning the floor.','Explore the room'),'I wonder what that dial controls.');
assert.equal(box.physicalActionSpeech('I finished three cycles. The label says it is a heater.','Explore the room'),'The label says it is a heater.');
assert.equal(box.physicalActionSpeech('I found a clear path. Shall I walk three cycles?','Explore the room'),'');
assert.equal(box.physicalActionSpeech('Would you like me to see what that label says?','Explore the room'),'Would you like me to see what that label says?');
for(const line of [
  'Would you like to see what I found?',
  'I could not read that label, but the shape is interesting.',
  "I cannot tell yet. My guess is that it opens like a treasure chest.",
  'Can I tell you my theory?',
  'Do you want to guess what is inside?',
  'Should I call that box our mystery machine?',
  'I wonder how the Pico talks to my phone.',
  'That toy controller looks like a tiny spaceship.',
  'That idea failed, but it gave me a better question.',
  'The radio is offline, so maybe it needs batteries.',
  'I am looking forward to solving our little mystery.',
  'That is a funny shape! It reminds me of our pretend spaceship. What would you name it?'
])assert.equal(box.physicalActionSpeech(line,'Explore the room'),line,'keep personality: '+line);
for(const line of ['Shall I walk three cycles?','Can I turn left?','Would you like me to move forward?'])
  assert.equal(box.physicalActionSpeech(line,'Explore the room'),'','suppress only motor approval: '+line);
assert.equal(box.physicalActionSpeech('Head movement failed: ack timeout. Would you like to guess what that dial does?','Explore the room'),'Movement paused. The controller is not responding. Would you like to guess what that dial does?');
assert.equal(box.physicalActionSpeech('That orange case might contain tools. The writing is too small to read from here.','Explore the room'),'That orange case might contain tools. The writing is too small to read from here.');
assert.equal(box.unexecutedMovementPromise('Let me execute it.','Explore the room',false),true);
assert.equal(box.unexecutedMovementPromise('I will walk forward.','Walk forward',true),false);
const start=html.indexOf('    if(name==="speak"){'),end=html.indexOf('\n    }',start)+6;
box.spoken=[];box.spokenReply=s=>s;box.mindLog=()=>{};box.say=s=>box.spoken.push(s);
vm.runInContext('function tool(name,args,context={}){'+html.slice(start,end)+'}',box);
assert.match(box.tool('speak',{text:'I am scanning the floor.'},{speechRequest:'Explore the room'}),/remained quiet/);
assert.equal(box.spoken.length,0);
box.tool('speak',{text:'The floor is clear.'},{speechRequest:'Tell me what you see'});
assert.deepEqual(box.spoken,['The floor is clear.']);
box.tool('speak',{text:'Is that a radio?'},{speechRequest:'Explore the room'});
assert.deepEqual(box.spoken,['The floor is clear.','Is that a radio?']);
box.APP={resting:false,settings:false};box.MIND={motionArmed:true,pendingAgentEvent:null};box.setTimeout=()=>0;
vm.runInContext(html.slice(html.indexOf('function scheduleRouteRecovery('),html.indexOf('function handleDirectBodyIntent(')),box);
assert.equal(box.scheduleRouteRecovery('forward','box on the next foot placement'),true);
const recovery=box.MIND.pendingAgentEvent;
assert.match(recovery,/inspect another direction/);assert.match(recovery,/obstruction may move/);
box.scheduleRouteRecovery('forward','same box');assert.equal(box.MIND.pendingAgentEvent,recovery,'direct and tool failure handlers do not duplicate recovery');
box.APP.resting=true;box.MIND.pendingAgentEvent=null;
assert.equal(box.scheduleRouteRecovery('forward','box'),false,'Sleep cannot launch recovery');
assert.equal(box.MIND.pendingAgentEvent,null);
box.APP.resting=false;box.MIND.motionArmed=false;
assert.equal(box.scheduleRouteRecovery('forward','box'),false,'master motor off cannot launch recovery');
console.log('PASS: quiet physical actions and recovery; requested conversation and urgent warnings preserved; explicit speak tool cannot bypass quiet action policy.');
