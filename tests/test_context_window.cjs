const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const dir=path.join(__dirname,'../app/src/main/assets'),C=require(path.join(dir,'context-window.js'));
const html=fs.readFileSync(path.join(dir,'growbot-brain.html'),'utf8');
const source=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
const prior=Array.from({length:100},(_,i)=>[{role:'user',content:'old request '+i+' '+('x'.repeat(1000))},{role:'assistant',content:'old answer '+i}]).flat();
const action=[{role:'assistant',content:'',tool_calls:[{id:'one',type:'function',function:{name:'read_sensors',arguments:'{}'}},{id:'two',type:'function',function:{name:'recall',arguments:'{}'}}]},
  {role:'tool',tool_call_id:'one',content:'complete sensor result'}, {role:'tool',tool_call_id:'two',content:'evidence '.repeat(30000)}];
const result=C.compile({messages:[{role:'system',content:'Keep original instructions'},...prior,{role:'user',content:'CURRENT USER REQUEST'},...action],_owlHistoryCount:prior.length,max_tokens:1200},{window:8192});
assert(result.stats.input+result.stats.output+result.stats.reserve<=8192);
assert.equal(result.body.messages[0].content,'Keep original instructions');
assert(result.body.messages.some(m=>m.content==='CURRENT USER REQUEST'));
assert.deepEqual(result.body.messages.filter(m=>m.role==='tool').map(m=>m.tool_call_id),['one','two']);
assert.equal(result.body._owlHistoryCount,undefined);assert(result.stats.removedMessages>=194);assert(result.stats.shortenedResults>0);
assert.throws(()=>C.compile({messages:[{role:'tool',tool_call_id:'orphan',content:'x'}]}),/orphan/);
assert.throws(()=>C.compile({messages:action.slice(0,2)}),/Incomplete/);
assert.throws(()=>C.compile({messages:[{role:'system',content:'x'.repeat(100000)}]}),/Nothing was sent/);
const sequence=Array.from({length:8},(_,i)=>[{role:'assistant',content:'',tool_calls:[{id:'step'+i,type:'function',function:{name:'look_at',arguments:JSON.stringify({pan:.2,tilt:0})}}]},
  {role:'tool',tool_call_id:'step'+i,content:'Controller completion; physical result unknown. '+('detail '.repeat(5000))}]).flat();
const reduced=C.compile({messages:[{role:'system',content:'x'.repeat(3500)},{role:'user',content:'Keep investigating the label'},...sequence],max_tokens:700},{window:8192});
assert(reduced.stats.compactedExchanges>0);assert(reduced.body.messages.some(m=>m.content==='Keep investigating the label'));
assert.equal(reduced.body.messages.at(-1).tool_call_id,'step7');C.groups(reduced.body.messages);
assert.match(reduced.body.messages.find(m=>m.content?.startsWith('Earlier completed')).content,/physical result unknown/);
assert.equal(C.reasoningPolicy({model:'glm-5.3',reasoning_effort:'none',think:false}).reasoning_effort,'low');
assert.equal(C.reasoningPolicy({model:'glm-5.3:cloud'}).clear_thinking,true);
assert.equal(C.reasoningPolicy({model:'gemma4:12b',think:false}).think,false,'unrelated provider settings must not change');
assert.doesNotThrow(()=>C.compile({messages:[{role:'user',content:'large-window model'}]},{window:976000}));
const image=C.compile({messages:[{role:'user',content:[{type:'text',text:'Inspect'},{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+'a'.repeat(500000)}}]}],max_tokens:500});
assert(image.stats.input>=4096&&image.stats.input<5000,'image reserve is not a base64 text estimate');
const records=Array.from({length:2000},(_,i)=>({text:'routine battery reading '+i,t:i}));
records.push({kind:'lesson',text:'Carpet edge: look down before approaching; forward slid without progress.',t:4});
const found=C.retrieve(records,'approaching carpet edge');assert.equal(found.items.length,1);assert.match(found.items[0].text,/look down/);
assert(C.retrieve(records,'', {characters:200}).items.length<8);
const fields=new Proxy({contextWindow:{value:'16384'},mSoul:{value:''},walkForwardCamera:{value:'front'},turnAPhysical:{value:'right'}},{get:(o,k)=>o[k]||(o[k]={value:'',textContent:''})});
const box={console,TextEncoder,Date,Set,Map,JSON,Math,Promise,OwlContext:C,localStorage:{getItem:()=>null,setItem:()=>{}},
  $:s=>fields[s.slice(1)],SOUL_FILE_TEXT:fs.readFileSync(path.join(dir,'SOUL.md'),'utf8'),SELF:{tuning:{initiativeIntervalSeconds:60}},
  MIND:{autonomyTurn:true,perceptionTurn:false,visionReport:'A carpet edge and unfamiliar box are visible.',visionReportAt:Date.now(),visionReportFacing:'front'},
  APP:{resting:false,settings:false},AUTONOMY:{enabled:true,world:[]},IDENT:{enabled:false},MEM:{lessons:[],facts:[],longTerm:[],shared:[],summaries:[],conversations:[]},
  BEING:{embodiment:{phoneMount:'mounted',bodyAssembly:'assembled_body'}},CHANNEL_SETUP:{loaded:true},THERMAL:{paused:false},
  S:{cameraFacing:'front',camOK:true,flow:{}},NW:{plan:{cycles:3,speed_us_s:1000,lift_percent:50}},
  bodyControllerReady:()=>true,motorControlSnapshot:()=>({ownerAuthorized:true,andrewEnabled:true}),verifiedIdentity:()=>null,
  activePersonalMission:()=>null,activeOwnerTask:()=>null,activeSelfTask:()=>null,conversationalTurn:()=>false,
  conversationReplyTool:()=>({type:'function',function:{name:'reply_to_person',description:'Reply.',parameters:{type:'object',properties:{say:{type:'string'}},required:['say']}}}),
  functionalSelfSummary:()=>'Andrew, mounted in his calibrated body.',personalitySummary:()=>'Curious and mature.',soulSummary:()=>'',affectSummary:()=>'curious',backgroundSummary:()=>'',
  EXPRESSIONS:{happy:{},curious:{},neutral:{}},SELF_LIMITS:{initiativeIntervalSeconds:[45,180]},memSave:()=>{}};
