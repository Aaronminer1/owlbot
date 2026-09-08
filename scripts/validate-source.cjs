const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),dir=path.join(root,'app/src/main/assets');
const html=fs.readFileSync(path.join(dir,'growbot-brain.html'),'utf8');
for(const [i,m] of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].entries())new vm.Script(m[1],{filename:'inline-'+i+'.js'});
for(const m of html.matchAll(/<script src="([^"]+)"/g)){assert(/^[a-z-]+\.js$/.test(m[1]));new vm.Script(fs.readFileSync(path.join(dir,m[1]),'utf8'),{filename:m[1]});}
const native=fs.readFileSync(path.join(root,'app/src/main/java/dev/owlbot/brain/MainActivity.java'),'utf8');
assert(!/LocalVisionEngine|LocalFaceEngine|EdgeTts|speakNeural/.test(native),'excluded native integrations must not be published');
assert(!html.includes('<option value="phone-local">'),'community build must not advertise an unavailable phone brain');
assert(html.includes('engine: "device"'));
assert(!fs.existsSync(path.join(dir,'face_models')));
assert(!fs.existsSync(path.join(dir,'phone-brain.js')));
console.log('PASS: all bundled scripts parse and community publication boundaries remain intact.');
