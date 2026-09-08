const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/growbot-brain.html'),'utf8');
let moves=0,loads=0,stops=0,message='',ready=true,record={enabled:true,locked:false,center_us:1500};
const elements={},box={CHANNEL_SETUP:{loaded:false,live:false,generation:0},S:{sim:false},
 bodyControllerReady:()=>ready,channelRecord:()=>record,channelMessage:s=>message=s,
 loadControllerChannels:async()=>{loads++;box.CHANNEL_SETUP.loaded=true;},
 stopChannelAdjustment:async()=>{stops++;box.CHANNEL_SETUP.live=false;},
 moveChannelLive:async()=>{moves++;},renderChannelEditor:()=>{},$:s=>elements[s]||(elements[s]={})};
vm.createContext(box);vm.runInContext(html.slice(html.indexOf('async function startChannelAdjustment(){'),html.indexOf('$("#btnChannelLive").onclick=startChannelAdjustment;')),box);
(async()=>{
 await box.startChannelAdjustment();assert.equal(loads,1);assert.equal(moves,0);assert.equal(box.CHANNEL_SETUP.live,false);assert.match(message,/No movement/);
 await box.startChannelAdjustment();assert.equal(moves,1);assert.equal(box.CHANNEL_SETUP.live,true);
 await box.startChannelAdjustment();assert.equal(stops,1);assert.equal(moves,1);
 record.locked=true;await box.startChannelAdjustment();assert.match(message,/Unlock/);assert.equal(moves,1);
 record.locked=false;record.enabled=false;await box.startChannelAdjustment();assert.match(message,/Unused/);assert.equal(moves,1);
 ready=false;await box.startChannelAdjustment();assert.match(message,/Connect/);assert.equal(moves,1);
 box.S.sim=true;ready=true;await box.startChannelAdjustment();assert.equal(moves,1);
 console.log('PASS: first click loads only; explicit second click adjusts; locked, unused, offline and simulation do not move.');
})().catch(e=>{console.error(e);process.exitCode=1});
