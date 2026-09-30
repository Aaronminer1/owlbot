// Pure canvas costumes: no camera, timers, network, audio or motor side effects.
function resolveFaceCostume(choice,date=new Date()){
  if(choice==='halloween'||choice==='christmas')return choice;
  if(choice!=='seasonal')return 'none';
  const month=date.getMonth()+1,day=date.getDate();
  return month===10&&day===31?'halloween':month===12&&(day===24||day===25)?'christmas':'none';
}
function drawFaceCostume(c,kind,cx,cy,s){
  if(kind==='none')return;
  c.save();c.translate(cx,cy);c.scale(s,s);c.lineJoin='round';c.lineCap='round';
  if(kind==='halloween'){
    // Cape/collar stays beneath the mouth. The brim stays above the brows.
    c.fillStyle='#46236d';c.strokeStyle='#c695ff';c.lineWidth=3;
    c.beginPath();c.moveTo(-135,172);c.lineTo(-160,267);c.quadraticCurveTo(0,222,160,267);c.lineTo(135,172);c.lineTo(0,215);c.closePath();c.fill();c.stroke();
    c.fillStyle='#241438';c.beginPath();c.moveTo(-113,-160);c.lineTo(-25,-293);c.lineTo(30,-274);c.lineTo(6,-260);c.lineTo(101,-160);c.closePath();c.fill();c.stroke();
    c.fillStyle='#f59832';c.beginPath();c.moveTo(-92,-190);c.lineTo(80,-190);c.lineTo(99,-161);c.lineTo(-112,-161);c.closePath();c.fill();
    c.fillStyle='#38204d';c.beginPath();c.ellipse(0,-155,143,17,0,0,Math.PI*2);c.fill();c.stroke();
    c.fillStyle='#ffd274';c.fillRect(-15,-190,31,24);c.fillStyle='#362047';c.fillRect(-8,-185,17,14);
    c.fillStyle='#ffad43';c.beginPath();c.ellipse(0,207,18,15,0,0,Math.PI*2);c.fill();
    c.fillStyle='#322137';for(const x of [-7,7]){c.beginPath();c.moveTo(x-4,204);c.lineTo(x,198);c.lineTo(x+4,204);c.fill();}
    c.beginPath();c.moveTo(-9,210);c.quadraticCurveTo(0,220,9,210);c.fill();
  }else if(kind==='christmas'){
    c.fillStyle='#c93950';c.strokeStyle='#ff8291';c.lineWidth=3;
    c.beginPath();c.moveTo(-111,-159);c.quadraticCurveTo(-61,-299,30,-278);c.quadraticCurveTo(97,-272,119,-210);c.quadraticCurveTo(63,-243,62,-205);c.lineTo(112,-159);c.closePath();c.fill();c.stroke();
    c.fillStyle='#f3f3df';c.beginPath();c.ellipse(0,-155,129,18,0,0,Math.PI*2);c.fill();
    c.beginPath();c.arc(117,-205,21,0,Math.PI*2);c.fill();
    c.fillStyle='#249579';c.beginPath();c.roundRect(-135,179,270,35,14);c.fill();
    c.fillStyle='#1b806b';c.beginPath();c.roundRect(54,203,44,69,10);c.fill();
    c.strokeStyle='#f2ce80';c.lineWidth=7;for(const y of [223,244,261]){c.beginPath();c.moveTo(58,y);c.lineTo(94,y);c.stroke();}
    c.fillStyle='#ffd470';c.beginPath();c.arc(0,198,11,0,Math.PI*2);c.fill();
  }
  c.restore();
}
