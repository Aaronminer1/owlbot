/* Measured cycle-to-distance calibration. No motor commands or image-depth guesses. */
function travelPlanSignature(plan){
  if(!plan||!Array.isArray(plan.steps)||!plan.steps.length)return null;
  return JSON.stringify({version:plan.version,lift:plan.lift_percent??50,paired:plan.paired_feet??true,
    settle:plan.settle_ms??20,steps:plan.steps});
}
function travelSpeed(pace,plan){
  const speeds={creep:200,slow:600,fast:1000,run:1600};
  if(pace&&pace!=='saved'&&!Object.prototype.hasOwnProperty.call(speeds,pace))throw Error('Unknown walking pace.');
  const speed=pace&&pace!=='saved'?speeds[pace]:Number(plan?.speed_us_s);
  if(!Number.isInteger(speed)||speed<20||speed>1600)throw Error('Load the saved walking plan first.');
  return speed;
}
function travelSamples(){
  const raw=localStorage.getItem('owlbot_travel_calibration_v1');
  if(!raw)return [];
  const rows=JSON.parse(raw);
  if(!Array.isArray(rows))throw Error('Distance calibration could not be read; retained without overwriting.');
  return rows;
}
function travelCyclesFor(feet,perCycle){
  // Avoid an extra cycle from floating-point 15.000000000000002.
  return feet>0?Math.max(1,Math.ceil(feet/perCycle-1e-9)):0;
}
function saveTravelMeasurement(args){
  if(NW.running||NW.dirty||CHANNEL_SETUP.live||CHANNEL_SETUP.busy)throw Error('Finish walking and save any gait edits before recording a measurement.');
  const signature=travelPlanSignature(NW.plan);
  if(!signature||!CHANNEL_SETUP.loaded)throw Error('Read the saved Pico walk first so this measurement is bound to its actual gait.');
  const cycles=Number(args.cycles),feet=Number(args.feet),surface=String(args.surface||'').trim().toLowerCase();
  if(!Number.isInteger(cycles)||cycles<1||cycles>1000||!Number.isFinite(feet)||feet<0||feet>1000)
    throw Error('Enter observed cycles (1–1000) and measured feet (0–1000). Zero travel records slipping.');
  if(!surface||surface.length>80)throw Error('Describe the measured surface in 1–80 characters.');
  if(!['forward','backward'].includes(args.direction))throw Error('Choose forward or backward.');
  const sample={id:Date.now()+'-'+Math.random().toString(16).slice(2,8),at:Date.now(),signature,
    speed:travelSpeed(args.pace,NW.plan),direction:args.direction,surface,cycles,feet,
    source:'owner-measured',feetPerCycle:feet/cycles};
  const rows=travelSamples().concat(sample).slice(-80);
  localStorage.setItem('owlbot_travel_calibration_v1',JSON.stringify(rows));
  return {saved:true,sampleCount:rows.length,feetPerCycle:sample.feetPerCycle,motionSent:false};
}
function estimateTravel(args){
  const feet=Number(args.distance_ft),stopShort=Number(args.stop_short_ft??0),direction=args.direction||'forward';
  if(!Number.isFinite(feet)||feet<0||feet>1000||!Number.isFinite(stopShort)||stopShort<0||stopShort>1000)
    throw Error('Distance and stop-short margin must be finite feet from 0 to 1000.');
  if(!['forward','backward'].includes(direction))throw Error('Choose forward or backward.');
  const target=Math.max(0,feet-stopShort),surface=String(args.surface||'').trim().toLowerCase();
  const signature=travelPlanSignature(NW.plan),speed=travelSpeed(args.pace,NW.plan);
  const rows=travelSamples().filter(r=>r.signature===signature&&r.speed===speed&&r.direction===direction&&
    (!surface||r.surface===surface)&&r.source==='owner-measured'&&Number.isFinite(r.feetPerCycle)&&r.feetPerCycle>=0);
  const surfaces=[...new Set(rows.map(r=>r.surface))];
  const base={distanceFt:feet,stopShortFt:stopShort,travelFt:target,speedUsPerSec:speed,direction,
    distanceSource:'supplied distance, not measured by this tool',actualPositionKnown:false,motionSent:false};
  if(!signature||!rows.length||(!surface&&surfaces.length!==1))return {...base,calibrated:false,
    reason:!signature?'No saved gait loaded.':surfaces.length>1&&!surface?'Specify the surface; do not mix floor calibrations.':'No matching measured gait, speed, direction and surface.'};
  const totalCycles=rows.reduce((n,r)=>n+r.cycles,0),perCycle=rows.reduce((n,r)=>n+r.feet,0)/totalCycles;
  if(perCycle<=0||rows.some(r=>r.feetPerCycle===0))return {...base,calibrated:false,
    reason:'A matching measurement reports no travel. Resolve slipping and remeasure; do not infer distance from cycling feet.'};
  const nominal=travelCyclesFor(target,perCycle),rates=rows.map(r=>r.feetPerCycle);
  return {...base,calibrated:true,surface:surfaces[0],samples:rows.length,feetPerCycle:perCycle,
    nominalCycles:nominal,nextSegmentCycles:Math.min(30,nominal),
    observedCycleRange:rows.length>1?[travelCyclesFor(target,Math.max(...rates)),travelCyclesFor(target,Math.min(...rates))]:null,
    uncertainty:rows.length===1?'One measurement only; no measured variability yet.':'Observed sample spread, not a guaranteed error bound.',
    conditions:'Recalibrate after footwear, payload, power or floor changes. Recheck landmarks and camera clearance while traveling; neither an ACK nor this estimate proves arrival.'};
}
function recordTravelFromUI(){
  try{
    if(!$('#travelMeasured').checked)throw Error('Confirm this was measured on the floor, not inferred from an ACK or bench test.');
    const result=saveTravelMeasurement({cycles:$('#travelCycles').value,feet:$('#travelFeet').value,
      pace:$('#travelPace').value,direction:$('#travelDirection').value,surface:$('#travelSurface').value});
    $('#travelMeasured').checked=false;
    $('#travelStatus').textContent='Saved floor measurement: '+result.feetPerCycle.toFixed(3)+' feet/cycle. No motion commanded.';
  }catch(e){$('#travelStatus').textContent=e.message;}
}
function previewTravelFromUI(){
  try{
    const r=estimateTravel({distance_ft:$('#travelTarget').value,pace:$('#travelPace').value,
      direction:$('#travelDirection').value,surface:$('#travelSurface').value});
    $('#travelStatus').textContent=r.calibrated?'Estimated '+r.nominalCycles+' cycles; next segment up to '+r.nextSegmentCycles+'. '+r.uncertainty:r.reason+' Record a floor measurement for these conditions first.';
  }catch(e){$('#travelStatus').textContent=e.message;}
}
function undoTravelMeasurement(){
  try{
    const rows=travelSamples();if(!rows.length)throw Error('No measurements to undo.');
    rows.pop();localStorage.setItem('owlbot_travel_calibration_v1',JSON.stringify(rows));
    $('#travelStatus').textContent='Last measurement removed. Earlier measurements retained.';
  }catch(e){$('#travelStatus').textContent=e.message;}
}
