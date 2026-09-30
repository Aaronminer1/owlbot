const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/growbot-brain.html'),'utf8');
const fn=html.slice(html.indexOf('async function goToSavedChannelCenter(){'),html.indexOf("$('#btnChannelTestCenter').onclick="));
let saved={channel:8,enabled:true,calibrated:true,locked:true,a_us:2109,b_us:1241,center_us:1675},selected=8,messages=[],sent=[],stops=0;
const box={CHANNEL_SETUP:{loaded:true,live:false},$:()=>({value:selected}),channelRecord:()=>saved,
 channelMessage:m=>messages.push(m),stopChannelAdjustment:async()=>{stops++;box.CHANNEL_SETUP.live=false;},
 channelCommand:async(action,payload)=>sent.push({action,...payload})};
vm.createContext(box);vm.runInContext(fn,box);
(async()=>{
 await box.goToSavedChannelCenter();assert.equal(sent[0].targets[0].pulse_us,1675);assert.equal(sent[0].targets[0].channel,8);
 assert.equal(sent[0].calibration,false);assert.equal(sent[0].speed_us_s,150);assert.match(messages.at(-1),/Physical arrival is not measured/);
 box.CHANNEL_SETUP.live=true;await box.goToSavedChannelCenter();assert.equal(stops,1);
 const good={...saved};for(const change of [{enabled:false},{calibrated:false},{center_us:NaN},{center_us:2400},{center_us:400},{a_us:null}]){
  const count=sent.length;saved={...good,...change};await box.goToSavedChannelCenter();assert.equal(sent.length,count);
 }
 saved=good;box.CHANNEL_SETUP.loaded=false;let count=sent.length;await box.goToSavedChannelCenter();assert.equal(sent.length,count);
 box.CHANNEL_SETUP.loaded=true;selected=9;await box.goToSavedChannelCenter();assert.equal(sent.length,count);
 selected=8;box.channelCommand=async()=>{throw Error('Pico disconnected');};await box.goToSavedChannelCenter();assert.equal(messages.at(-1),'Pico disconnected');
 assert.ok(html.includes('id="btnChannelTestCenter"'));
 assert.ok(html.includes("['btnChannelTestA','btnChannelTestCenter','btnChannelTestB']"));
 console.log('PASS saved center 1675, locked calibration allowed for normal motion, reversed limits, invalid state, stop adjustment first, UI wiring and truthful ACK. No hardware used.');
})().catch(e=>{console.error(e);process.exitCode=1;});
