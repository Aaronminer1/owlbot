const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),dir=path.join(root,'app/src/main/assets');
const html=fs.readFileSync(path.join(dir,'growbot-brain.html'),'utf8');
for(const [i,m] of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].entries())new vm.Script(m[1],{filename:'inline-'+i+'.js'});
for(const m of html.matchAll(/<script src="([^"]+)"/g)){assert(/^[a-z-]+\.js$/.test(m[1]));new vm.Script(fs.readFileSync(path.join(dir,m[1]),'utf8'),{filename:m[1]});}
const native=fs.readFileSync(path.join(root,'app/src/main/java/dev/owlbot/brain/MainActivity.java'),'utf8');
assert(!/LocalVisionEngine|LocalFaceEngine|EdgeTts|speakNeural/.test(native),'excluded native integrations must not be published');
assert(!html.includes('<option value="phone-local">'),'community build must not advertise an unavailable phone brain');
assert(!/id="walkVisionRoute"[^]*?<\/select>/.exec(html)?.[0].includes('value="local"'),'walking must not offer the excluded on-phone runtime');
assert(native.includes('public void speakTagged('),'story playback requires tagged device-TTS completion');
assert(html.includes('engine: "device"'));
assert(!fs.existsSync(path.join(dir,'face_models')));
assert(!fs.existsSync(path.join(dir,'phone-brain.js')));
// Exporting private-source updates must not silently re-enable controls for a
// native embedding backend that this public host deliberately does not bundle.
const faces=fs.readFileSync(path.join(dir,'face-identity.js'),'utf8');
assert(faces.includes('toggle.disabled=!engineAvailable&&!IDENT.enabled'));
assert(faces.includes('enroll.disabled=!IDENT.enabled||!engineAvailable'));
for(const file of fs.readdirSync(path.join(root,'tests')).filter(n=>/^test_.*\.cjs$/.test(n))){
 const source=fs.readFileSync(path.join(root,'tests',file),'utf8');
 assert(!/backups\/\d{4}-\d{2}-\d{2}|andrew_provider_update|adb\.exe|localhost:9222/.test(source),'Tests must not depend on private exports or drive devices: '+file);
}
console.log('PASS: all bundled scripts parse and community publication boundaries remain intact.');
