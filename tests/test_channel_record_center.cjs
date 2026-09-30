const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/growbot-brain.html'),'utf8');
let saved={channel:8,enabled:true,locked:false,a_us:2109,b_us:1241,center_us:1675},draft={...saved};
const elements={channelSelect:{value:8},channelCenter:{value:1675},channelSaveState:{textContent:''}},messages=[],calls=[];
let state={active:null,queued:0,commanded:{8:1600}},delay=null;
const box={CHANNEL_SETUP:{loaded:true,generation:1,drafts:{}},$:id=>elements[id.slice(1)],channelRecord:()=>saved,readChannelDraft:()=>({...draft}),
 channelMessage:m=>messages.push(m),channelCommand:async action=>{calls.push(action);if(delay)await delay();return {channel_state:state};}};
vm.createContext(box);
vm.runInContext(html.slice(html.indexOf('function channelMidpoint('),html.indexOf('function readChannelDraft(')),box);
vm.runInContext(html.slice(html.indexOf('function setChannelCenterDraft('),html.indexOf("$('#btnChannelRecordCenter').onclick=")),box);
(async()=>{
 box.setChannelCenterDraft(1590);assert.equal(elements.channelCenter.value,1590);assert.equal(box.CHANNEL_SETUP.drafts[8].center_us,1590);
 assert.equal(saved.center_us,1675);assert.equal(calls.length,0,'typing or midpoint selection does not send commands');
 await box.recordChannelCenter();assert.equal(elements.channelCenter.value,1600);assert.deepEqual(calls,['info']);
 for(const s of [{active:{},queued:0,commanded:{8:1700}},{active:null,queued:1,commanded:{8:1700}},{active:null,queued:0,commanded:{}},{active:null,queued:0,commanded:{8:2300}}]){
  state=s;await box.recordChannelCenter();assert.equal(elements.channelCenter.value,1600);
 }
 saved.locked=true;let count=calls.length;await box.recordChannelCenter();assert.equal(calls.length,count);assert.throws(()=>box.setChannelCenterDraft(1550),/unlock/);
 saved.locked=false;state={active:null,queued:0,commanded:{8:1700}};delay=async()=>{elements.channelSelect.value=9;};
 await box.recordChannelCenter();assert.equal(elements.channelCenter.value,1600);assert.match(messages.at(-1),/changed/);
 assert.ok(calls.every(x=>x==='info'),'record center never moves or saves automatically');
 console.log('PASS center draft, settled commanded-position capture, limits, lock, missing feedback and selection race; no motor or save commands.');
})().catch(e=>{console.error(e);process.exitCode=1;});
