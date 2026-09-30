const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const dir=path.join(__dirname,'../app/src/main/assets');
const html=fs.readFileSync(path.join(dir,'growbot-brain.html'),'utf8'),head=fs.readFileSync(path.join(dir,'head-controller.js'),'utf8');
const cut=(text,start,end)=>text.slice(text.indexOf(start),text.indexOf(end,text.indexOf(start)));
const names=['recall','remember','inspect_capabilities','look_at','stop','read_sensors','read_distance','use_camera','express'];
const b={MIND:{socialTurn:false,perceptionTurn:false},AUTONOMY:{enabled:false},TOOLS:names.map(name=>({type:'function',function:{name}})),conversationReplyTool:()=>({function:{name:'reply_to_person'}}),phoneBrainSelected:()=>false};
vm.createContext(b);vm.runInContext(fs.readFileSync(path.join(dir,'executive-context.js'),'utf8').split('function embodiedSituation(){')[0],b);
for(const q of ['tilt your head down','Why don’t you try','Straight ahead','pan your head','center your head'])assert(b.executiveTools(q,true).some(t=>t.function.name==='look_at'),q);
const result=JSON.parse(b.loadExecutiveTools(['head_tilt']));assert.deepEqual(result.unknown,['head_tilt']);assert(result.available.includes('look_at'));assert.match(result.headTool,/pan:0, tilt:0/);
b.MIND.socialTurn=true;assert.deepEqual(Array.from(b.executiveTools('hello',true),t=>t.function.name),['reply_to_person']);b.MIND.socialTurn=false;
b.MIND.perceptionTurn=true;assert.deepEqual(Array.from(b.executiveTools('head',true),t=>t.function.name),['reply_to_person']);
const h={Date,HEAD:{stateAt:Date.now(),state:{config:{pan:{channel:8},tilt:{channel:9}},holding:true,moving:false}},
 APP:{resting:false,settings:false},MIND:{gazeArmed:true,visionReport:'old ceiling',visionReportAt:100},headReady:()=>true,separateHead:()=>false,headSemanticPosition:()=>0};
vm.createContext(h);vm.runInContext(cut(head,'function headCapabilitySnapshot(){','function headMessage('),h);
assert.equal(h.headCapabilitySnapshot().state,'ready');assert.equal(h.headCapabilitySnapshot().tool,'look_at');assert.equal(h.headCapabilitySnapshot().servoPowerMeasured,false);
h.APP.resting=true;assert.equal(h.headCapabilitySnapshot().reason,'sleeping');h.APP.resting=false;h.MIND.gazeArmed=false;assert.equal(h.headCapabilitySnapshot().state,'paused');h.MIND.gazeArmed=true;
h.headObserveBodyCommand({t:'dog_cal',channel_action:'move',targets:[{channel:0}]});assert.equal(h.MIND.visionReport,'old ceiling');
h.headObserveBodyCommand({t:'dog_cal',channel_action:'move',targets:[{channel:8}]});assert.equal(h.MIND.visionReport,'');assert.equal(h.HEAD.viewGeneration,1);
const describe=cut(html,'async function describeFrameForBrain(', '\nfunction ');
// Extract through its final return to avoid depending on the following helper.
const end=describe.indexOf('\n  return report;\n}');assert(end>0);
const v={S:{cameraFacing:'front'},cameraGeneration:1,HEAD:{viewGeneration:0},MIND:{visionReport:'',visionReportAt:0},Date,LOCAL_VISION:{status:{}},identityEnrollmentActive:()=>false,cachedVisionReport:()=>'',sensorAwarenessContext:()=>'',localVisionRoute:()=> 'cloud',localVisionReady:()=>false,mindHeaders:()=>({}),visualAttentionFromReport:()=>{},
 mindFetch:async()=>{v.HEAD.viewGeneration++;return {ok:true,json:async()=>({choices:[{message:{content:'old ceiling report'}}]})};}};
vm.createContext(v);vm.runInContext(describe.slice(0,end+'\n  return report;\n}'.length),v);
(async()=>{await assert.rejects(()=>v.describeFrameForBrain('unused','mock','synthetic',null),/Head view changed/);assert.equal(v.MIND.visionReport,'');console.log('PASS head tools for short follow-ups, unknown-tool discovery, paused/ready truth, manual-head cache invalidation and in-flight old-view rejection.');})().catch(e=>{console.error(e);process.exitCode=1;});
