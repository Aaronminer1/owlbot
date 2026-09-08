const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/growbot-brain.html'),'utf8');
const e={mProvider:{value:'tower-local'},mBase:{value:'http://tower/v1'},mModels:{textContent:''}};let resolveOld,applied=[],calls=0;
const box={AbortController,setTimeout,clearTimeout,$:s=>e[s.slice(1)],PROVIDERS:{'phone-local':{phone:true}},phoneBrainModels:()=>['gemma4-e4b-phone'],mindHeaders:()=>({}),populateModels:ids=>{applied=ids;return ids},prefsSave(){},refreshProviderUI(){},log(){},modelConnectionError:x=>x.message,
 fetch:()=>{calls++;return new Promise(r=>resolveOld=r)}};
vm.createContext(box);vm.runInContext(html.slice(html.indexOf('let MODEL_DISCOVERY='),html.indexOf('async function checkTowerLocal(')),box);
(async()=>{const old=box.listModels();e.mProvider.value='phone-local';e.mBase.value='phone://gemma4';const local=await box.listModels();assert.equal(local.count,1);assert.equal(calls,1);resolveOld({ok:true,json:async()=>({data:[{id:'stale-tower-model'}]})});await old;assert.deepEqual(applied,['gemma4-e4b-phone']);assert.match(e.mModels.textContent,/Installed on this phone/);console.log('PASS: phone discovery never fetches; stale Tower results cannot replace another provider.');})().catch(e=>{console.error(e);process.exitCode=1});