vm.createContext(box);vm.runInContext(source('const TOOLS = [','function gimbalReady(').replace(/\r/g,''),box);
assert(vm.runInContext("TOOLS.some(t=>t.function.name==='speak')",box),'mid-investigation voice is a real tool, not just a prompt instruction');
// TOOLS spelling has intentionally stable extraction verified below.
assert(vm.runInContext('TOOLS.length',box)>20);
vm.runInContext(fs.readFileSync(path.join(dir,'context-memory.js'),'utf8'),box);
vm.runInContext(fs.readFileSync(path.join(dir,'executive-context.js'),'utf8'),box);
vm.runInContext(source('function looksVisionModel(','function populateModels('),box);
assert.equal(box.modelContextCapacity('glm-5.2'),976000);
assert.equal(box.modelContextCapacity('glm-5.3'),1000000);
assert.equal(box.modelContextCapacity('glm-5.3-flash:cloud'),1000000);
assert.equal(box.modelContextCapacity('kimi-k2.7-code'),256000);
assert.equal(box.modelContextCapacity('gemma-4-e4b'),128000);
assert.equal(box.looksVisionModel('glm-5.2:cloud'),false);
assert.equal(box.looksVisionModel('glm-5.3-flash:cloud'),true);
assert.equal(box.looksVisionModel('kimi-k2.7-code:cloud'),true);
fields.contextWindow.value='976000';
box.compileModelContext({body:JSON.stringify({model:'kimi-k2.7-code',messages:[{role:'user',content:'Inspect one frame'}],max_tokens:1200})});
assert.equal(vm.runInContext('CONTEXT_STATS.last.window',box),256000,'vision requests must use the vision model capacity, not the larger brain window');
const prompt=box.buildExecutiveContext(''),tools=box.executiveTools('');
const normal=C.compile({messages:[{role:'system',content:prompt},{role:'user',content:'Nobody spoke. Explore a worthwhile curiosity.'}],tools,max_tokens:1200});
assert(normal.stats.input+2224<16384,'real executive prompt and selected schemas fit');
assert(tools.some(t=>t.function.name==='move'));assert(tools.some(t=>t.function.name==='propose_goal_candidates'));
assert(tools.length<vm.runInContext('TOOLS.length',box));
box.MIND.autonomyTurn=false;
const conversationTools=box.executiveTools('Tell me what is on your self-improvement list',true);
assert(!conversationTools.some(t=>t.function.name==='move'),'ordinary conversation must not pay for unused movement schemas');
assert(conversationTools.some(t=>t.function.name==='reply_to_person'));
assert(box.executiveTools('Make a direction',true).some(t=>t.function.name==='move'),'direction follow-ups must retain movement tools');
const conversationPrompt=box.buildExecutiveContext('Tell me what is on your self-improvement list');
const conversationRequest=C.compile({messages:[{role:'system',content:conversationPrompt},{role:'user',content:'Tell me what is on your self-improvement list'}],tools:conversationTools,max_tokens:1200});
assert(conversationRequest.stats.input+conversationRequest.stats.output+conversationRequest.stats.reserve<=16384);
assert.match(prompt,/No optical flow does not prove a collision/);assert.match(prompt,/standing authority/);
assert.match(prompt,/farther wall or eventual route boundary does not veto/);
assert.equal(box.embodiedSituation().camera.forward,'front');assert.equal(box.embodiedSituation().camera.backward,'back');
box.loadExecutiveTools(['propose_soul_growth','propose_self_adjustment']);assert(box.executiveTools('').some(t=>t.function.name==='propose_soul_growth'));
box.recordEmbodiedExperience('move',{forward:1},'controller completed',{facing:'front',report:'carpet edge'},{facing:'front',report:'no visible progress at carpet edge'});
assert.match(box.relevantMemoryContext('carpet'),/no visible progress/,'experience is retrieved for future decisions');
box.MEM.people={sam:{name:'Sam',notes:['likes astronomy'],seen:10}};
assert.match(box.relevantMemoryContext('astronomy'),/does not identify whoever is currently present/,'person notes remain retrievable without a false current identity');
if(require.main===module)console.log('PASS context: bounded real schemas/prompt, atomic tool exchanges, unchanged intent, relevant retrieval, persistent evidence and directional body semantics.',normal.stats);
module.exports={box,C};
