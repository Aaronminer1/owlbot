/* Independent ESP32 head transport. Never shares a socket or ACK map with Pico. */
const HEAD={ws:null,ready:false,lastSeen:0,lastSent:0,rid:0,pending:new Map(),state:null,generation:0,manual:false,retryAt:0,disconnects:0,lastDisconnectReason:'',events:[],heartbeatPending:false};
function headEvent(reason){
  HEAD.lastDisconnectReason=reason;HEAD.events.push({time:Date.now(),reason});
  if(HEAD.events.length>20)HEAD.events.shift();
}
function headHeartbeatNeeded(){return headReady()&&!HEAD.heartbeatPending&&HEAD.pending.size===0&&Date.now()-HEAD.lastSent>=700&&
  (separateHead()||Boolean(HEAD.state?.holding&&(APP.settings||!APP.resting)));}
function separateHead(){return $('#headRoute').value==='esp32';}
function headReady(){return separateHead()?(HEAD.ready&&HEAD.ws?.readyState===1&&Date.now()-HEAD.lastSeen<3000):bodyControllerReady();}
function headMessage(text){$('#headMessage').textContent=text;}
function headNamedTarget(subject,position){
  const name=String(subject||'').toLowerCase().replace(/[_-]/g,' ').trim();
  const axis=/^(?:pan|head pan|gimbal pan)$/.test(name)?'pan':/^(?:tilt|head tilt|gimbal tilt)$/.test(name)?'tilt':null;
  if(!axis)return null;
  const p=String(position||'center').toLowerCase().trim(),c=HEAD.state?.config?.[axis];
  if(['min','minimum','max','maximum'].includes(p))return {axis,pulse:c?(p.startsWith('min')?c.minimum:c.maximum):null};
  const value=/^(center|centre|straight|straight ahead)$/.test(p)?0:/^(left|down)$/.test(p)?-1:/^(right|up)$/.test(p)?1:null;
  return value===null?{axis,pulse:null}:{[axis]:value};
}
function headFailPending(){for(const p of HEAD.pending.values()){clearTimeout(p.timer);p.reject(Error('Head connection closed'));}HEAD.pending.clear();}
function disconnectHead(manual=true,reason=''){
  if(reason){headEvent(reason);if(HEAD.ready)HEAD.disconnects++;headMessage(reason+' — movement stopped; no movement will be replayed.');}
  HEAD.manual=manual;HEAD.generation++;HEAD.ready=false;
  const ws=HEAD.ws;HEAD.ws=null;
  if(ws?.readyState===1){try{ws.send(JSON.stringify({t:'stop',rid:++HEAD.rid}));}catch(e){}}
  try{ws?.close();}catch(e){}
  headFailPending();HEAD.retryAt=Date.now()+5000;renderHead();
}
function headRequest(t,args={},walkAlignment=false){
  // Phone holder: head speed never follows the body's walking pace.
  if(t==='move')args={...args,slow:true};
  if(t==='move'&&typeof NW!=='undefined'&&NW.checkingPath&&!walkAlignment)
    return Promise.reject(Error('Head look deferred while the walking camera checks straight ahead'));
  if(!separateHead()){
    if(!bodyControllerReady())return Promise.reject(Error('Pico head is disconnected'));
    if(!['move','info','stop','release','ping'].includes(t))return Promise.reject(Error('Set Pico head limits in Servo setup'));
    // Mount direction is independent of sorted electrical travel limits.
    // Transform semantic gaze here so buttons, named looks, legacy gaze and
    // walking clearance all agree. Raw calibration pulses remain untouched.
    const inverted={pan:$('#headPicoPanInvert').checked,tilt:$('#headPicoTiltInvert').checked};
    if(t==='move'&&args.axis==null){
      args={...args};
      for(const axis of ['pan','tilt'])if(inverted[axis]&&typeof args[axis]==='number')args[axis]=-args[axis];
    }
    HEAD.lastSent=Date.now();
    return channelCommand('head_'+(['release'].includes(t)?'stop':t==='ping'?'info':t),args).then(ack=>{
      if(ack.state){
        ack={...ack,state:{...ack.state,config:Object.fromEntries(Object.entries(ack.state.config||{}).map(([axis,c])=>[axis,{...c,invert:Boolean(inverted[axis])}]))}};
        HEAD.state=ack.state;
      }
      return ack;
    });
  }
  if(!headReady())return Promise.reject(Error('ESP32 head is disconnected'));
  return new Promise((resolve,reject)=>{
    const rid=++HEAD.rid;
    const timer=setTimeout(()=>{HEAD.pending.delete(rid);reject(Error('ESP32 head reply timed out'));disconnectHead(false,'ESP32 '+t+' reply timed out');},2200);
    HEAD.pending.set(rid,{resolve,reject,timer});
    try{HEAD.lastSent=Date.now();HEAD.ws.send(JSON.stringify({...args,t,rid}));}catch(e){clearTimeout(timer);HEAD.pending.delete(rid);reject(e);disconnectHead(false,'ESP32 send failed');}
  });
}
function connectHead(){
  if(!separateHead())return;
  disconnectHead(false);HEAD.manual=false;
  const host=$('#headHost').value.trim(),key=$('#headKey').value.trim();
  if(!host||!key){HEAD.manual=true;headMessage('Enter the ESP32 address and its pairing key.');return;}
  let url;try{url=new URL(/^wss?:\/\//.test(host)?host:'ws://'+host+':8766/head');
    if(!['ws:','wss:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error();
  }catch(e){HEAD.manual=true;headMessage('Use an ESP32 IP address or a ws://address:8766/head URL.');return;}
  let ws;try{ws=new WebSocket(url.href);}catch(e){headMessage('Invalid ESP32 address');return;}
  HEAD.ws=ws;renderHead();
  const timeout=setTimeout(()=>{if(HEAD.ws===ws&&!HEAD.ready)disconnectHead(false,'ESP32 did not authenticate');},4000);
  ws.onopen=()=>{if(HEAD.ws===ws)ws.send(JSON.stringify({t:'auth',key,rid:++HEAD.rid}));};
  ws.onmessage=ev=>{
    if(HEAD.ws!==ws)return;
    let m;try{m=JSON.parse(ev.data);}catch(e){return;}
    const first=!HEAD.ready;
    if(first){
      if(!m.ok||m.kind!=='owlbot-head'){HEAD.manual=true;headMessage('Head pairing failed or another phone is connected');disconnectHead(true);return;}
      HEAD.ready=true;clearTimeout(timeout);headMessage('ESP32 head connected. Body connection is unchanged.');
    }
    HEAD.lastSeen=Date.now();if(m.state)HEAD.state=m.state;
    if(first)loadHeadSettings();
    const p=HEAD.pending.get(m.rid);
    if(p){clearTimeout(p.timer);HEAD.pending.delete(m.rid);m.ok?p.resolve(m):p.reject(Error(m.error||'Head command rejected'));}
    renderHead();
  };
  ws.onclose=ev=>{clearTimeout(timeout);if(HEAD.ws===ws)disconnectHead(HEAD.manual,'ESP32 socket closed (code '+(ev?.code??'unknown')+')');};
  ws.onerror=()=>{if(HEAD.ws===ws)headMessage('ESP32 connection error');};
}
function headStop(){
  HEAD.generation++;
  $('#headLiveEnabled').checked=false;
  if(!headReady())return Promise.resolve(false);
  return headRequest('stop').then(()=>true).catch(()=>false);
}
async function headMove(values,owner=false,walkAlignment=false){
  if(!owner&&(APP.resting||APP.settings||!MIND.gazeArmed))return 'Head gaze is paused while asleep or in Settings';
  if(typeof NW!=='undefined'&&NW.checkingPath&&!walkAlignment)return 'Head look deferred while the walking camera checks straight ahead';
  const generation=++HEAD.generation;
  $('#headLiveEnabled').checked=false;
  try{
    const accepted=await headRequest('move',values,walkAlignment);
    const targets={...accepted.state?.targets};
    // 6.71 firmware did not echo targets. Derive the requested target from its
    // authoritative config, never from an empty/released completion response.
    if(!Object.keys(targets).length)for(const axis of ['pan','tilt']){
      const c=accepted.state?.config?.[axis];if(!c)continue;
      const center=c.center??Math.round((c.minimum+c.maximum)/2);
      if(values.axis===axis)targets[axis]=values.pulse;
      else if(values.axis==null&&typeof values[axis]==='number'){
        const v=c.invert?-values[axis]:values[axis];
        targets[axis]=Math.round(center+v*(v<0?center-c.minimum:c.maximum-center));
      }
    }
    const runId=accepted.state?.run_id;
    const deadline=Date.now()+16000;
    while(Date.now()<deadline){
      if(generation!==HEAD.generation)throw Error('Head movement interrupted by Stop or disconnect');
      const ack=await headRequest('info');
      if(generation!==HEAD.generation)throw Error('Head movement interrupted');
      if(!ack.state.holding)throw Error('Head was released before completion');
      if(runId!=null&&ack.state.run_id!==runId)throw Error('Head command replaced or controller restarted');
      if(!ack.state.moving){
        if(!targets||!Object.keys(targets).length||Object.entries(targets).some(([axis,pulse])=>ack.state.commanded?.[axis]!==pulse))throw Error('Head target completion not confirmed');
        return (separateHead()?'ESP32':'Pico')+' completed the head target within its saved limits; physical position is not measured.';
      }
      await new Promise(r=>setTimeout(r,350));
    }
    await headStop();throw Error('Head movement timed out');
  }catch(e){if(generation===HEAD.generation&&headReady())await headStop();return 'Head movement failed: '+e.message;}
}
async function headAcknowledgedCommand(message){
  const type=message.t;
  try{
    let ack;
    if(['gaze_release','gaze_release_axis'].includes(type))ack=await headRequest('stop');
    else if(type==='gaze')ack=await headRequest('move',{pan:message.pan,tilt:message.tilt});
    else if(type==='gaze_set')ack=await headRequest('move',{axis:String(message.axis).replace('gimbal_',''),pulse:message.pulse_us,slow:message.slow===true});
    else if(type==='gaze_info')ack=await headRequest('info');
    else throw Error('Unsupported head command');
    return {ok:1,rid:message.rid,head:true,state:ack.state};
  }catch(e){return {ok:0,rid:message.rid,err:e.message};}
}
function headLegacySend(message){
  // Keep old gaze callers from leaking to the body socket or merging head info
  // into the Pico's channel map. Legacy configuration is deliberately rejected.
  const type=message.t;
  const result=headAcknowledgedCommand(message);
  const deliver=ack=>{if(!message.rid)return;const p=S.pendingAcks.get(message.rid);if(p){clearTimeout(p.timer);S.pendingAcks.delete(message.rid);p.resolve(ack);}else{S.recentAcks.set(message.rid,ack);if(S.recentAcks.size>32)S.recentAcks.delete(S.recentAcks.keys().next().value);}};
  result.then(deliver);
  return true;
}
function renderHead(){
  const enabled=separateHead(),ready=headReady();
  $('#headControls').hidden=false;
  $('#headEspSetup').hidden=!enabled;$('#headEspLimits').hidden=!enabled;
  $('#headPicoHelp').hidden=enabled;
  $('#headPicoDirections').hidden=enabled;
  $('#headConnection').textContent=!enabled?'Pico head: '+(ready?'Connected':'Disconnected'):ready?'ESP32 head: Connected':HEAD.ws?.readyState===0?'ESP32 head: Connecting…':'ESP32 head: Disconnected';
  $('#headBodyConnection').textContent='Pico body: '+(bodyControllerReady()?'Connected':'Disconnected');
  $('#btnHeadConnect').disabled=ready||HEAD.ws?.readyState===0;
  $('#btnHeadDisconnect').disabled=!HEAD.ws;
  for(const b of document.querySelectorAll('[data-head-pan],[data-head-tilt]'))b.disabled=!ready;
  const locked=$('#headSettingsLock').checked;
  for(const id of ['headPanPin','headPanMin','headPanMax','headTiltMin','headTiltMax','headPanInvert','headTiltInvert','btnHeadSave'])$('#'+id).disabled=locked||!ready;
  $('#headLive').disabled=!ready||!$('#headLiveEnabled').checked;
  $('#gimbalCalCard').classList.toggle('hide',true);
}
function loadHeadSettings(){
  if(!HEAD.state?.config)return;
  const c=HEAD.state.config;
  $('#headPanPin').value=c.pan.gpio;
  for(const [axis,prefix]of [['pan','headPan'],['tilt','headTilt']]){
    $('#'+prefix+'Min').value=c[axis].minimum;$('#'+prefix+'Max').value=c[axis].maximum;$('#'+prefix+'Invert').checked=c[axis].invert;
  }
  updateHeadSlider();
}
function updateHeadSlider(){
  const axis=$('#headAxis').value,c=HEAD.state?.config?.[axis];if(!c)return;
  const slider=$('#headLive');slider.min=c.minimum;slider.max=c.maximum;
  slider.value=HEAD.state.commanded[axis]??Math.round((c.minimum+c.maximum)/2);
  $('#headLiveValue').textContent=slider.value+' µs';
}
$('#headRoute').onchange=()=>{disconnectHead(true);renderHead();prefsSave();if(separateHead())connectHead();};
$('#btnHeadConnect').onclick=()=>{connectHead();};
$('#btnHeadDisconnect').onclick=()=>disconnectHead(true);
$('#btnHeadStop').onclick=async()=>{await headStop();headMessage('Head stop requested.');renderHead();};
$('#btnHeadLoad').onclick=async()=>{try{await headRequest('info');loadHeadSettings();headMessage('Loaded ESP32 head limits.');}catch(e){headMessage(e.message);}};
$('#headSettingsLock').checked=true;
$('#headSettingsLock').onchange=renderHead;
$('#headLiveEnabled').checked=false;
$('#headLiveEnabled').onchange=async()=>{if(!$('#headLiveEnabled').checked)await headStop();updateHeadSlider();renderHead();};
$('#headAxis').onchange=updateHeadSlider;
$('#btnHeadSave').onclick=async()=>{
  try{
    const pin=Number($('#headPanPin').value),config={};
    for(const [axis,prefix,gpio]of [['pan','headPan',pin],['tilt','headTilt',pin===18?19:18]])config[axis]={gpio,minimum:Number($('#'+prefix+'Min').value),maximum:Number($('#'+prefix+'Max').value),invert:$('#'+prefix+'Invert').checked};
    await headStop();const ack=await headRequest('configure',{config});
    if(JSON.stringify(ack.state.config)!==JSON.stringify(config)){
      for(const axis of ['pan','tilt'])for(const key of Object.keys(config[axis]))if(ack.state.config[axis][key]!==config[axis][key])throw Error('ESP32 did not confirm the saved limits');
    }
    $('#headSettingsLock').checked=true;loadHeadSettings();renderHead();headMessage('Head limits saved on ESP32 and locked. No movement commanded.');
  }catch(e){headMessage('Save failed: '+e.message);}
};
for(const button of document.querySelectorAll('[data-head-pan],[data-head-tilt]'))button.onclick=async()=>{
  const values={};if(button.dataset.headPan!==undefined)values.pan=Number(button.dataset.headPan);if(button.dataset.headTilt!==undefined)values.tilt=Number(button.dataset.headTilt);
  headMessage(await headMove(values,true));
};
for(const axis of ['Pan','Tilt']){
  const field=$('#headPico'+axis+'Invert'),key='owlbot_pico_head_'+axis.toLowerCase()+'_invert';
  field.checked=localStorage.getItem(key)==='true';
  field.onchange=async()=>{
    // A direction change never reinterprets an in-flight camera assessment.
    await headStop();
    localStorage.setItem(key,String(field.checked));
    headMessage(axis+' direction saved on this phone. Travel limits and center are unchanged.');
  };
}
let headSliderTimer=0;
$('#headLive').oninput=ev=>{
  $('#headLiveValue').textContent=ev.target.value+' µs';
  if(!ev.isTrusted||!$('#headLiveEnabled').checked)return;
  clearTimeout(headSliderTimer);const generation=HEAD.generation;
  headSliderTimer=setTimeout(()=>{if(generation===HEAD.generation&&$('#headLiveEnabled').checked)headRequest('move',{axis:$('#headAxis').value,pulse:Number($('#headLive').value),slow:true}).catch(e=>headMessage(e.message));},150);
};
for(const id of ['headHost','headKey'])$('#'+id).addEventListener('change',()=>disconnectHead(true));
setInterval(()=>{
  renderHead();
  if(headReady()){if(headHeartbeatNeeded()){HEAD.heartbeatPending=true;headRequest('ping').catch(()=>{}).finally(()=>{HEAD.heartbeatPending=false;});}}
  else if(HEAD.ready)disconnectHead(false,'No fresh ESP32 replies for three seconds');
  else if(separateHead()&&!HEAD.ws&&!HEAD.manual&&Date.now()>HEAD.retryAt&&!document.hidden&&(APP.settings||!APP.resting))connectHead();
},750);
window.addEventListener('pagehide',()=>disconnectHead(true));
document.addEventListener('visibilitychange',()=>{if(document.hidden)disconnectHead(false);});
renderHead();
