/* Offline musical data, independent of Android, the model, and Web Audio.
 * MIDI limits reject oversized/unsupported scores; they never truncate a song.
 * Timings are seconds after applying the complete tempo map, not guessed BPM. */
(function(root){
  'use strict';
  function parseMidi(input){
    const b=input instanceof Uint8Array?input:new Uint8Array(input);
    if(b.length>2*1024*1024)throw Error('MIDI file exceeds 2 MB');
    const view=new DataView(b.buffer,b.byteOffset,b.byteLength);
    let p=0,end=b.length;
    function need(n){if(p+n>end)throw Error('Truncated MIDI file');}
    function byte(){need(1);return b[p++];}
    function u16(){need(2);const v=view.getUint16(p);p+=2;return v;}
    function u32(){need(4);const v=view.getUint32(p);p+=4;return v;}
    function tag(){return String.fromCharCode(byte(),byte(),byte(),byte());}
    function vlq(){let n=0;for(let i=0;i<4;i++){const v=byte();n=n*128+(v&127);if(!(v&128))return n;}throw Error('Invalid MIDI variable length');}
    if(tag()!=='MThd')throw Error('Not a Standard MIDI File');
    const header=u32();if(header<6)throw Error('Invalid MIDI header');
    const format=u16(),count=u16(),division=u16();
    if(format>1||!count||count>32||!division||(division&32768))throw Error('Only MIDI type 0/1 with metrical timing is supported');
    need(header-6);p+=header-6;
    const events=[],tracks=[];let maxTick=0;
    for(let track=0;track<count;track++){
      end=b.length;if(tag()!=='MTrk')throw Error('Missing MIDI track');
      const length=u32();need(length);end=p+length;
      let tick=0,running=0,name='';
      while(p<end){
        tick+=vlq();maxTick=Math.max(maxTick,tick);
        let status=byte();if(status<128){if(!running)throw Error('Invalid running status');p--;status=running;}
        if(status===255){
          const type=byte(),n=vlq();need(n);
          if(type===81&&n===3){const us=b[p]*65536+b[p+1]*256+b[p+2];if(!us)throw Error('Invalid MIDI tempo');events.push({tick,type:'tempo',us});}
          if(type===3)name=String.fromCharCode(...b.slice(p,p+Math.min(n,100)));
          p+=n;
        }else if(status===240||status===247){running=0;const n=vlq();need(n);p+=n;}
        else{
          if(status<128||status>=240)throw Error('Unsupported MIDI status');
          running=status;const kind=status>>4,channel=status&15,a=byte(),v=(kind===12||kind===13)?0:byte();
          if(a>127||v>127)throw Error('Invalid MIDI data');
          if(kind===8||kind===9)events.push({tick,type:kind===9&&v?'on':'off',track,channel,note:a,velocity:v/127});
          if(kind===11&&[64,120,123].includes(a))events.push({tick,type:'control',track,channel,control:a,value:v});
        }
        if(events.length>100000)throw Error('MIDI event limit exceeded');
      }
      tracks.push({id:track,name});
    }
    events.sort((a,b)=>a.tick-b.tick);
    const notes=[],active=new Map(),pedal=new Map();let tick=0,seconds=0,us=500000;
    function release(key,at,force=false){
      const list=active.get(key)||[];
      for(const n of list){if(force||n.released){n.duration=Math.max(.01,at-n.start);notes.push(n);}}
      const keep=list.filter(n=>!force&&!n.released);if(keep.length)active.set(key,keep);else active.delete(key);
    }
    for(const e of events){
      seconds+=(e.tick-tick)*us/(division*1e6);tick=e.tick;
      if(seconds>900)throw Error('MIDI exceeds 15 minutes');
      if(e.type==='tempo'){us=e.us;continue;}
      const lane=e.track+':'+e.channel,key=lane+':'+e.note;
      if(e.type==='on'){
        // Retriggering a sustained pitch releases its previous pedal tail.
        release(key,seconds);
        const list=active.get(key)||[];list.push({start:seconds,note:e.note,velocity:e.velocity,track:e.track,channel:e.channel,released:false});active.set(key,list);
      }else if(e.type==='off'){
        const n=(active.get(key)||[]).find(n=>!n.released);if(n)n.released=true;
        if(!pedal.get(lane))release(key,seconds);
      }else{
        if(e.control===64)pedal.set(lane,e.value>=64);
        if(e.control!==64||e.value<64)for(const k of [...active.keys()])if(k.startsWith(lane+':'))release(k,seconds,e.control!==64);
      }
      if(notes.length>16000)throw Error('MIDI note limit exceeded');
    }
    seconds+=(maxTick-tick)*us/(division*1e6);
    for(const key of [...active.keys()])release(key,seconds,true);
    if(!notes.length||notes.length>16000||seconds>900)throw Error('Empty or oversized MIDI score');
    notes.sort((a,b)=>a.start-b.start||b.note-a.note);
    return {notes,tracks,duration:Math.max(seconds,...notes.map(n=>n.start+n.duration)),format,division};
  }
  // A single hum cannot sing both hands or chords. Follow the highest active
  // right-hand note, retaining every section, rest, repeat and the full timeline.
  function hummingScore(score,track){
    const candidates=score.notes.filter(n=>n.channel!==9&&(track==null||n.track===track));
    const edges=[];
    candidates.forEach((n,id)=>{edges.push({t:n.start,on:true,n,id},{t:n.start+n.duration,on:false,n,id});});
    edges.sort((a,b)=>a.t-b.t||Number(a.on)-Number(b.on));
    const active=new Map(),notes=[];let last=0;
    for(let i=0;i<edges.length;){
      const t=edges[i].t,top=[...active.values()].sort((a,b)=>b.note-a.note)[0];
      if(top&&t>last+.00001){
        // One uniform octave shift retains intervals; do not wrap each note.
        const note=top.note-12,prev=notes[notes.length-1];
        if(prev&&prev.note===note&&Math.abs(prev.start+prev.duration-last)<.00001)prev.duration=t-prev.start;
        else notes.push({start:last,duration:t-last,note,velocity:.65,track:0,channel:0});
      }
      while(i<edges.length&&Math.abs(edges[i].t-t)<.000001){const e=edges[i++];if(e.on)active.set(e.id,e.n);else active.delete(e.id);}
      last=t;
    }
    return {...score,notes};
  }
  function capturedPhrase(samples){
    const sorted=samples.filter(s=>Number.isFinite(s.t)).slice().sort((a,b)=>a.t-b.t);
    if(sorted.length<5)return null;
    const notes=[],origin=sorted[0].t;
    for(let i=0;i<sorted.length;i++){
      const s=sorted[i],duration=Math.min(.15,Math.max(.02,((sorted[i+1]?.t||s.t+60)-s.t)/1000));
      if(s.confidence<.8||s.midi<36||s.midi>96||s.rms<.012)continue;
      const note=Math.round(s.midi),start=(s.t-origin)/1000,prev=notes[notes.length-1];
      if(prev&&prev.note===note&&start-(prev.start+prev.duration)<.07)prev.duration=start+duration-prev.start;
      else notes.push({note,start,duration,velocity:.65});
    }
    const stable=notes.filter(n=>n.duration>=.10);
    if(stable.reduce((s,n)=>s+n.duration,0)<.6)return null;
    const offset=stable[0].start;stable.forEach(n=>n.start-=offset);
    return {notes:stable,duration:Math.max(...stable.map(n=>n.start+n.duration))};
  }
  // A small offline improviser: a motif, a contrasting phrase, a return, then
  // a tonic ending. This is procedural composition, not an LLM or a claim of
  // human authorship. A seeded choice makes each saved piece reproducible.
  function improvise(seed,mood='playful'){
    let state=Number(seed)>>>0;
    const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
    const gentle=/gentle|sleep|calm/.test(mood),minor=/myster|sad/.test(mood);
    const scale=minor?[0,2,3,5,7,8,10]:[0,2,4,5,7,9,11];
    const root=[60,62,65,67][Math.floor(rand()*4)],tempo=gentle?76:minor?92:112;
    const pitch=degree=>root+scale[((degree%7)+7)%7]+12*Math.floor(degree/7);
    const motif=[0,Math.floor(rand()*3)+1,4,Math.floor(rand()*4)+1,2];
    const rhythm=gentle?[1,1,1,1]:[1,.5,.5,1,1],events=[];
    const harmony=[0,3,4,0,5,3,4,0];
    for(let bar=0;bar<8;bar++){
      const chord=harmony[bar];
      events.push({startBeat:bar*4,durationBeats:3.8,notes:[pitch(chord)-12,pitch(chord+2)-12,pitch(chord+4)-12],velocity:.3});
      let beat=bar*4;
      rhythm.forEach((duration,i)=>{
        let degree=motif[i%motif.length];
        if(bar===4||bar===5)degree=6-degree; // contrasting middle phrase
        else if(bar%2)degree+=Math.floor(rand()*3)-1;
        if(bar===7)degree=[4,2,1,0,0][i];
        events.push({startBeat:beat,durationBeats:duration*.9,notes:[pitch(degree)],velocity:gentle?.48:.62+rand()*.1});
        beat+=duration;
      });
    }
    events.push({startBeat:32,durationBeats:2,notes:[root-12,root,root+7],velocity:.45});
    const adjective=gentle?'Sleepy':minor?'Secret':'Bouncy';
    const noun=['Robot','Dragon','Moon','Puddle','Spaceship'][Math.floor(rand()*5)];
    return {title:adjective+' '+noun+' '+(Number(seed)>>>0).toString(36).slice(-4),tempo,instrument:'piano',events};
  }
  const api={parseMidi,hummingScore,capturedPhrase,improvise};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OwlMusic=api;
})(typeof globalThis!=='undefined'?globalThis:this);
