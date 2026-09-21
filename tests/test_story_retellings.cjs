const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../app/src/main/assets/story-core.js');
const c={};vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/../app/src/main/assets/story-library.js','utf8')+';this.library=STORY_LIBRARY',c);
const stories=c.library,children=stories.filter(s=>s.kind==='child');
assert.equal(children.length,12);assert.equal(new Set(stories.map(s=>s.id)).size,24);
// A narrative is a human editorial judgment. These tests protect specific plot
// beats, edition selection and text delivery; they do not certify child appeal.
const beats={
 'hare-tortoise':[/tortoise walking/i,/beat you in a race/i,/Fox to pick/i,/fell fast asleep/i,/Tortoise kept going/i,/Tortoise was already there/i,/Slow and steady wins the race/],
 'lion-mouse':[/across his face/i,/kill him/i,/let me go/i,/let the Mouse run away/i,/hunters/i,/chewing/i,/snapped/i],
 'crow-pitcher':[/thirsty/i,/water jug/i,/too far away/i,/small stones/i,/water kept rising/i,/He drank/i],
 'fox-grapes':[/hungry Fox/i,/above her head/i,/jump/i,/tired/i,/probably sour/i,/hadn't tasted/i],
 'fox-crow':[/piece of meat/i,/beautiful bird/i,/voice is as lovely/i,/loud caw/i,/Fox grabbed/i],
 'wind-sun':[/stronger/i,/man walking/i,/Wind went first/i,/pulled his cloak tighter/i,/Sun came out/i,/stream/i,/Sun had won/i],
 'town-country-mouse':[/fields/i,/back to town/i,/cheese/i,/door opened/i,/someone else came in/i,/going home/i,/quiet fields/i],
 'goldilocks':[/three sizes/i,/walk while it cooled/i,/whole lot/i,/seat broke/i,/fell asleep/i,/Somebody's been eating/i,/Somebody's been sitting/i,/Somebody's been lying/i,/jumped out/i,/doesn't give us a clear answer/i,/never saw Goldilocks again/i],
 'three-pigs':[/straw house fell/i,/Wolf ate him/i,/stick house down/i,/bricks/i,/house didn't move/i,/turnips/i,/apples/i,/fair/i,/butter churn/i,/chimney/i,/boiling pot/i,/ate him for supper/i],
 'magpie-nest':[/tobacco/i,/mud into a round base/i,/Thrush/i,/Blackbird/i,/Owl/i,/Sparrow/i,/Starling/i,/Turtle-dove/i,/refused to give the lesson/i],
 'peter-rabbit':[/put in a pie/i,/blackberries/i,/squeezed under the gate/i,/radishes/i,/blue jacket caught/i,/sparrows/i,/watering can/i,/Achoo/i,/window/i,/old mouse/i,/white cat/i,/wheelbarrow/i,/scarecrow/i,/camomile tea/i,/blackberries they'd picked/i],
 'velveteen-rabbit':[/Christmas morning/i,/toy cupboard/i,/Skin Horse/i,/what does it mean to be real/i,/china dog/i,/tunnels under the blankets/i,/real to the Boy/i,/two wild rabbits/i,/back legs/i,/Boy became ill/i,/seaside/i,/sack/i,/tear slid/i,/Fairy stepped out/i,/back foot/i,/living rabbit now/i,/spring came/i,/first made him feel real/i]
};
for(const s of children){
 const original=stories.find(x=>x.id===s.baseId);assert(original&&original.kind==='historical');
 assert.notEqual(s.text,original.text);assert.equal(s.gentle,original.gentle);
 assert(s.edition.includes('retelling'));assert(s.contentNote.includes('Not the original wording'));
 assert(!/assented|piteously|wayfaring|complexion|sluggard|confer benefits|partake|after her fatigue/i.test(s.text));
 let cursor=0;for(const pattern of beats[s.baseId]){const hit=s.text.slice(cursor).match(pattern);assert(hit,`${s.id} missing/out of order: ${pattern}`);cursor+=hit.index+hit[0].length;}
 assert.equal(core.findStory(stories,'tell me '+s.title).id,s.id);
 assert.equal(core.findStory(stories,'read the original '+s.title).id,original.id);
 assert.equal(core.plan(s.text).map(p=>p.text).join('').replace(/\s/g,''),s.text.replace(/\s/g,''));
}
assert.equal(core.editionStory([{id:'import-1',text:'Parent text'}],'import-1').id,'import-1');
assert.equal(core.editionStory(stories,'not-a-story'),undefined);
console.log('All 12 child retellings: ordered plot beats, complete delivery, plain wording, truthful editions, default/original/import routing passed');
