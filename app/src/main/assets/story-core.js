/* Pure narration planning. The text is authoritative: never ask a model to
 * reconstruct a missing page, shorten an ending, or invent a source edition. */
(function(root){
 'use strict';
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 function normalize(text){return String(text||'').replace(/\s+/g,' ').trim();}
 function chunks(text,limit=420){
   const words=normalize(text).split(' '),out=[];let current='';
   for(let word of words){
     if(current&&current.length+1+word.length>limit){out.push(current);current='';}
     // A pathological imported token is split rather than lost.
     while(word.length>limit){out.push(word.slice(0,limit));word=word.slice(limit);}
     if(word)current+=(current?' ':'')+word;
   }
   if(current)out.push(current);return out;
 }
 const cast=[
   [/great(?:,? huge| big)? bear|big bear/i,'big bear',-8,-3],
   [/middle(?:-sized)? bear/i,'middle bear',0,0],
   [/little(?:,? small,? wee| small wee| wee)? bear|wee bear/i,'little bear',8,2],
   [/skin horse/i,'skin horse',-6,-5],[/tortoise/i,'tortoise',-4,-6],
   [/hare/i,'hare',5,4],[/wolf/i,'wolf',-7,-2],[/pig(?:gy)?/i,'pig',5,1],
   [/mouse/i,'mouse',7,2],[/lion/i,'lion',-6,-2],[/fairy/i,'fairy',6,0],
   [/mrs\.? rabbit|mother/i,'mother',0,-2],[/rabbit|peter/i,'rabbit',4,1],
   [/fox/i,'fox',-3,1],[/magpie/i,'magpie',3,0],[/crow/i,'crow',-2,1]
 ];
 function speaker(before,after){
   const verbs='(?:said|says|cried|replied|asked|answered|whispered|exclaimed|sniggered|shouted|called|remarked)';
   const direct=after.match(new RegExp('^[,;.!? ]*'+verbs+'\\s+([^.!?;:]{1,65})','i'));
   const preceding=before.match(new RegExp('([^.!?;:]{1,70})\\s+'+verbs+'[, :]*$','i'));
   // A named speaker can introduce a quote with an action ("Tortoise
   // laughed.") or continue after a reporting clause ("said the Hare.").
   const action=before.match(/([^.!?;:]{1,60})\s+(?:laughed|smiled|grinned|whispered|replied|asked)[.!?]\s*$/i);
   const continued=before.match(new RegExp(verbs+'\\s+([^.!?;:]{1,60})[.!?]\\s*$','i'));
   const hint=direct?.[1]||preceding?.[1]||action?.[1]||continued?.[1]||'';
   const match=cast.find(c=>c[0].test(hint));return match?{role:match[1],pitch:match[2],rate:match[3]}:{role:'character',pitch:2,rate:0};
 }
 function legacyPlan(text){
   const source=normalize(text),parts=[];let cursor=0;
   // Quotes mark character delivery, not a different transcript. Apostrophes
   // inside words do not open/close dialogue. All punctuation stays intact.
   for(let i=0;i<source.length;i++){
     const open=source[i];if(!['“','"',"'"].includes(open)||(/\w/.test(source[i-1]||'')&&open==="'"))continue;
     const close=open==='“'?'”':open;let j=i+1;
     for(;j<source.length;j++)if(source[j]===close&&!(close==="'"&&/\w/.test(source[j+1]||'')))break;
     if(j>=source.length)continue;
     if(i>cursor)parts.push({text:source.slice(cursor,i),role:'narrator',pitch:0,rate:0});
     parts.push({text:source.slice(i,j+1),...speaker(source.slice(Math.max(0,i-90),i),source.slice(j+1,j+140))});
     i=j;cursor=j+1;
   }
   if(cursor<source.length)parts.push({text:source.slice(cursor),role:'narrator',pitch:0,rate:0});
   // Character boundaries do not need extra whitespace in the underlying
   // text; tests compare normalized punctuation/words after reconstruction.
   return parts.flatMap(part=>chunks(part.text).map(text=>({...part,text})));
 }
 function positions(source,parts){
   let cursor=0;return parts.map(part=>{const start=source.indexOf(part.text,cursor);
     if(start<0)throw Error('Narration text lost its source position');
     cursor=start+part.text.length;return {...part,start,end:cursor};});
 }
 function sentenceRanges(text){
   const source=normalize(text),ranges=[];let start=0,quote='';
   const push=end=>{if(end>start){ranges.push({start,end,text:source.slice(start,end)});start=end;while(source[start]===' ')start++;}};
   for(let i=0;i<source.length;i++){
     const c=source[i],apostrophe=(c==="'"||c==='’')&&/\w/.test(source[i-1]||'')&&/\w/.test(source[i+1]||'');
     if(!apostrophe){
       if(quote&&c===quote){quote='';continue;}
       if(!quote&&['“','"',"'"].includes(c)){quote=c==='“'?'”':c;continue;}
     }
     if(!/[.!?]/.test(c))continue;
     if(c==='.'&&(/\d/.test(source[i-1]||'')&&/\d/.test(source[i+1]||'')||/\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr)\.$/i.test(source.slice(0,i+1))))continue;
     let end=i+1;while(/[.!?]/.test(source[end]||' '))end++;
     if(quote){if(source[end]!==quote)continue;quote='';end++;}
     while(/[”"')\]]/.test(source[end]||' '))end++;
     // Keep "...?” asked the Hare. together. A reporting tag is not a new
     // spoken clip or a separate restart point. Multi-sentence quoted turns
     // stay together too, avoiding tiny "Wow." / "You're on!" fragments.
     if(/^\s+(?:said|asked|cried|replied|answered|whispered|shouted|called|laughed)\b/.test(source.slice(end))){i=end-1;continue;}
     if(end===source.length||source[end]===' '){push(end);i=end-1;}
   }
   push(source.length);return ranges;
 }
 function plan(text){
   const source=normalize(text),voices=positions(source,legacyPlan(source));
   const parts=sentenceRanges(source).flatMap(sentence=>{
     const dialogue=voices.find(p=>p.role!=='narrator'&&p.start<sentence.end&&p.end>sentence.start);
     const voice=dialogue||{role:'narrator',pitch:0,rate:0};
     return chunks(sentence.text).map(text=>({text,role:voice.role,pitch:voice.pitch,rate:voice.rate}));
   });
   return positions(source,parts);
 }
 function resumeIndex(text,saved={}){
   const source=normalize(text),next=plan(source);
   let offset=Number(saved.offset);
   if(saved.format!==2||!Number.isFinite(offset)){
     const old=positions(source,saved.format===2?next:legacyPlan(source));
     const i=Math.max(0,Math.floor(Number(saved.index)||0));offset=i>=old.length?source.length:old[i].start;
   }
   // A legacy bookmark inside a sentence repeats that sentence, never skips
   // its unheard ending. Completed bookmarks remain completed across upgrades.
   const i=next.findIndex(p=>p.end>offset);return i<0?next.length:i;
 }
 function voice(base,emotion='neutral',options={}){
   const offset={excited:[9,6],happy:[4,2],playful:[5,3],amused:[4,2],sad:[-7,-10],
     empathetic:[-2,-15],loving:[-1,-10],relieved:[-2,-7],sleepy:[-4,-18]}[emotion]||[0,0];
   let pitch=offset[0],rate=offset[1];
   if(options.bedtime){pitch=-2+(options.pitch||0);rate=-30+(options.rate||0);}
   if(options.comfort){pitch=-1;rate=-22;}
   // Bound the expression OFFSET, not the owner's baseline. A high-pitched
   // saved voice must not silently become lower merely by enabling expression.
   return {...base,pitch:Math.round((Number(base.pitch)||0)+clamp(pitch,-12,12)),
     rate:Math.round((Number(base.rate)||0)+clamp(rate,-40,12))};
 }
 function findStory(library,query){
   const q=normalize(query).toLowerCase().replace(/[’']/g,'');
   const matches=library.filter(s=>[s.id,s.title,...s.aliases].some(a=>q.includes(a.toLowerCase().replace(/[’']/g,''))));
   const historical=/\b(?:original|historical|unadapted|unabridged|townsend|1918|1890|1902|1922)\b|\bold (?:edition|version|wording)\b/.test(q);
   return matches.find(s=>s.kind===(historical?'historical':'child'))||matches[0];
 }
 // Tool callers using an older base id also get the new default. UI choices
 // and saved-place resume remain exact, so an original never silently changes
 // editions half way through a reading.
 function editionStory(library,id,historical=false){
   const selected=library.find(s=>s.id===id);if(!selected||!selected.baseId)return selected;
   return library.find(s=>s.baseId===selected.baseId&&s.kind===(historical?'historical':'child'))||selected;
 }
 function comfortNeed(text){
   const t=normalize(text).toLowerCase().replace(/[’]/g,"'");
   if(/^(?:read|tell|pretend|quote|give (?:me )?an example|write)\b|\b(?:not scared|not afraid|not upset)\b/.test(t))return '';
   if(/\b(?:someone is (?:hurting|hitting|touching)|(?:i am|i'm) (?:hurt|bleeding)|i can't breathe|there is a fire|i want to (?:die|hurt myself))\b/.test(t))return 'urgent';
   if(/\b(?:i'm|i am|i feel)\s+(?:really |very |so |a little )?(?:scared|afraid|frightened|upset|sad|lonely|worried|anxious)\b|\b(?:i had a (?:bad dream|nightmare)|there(?:'s| is) a monster|i miss (?:my )?(?:mom|mum|dad|mummy|daddy))\b/.test(t))return 'comfort';
   return '';
 }
 const api={normalize,chunks,plan,legacyPlan,sentenceRanges,resumeIndex,voice,findStory,editionStory,comfortNeed};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OwlStory=api;
})(typeof globalThis!=='undefined'?globalThis:this);
