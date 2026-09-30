const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.join(__dirname,'../app/src/main/assets');
const source=fs.readFileSync(path.join(root,'body-bow.js'),'utf8');
const html=fs.readFileSync(path.join(root,'growbot-brain.html'),'utf8');
function fixture(mode='ok'){
 const sent=[];let reads=0,clock=0;
 const box={APP:{},MIND:{motionArmed:true,gazeArmed:true},S:{},NW:{},HEAD:{explicitMoves:0,generation:0},CHANNEL_SETUP:{},WALK_STREAM:{},BODY_COMMAND_LANE:{generation:0},
   isDog6:()=>true,motorControlAvailable:()=>true,separateHead:()=>false,bodyControllerReady:()=>true,$:()=>({}),Date:{now:()=>clock},
   setTimeout:f=>{clock+=750;if(mode==='stop')box.BODY_COMMAND_LANE.generation++;f();},
   sendAcknowledgedBodyCommand:async m=>{sent.push(m);if(m.t==='stop')return {ok:1};
     if(m.t==='routine')return mode==='timeout'?{ok:0,err:'ack timeout'}:{ok:1,saved_body_command:{run_id:2}};
     reads++;return {ok:1,saved_body_command:{bow_implementation:mode==='old'?'old':'front-head-bow-v1',run_id:mode==='replaced'?3:2,last:'take a bow',active:reads===1?null:mode==='running'?'take a bow':null,completed:mode!=='incomplete',bow:{phase:mode==='incomplete'?'lower':'completed'}}};}};
 vm.createContext(box);vm.runInContext(source,box);return {box,sent};
}
(async()=>{
 for(const mode of ['ok','old','timeout','stop','replaced','incomplete','running']){
   const f=fixture(mode),reply=await f.box.runPicoBow();
   assert.match(reply,mode==='ok'?/^Pico completed the bow/:/^Bow failed/);
   assert.equal(f.sent.filter(m=>m.t==='routine').length,mode==='old'?0:1,'never replay a bow');
   assert.equal(f.box.HEAD.explicitMoves,0);assert.equal(vm.runInContext('BODY_BOW.active',f.box),false);
   if(['old','stop'].includes(mode))assert.equal(f.sent.some(m=>m.t==='stop'),false,'do not stop unrelated/newer work');
   if(mode==='ok'){assert.equal(f.sent[1].name,'take a bow');assert.equal(f.sent[1].t,'routine');assert.match(reply,/physical movement is not measured/);}
 }
 for(const guard of ['sleep','gaze','authority','headBusy','walking']){
   const f=fixture();if(guard==='sleep')f.box.APP.resting=true;if(guard==='gaze')f.box.MIND.gazeArmed=false;
   if(guard==='authority')f.box.motorControlAvailable=()=>false;if(guard==='headBusy')f.box.HEAD.explicitMoves=1;
   if(guard==='walking')f.box.NW.running=true;
   await f.box.runPicoBow();assert.equal(f.sent.length,0,guard);
 }
 const parser={namedChannelIntent:()=>null};vm.createContext(parser);
 vm.runInContext(html.slice(html.indexOf('function directBodyIntent('),html.indexOf('function scheduleRouteRecovery(')),parser);
 for(const text of ['bow','take a bow','Andrew take a bow','Can you please take a bow?'])assert.equal(parser.directBodyIntent(text)?.routine,'bow',text);
 for(const text of ['center your head','Andrew center your head','look straight ahead','Andrew looks straight ahead','please centre your head']){
   const a=parser.directBodyIntent(text);assert.equal(a.action,'head');assert.equal(a.pan,0);assert.equal(a.tilt,0);
 }
 for(const [text,axis,value] of [['Andrew lookup','tilt',1],['can you look up?','tilt',1],['lookdown','tilt',-1],['look left','pan',-1],['looks right please','pan',1]]){
   const a=parser.directBodyIntent(text);assert.equal(a.action,'head',text);assert.equal(a[axis],value);assert.equal(a[axis==='pan'?'tilt':'pan'],undefined,'preserve the other axis');
 }
 for(const text of ['do not bow','why did you bow','he says he cannot bow','center the body','tell me about a bow','look up the weather','lookup my friend','do not look up','if I say look left','he looks right','why did you look down'])assert.equal(parser.directBodyIntent(text),null,text);
 assert.equal(parser.directBodyIntent('turn left').routine,'turn_left');
 assert.match(html,/if\(normalRoutineName\(args.name\)===\x27bow\x27\)return await runPicoBow/);
 console.log('PASS OwlBot bow: routing, completion, interruption, timeout, no replay, authority, and direct head centering');
})().catch(e=>{console.error(e);process.exitCode=1});
