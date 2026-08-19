const sample = `import math
import os

def calculate_grade(score, attendance, bonus):
    if score < 0 or score > 100:
        return "Invalid score"
    if attendance < 75:
        return "Attendance too low"
    if score >= 90:
        if bonus > 0:
            return "A+"
        return "A"
    elif score >= 75:
        return "B"
    elif score >= 60:
        return "C"
    return "Needs improvement"

name = input("Student name: ")
result = calculate_grade(82, 90, 0)
print(name, result)`;

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
let result = null, filter = 'all';
const code = $('#codeInput');
const defaults = { longFunction: 25, deepNesting: 3, largeFile: 250 };
let config = { ...defaults, ...JSON.parse(localStorage.getItem('codelens-settings') || '{}') };

function syncConfig() { Object.keys(defaults).forEach(k => $('#' + k).value = config[k]); }
function updateLines() {
  const n = Math.max(1, code.value.split('\n').length);
  $('#lineNumbers').textContent = Array.from({length:n}, (_,i)=>i+1).join('\n');
  $('#unsaved').style.opacity = '.9';
}
function pos() { const p=code.selectionStart, before=code.value.slice(0,p); $('#cursorPos').textContent=`Ln ${before.split('\n').length}, Col ${before.length-before.lastIndexOf('\n')}`; }
function navigate(view) {
  $$('.view').forEach(x=>x.classList.toggle('active', x.id===view));
  $$('.nav-item[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view===view));
  $('#crumb').textContent = `Workspace / ${view[0].toUpperCase()+view.slice(1)}`;
  window.scrollTo({top:0,behavior:'smooth'});
}
function toast(message) { const t=$('#toast'); t.textContent=message; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2600); }
function esc(s) { return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

function analyze(source) {
  const lines = source.split('\n'), nonblank=lines.filter(x=>x.trim()).length;
  const findings=[]; const imports=[]; const functions=[]; let classes=0, decisions=0, maxNest=0, syntax=true;
  const stack=[]; let inTriple=null;
  lines.forEach((line, idx) => {
    const no=idx+1, trim=line.trim(), indent=(line.match(/^\s*/)[0].replace(/\t/g,'  ').length)/4;
    if ((trim.match(/'''|"""/g)||[]).length % 2) inTriple=!inTriple;
    if (!trim || trim.startsWith('#') || inTriple) return;
    if (/^(if|elif|for|while|except|case)\b/.test(trim) || /^\s*try\s*:/.test(trim) || /\band\b|\bor\b/.test(trim)) decisions++;
    if (/^(if|elif|for|while|try|except|with)\b/.test(trim)) maxNest=Math.max(maxNest,indent+1);
    let m=trim.match(/^def\s+([A-Za-z_]\w*)\s*\(/);
    if(m) functions.push({name:m[1],line:no,indent});
    if(/^class\s+/.test(trim)) classes++;
    m=trim.match(/^(?:import\s+([A-Za-z_]\w*)|from\s+([A-Za-z_.]+)\s+import)/); if(m) imports.push({name:m[1]||m[2].split('.')[0],line:no});
    if (/^(if|elif|for|while|def|class|try|except|else)\b/.test(trim) && !trim.endsWith(':') && !trim.includes('#')) syntax=false;
  });
  if (!source.trim()) findings.push({type:'warning',title:'No code to analyze',line:1,body:'Add a Python program in the Editor, then run the analysis.',tip:'Start with a small function or load the sample code.'});
  if (!syntax) findings.push({type:'warning',title:'Possible Python syntax issue',line:1,body:'A Python control statement may be missing its ending colon.',tip:'Check if, for, while, def and class lines.'});
  functions.forEach((fn, i)=>{
    const next=functions[i+1], end=next?next.line-1:lines.length, body=lines.slice(fn.line,end), fnLines=body.filter(x=>x.trim()).length;
    const first=body.find(x=>x.trim()); const after=body.slice(1).find(x=>x.trim());
    if(fnLines>Number(config.longFunction)) findings.push({type:'warning',title:`Long function: ${fn.name}()`,line:fn.line,body:`This function has ${fnLines} lines. Longer functions can be harder to test and explain.`,tip:'Try extracting one clear task into a smaller helper function.'});
    if(!after || !/^("""|''')/.test(after.trim())) findings.push({type:'suggestion',title:`Missing docstring: ${fn.name}()`,line:fn.line,body:'A short docstring helps readers understand what this function is for.',tip:`Add: """Explain what ${fn.name} does."""`});
  });
  if(maxNest>Number(config.deepNesting)) findings.push({type:'warning',title:'Deep nesting detected',line:1,body:`Your code reaches ${maxNest} nested blocks. Deep nesting makes conditions difficult to follow.`,tip:'Use early returns or move a nested block into a helper function.'});
  imports.forEach(im=>{ const occurrences=(source.match(new RegExp(`\\b${im.name}\\b`,'g'))||[]).length; if(occurrences<2) findings.push({type:'suggestion',title:`Unused import: ${im.name}`,line:im.line,body:`${im.name} is imported but does not appear to be used.`,tip:'Remove it to keep the file focused.'}); });
  if(nonblank>Number(config.largeFile)) findings.push({type:'warning',title:'Large file',line:1,body:`This file contains ${nonblank} non-empty lines.`,tip:'Consider splitting related features into separate modules.'});
  const complexity=1+decisions; if(complexity>=8) findings.push({type:'warning',title:`High complexity: ${complexity}`,line:1,body:`Your code has ${decisions} decision points, creating several possible paths.`,tip:'Break complex decisions into named helper functions.'});
  const docs = functions.length ? Math.round((functions.length-findings.filter(f=>f.title.startsWith('Missing docstring')).length)/functions.length*100) : 100;
  const syntaxScore=syntax?100:40, quality=Math.max(20,100-findings.filter(f=>f.type==='suggestion').length*12-findings.filter(f=>f.title.includes('Long')||f.title.includes('nesting')).length*14), complexityScore=Math.max(20,100-Math.max(0,complexity-2)*10);
  const score=Math.round(syntaxScore*.25+quality*.30+complexityScore*.25+docs*.20);
  return {file:$('#fileName').value||'untitled.py', at:new Date().toLocaleString(), loc:nonblank, functions:functions.length, classes, imports:imports.length, decisions, complexity, maxNest, findings, syntaxScore,quality,complexityScore,docs,score};
}
function renderResult(r) {
  $('#issueBadge').textContent=r.findings.length; $('#metricLoc').textContent=r.loc; $('#metricFunctions').textContent=r.functions; $('#metricScore').textContent=r.score; $('#metricScoreDetail').textContent=r.score>=80?'looking strong':r.score>=60?'room to grow':'start with the feedback'; $('#metricIssues').textContent=r.findings.length; $('#lastRun').textContent=`Updated ${r.at}`;
  $('#analysisSummary').textContent=`${r.file} · ${r.loc} lines · ${r.findings.length} improvement point${r.findings.length===1?'':'s'}`;
  $('#scoreValue').textContent=r.score; $('#scoreRing').style.setProperty('--progress',`${r.score*3.6}deg`); $('#scoreLabel').textContent=r.score>=85?'Looking great':r.score>=65?'A strong foundation':'Let’s make it clearer'; $('#scoreText').textContent=r.score>=85?'Your code is in good shape. Use the suggestions to make it even easier to maintain.':'Focus on one improvement point at a time. Small changes create clearer code.';
  setBar('syntax',r.syntaxScore);setBar('quality',r.quality);setBar('complexity',r.complexityScore);setBar('docs',r.docs);
  $('#findingsCount').textContent=`${r.findings.length} finding${r.findings.length===1?'':'s'} · click one to learn more`; $('#statLoc').textContent=r.loc; $('#statFunctions').textContent=r.functions; $('#statClasses').textContent=r.classes; $('#statImports').textContent=r.imports; $('#statDecisions').textContent=r.decisions; $('#complexityLevel').textContent=`Complexity: ${r.complexity} (${r.complexity<5?'simple':r.complexity<8?'moderate':'high'})`;
  $('#reportTitle').textContent=r.file; $('#reportPreview').textContent=`${r.loc} lines, ${r.functions} functions, ${r.findings.length} improvement points.`; $('#reportScore').textContent=`${r.score}/100`;
  renderFindings(); renderHistory();
}
function setBar(prefix,value){ $('#'+prefix+'Bar').style.width=value+'%'; $('#'+prefix+'Value').textContent=value+'%'; }
function renderFindings(){ const list=$('#findingsList'); if(!result)return; const arr=filter==='all'?result.findings:result.findings.filter(x=>x.type===filter); list.innerHTML=arr.length?arr.map((f,i)=>`<div class="finding" data-finding="${i}"><span class="finding-dot ${f.type}"></span><div><h4>${esc(f.title)}</h4><p>${esc(f.body)}</p></div><span class="tag">Line ${f.line}</span></div>`).join(''):'<div class="empty-state">Nothing in this category. Nice work.</div>'; $$('.finding').forEach((el,i)=>el.onclick=()=>showTutor(arr[i])); }
function saveHistory(){ const h=JSON.parse(localStorage.getItem('codelens-history')||'[]'); h.unshift({file:result.file,score:result.score,findings:result.findings.length,at:result.at}); localStorage.setItem('codelens-history',JSON.stringify(h.slice(0,6))); }
function renderHistory(){ const h=JSON.parse(localStorage.getItem('codelens-history')||'[]'); $('#historyList').innerHTML=h.length?h.slice(0,4).map(x=>`<div class="history-row"><span class="history-file">${esc(x.file)}</span><span>${x.findings} points</span><b>${x.score}</b></div>`).join(''):'Your saved analyses will appear here.'; const page=$('#historyPageList'); if(page) page.innerHTML=h.length?h.map(x=>`<div class="history-row"><span class="history-file">${esc(x.file)}</span><span>${esc(x.at)}</span><span>${x.findings}</span><b>${x.score}/100</b></div>`).join(''):'<div class="empty-state large">No analysis history yet. Analyze a Python file to create your first record.</div>'; }
function apiResult(raw){
  if(!raw.ok){return {file:$('#fileName').value||'main.py',at:new Date().toLocaleString(),loc:raw.metrics.loc,functions:0,classes:0,imports:0,decisions:0,complexity:0,findings:[{type:'warning',title:'Syntax error',line:raw.syntax_error.line,body:`${raw.syntax_error.message} (column ${raw.syntax_error.column})`,tip:'Check the highlighted line, then run the analysis again.'}],syntaxScore:0,quality:0,complexityScore:0,docs:0,score:0};}
  const m=raw.metrics,h=raw.health; return {file:$('#fileName').value||'main.py',at:new Date().toLocaleString(),loc:m.loc,functions:m.functions,classes:m.classes,imports:m.imports,decisions:m.conditions+m.loops,complexity:m.complexity,findings:raw.findings.map(f=>({type:['critical','high','medium'].includes(f.severity)?'warning':'suggestion',title:f.title,line:f.line,body:f.description,tip:f.recommendation})),syntaxScore:h.syntax,quality:h.quality,complexityScore:h.complexity,docs:h.documentation,score:h.score,structure:raw.structure};
}
async function runAnalysis(){
  const button=$('#analyzeEditor'); if(button) button.textContent='Analyzing…';
  try { const response=await fetch('http://127.0.0.1:8000/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code.value,file_name:$('#fileName').value||'main.py'})}); if(!response.ok)throw new Error('API unavailable'); result=apiResult(await response.json()); toast('AST analysis complete'); }
  catch { result=analyze(code.value); toast('Analysis complete (browser fallback)'); }
  finally { if(button) button.innerHTML='Analyze <span>→</span>'; }
  saveHistory(); renderResult(result); navigate('analysis');
}
function showTutor(f){ navigate('tutor'); $('#tutorWelcome').classList.add('hidden'); const el=$('#tutorResponse');el.classList.remove('hidden'); if(typeof f==='string')el.innerHTML=f;else el.innerHTML=`<p class="eyebrow">LINE ${f.line} · ${f.type.toUpperCase()}</p><h3>${esc(f.title)}</h3><p>${esc(f.body)}</p><h3>Try this</h3><p>${esc(f.tip)}</p>`; }
function tutorAnswer(kind){ if(!result){ showTutor('<h3>Start with an analysis</h3><p>Open the Editor, add your code, then select Analyze. I’ll have specific feedback ready for you.</p>'); return; } const f=result.findings; let html=''; if(kind==='explain') html=`<h3>What your code does</h3><p>This file has ${result.loc} non-empty lines, ${result.functions} function${result.functions===1?'':'s'}, and ${result.decisions} decision point${result.decisions===1?'':'s'}. The health score is ${result.score}/100.</p><p>Functions group instructions into reusable named tasks. Conditions such as <code>if</code> let your program choose between paths.</p>`; else if(kind==='issues')html=`<h3>Your improvement points</h3>${f.length?'<ul>'+f.map(x=>`<li><strong>${esc(x.title)}</strong>: ${esc(x.tip)}</li>`).join('')+'</ul>':'<p>No issues were detected. That is a great opportunity to add tests and examples.</p>'}`; else if(kind==='improve')html=`<h3>A practical improvement plan</h3><ol><li>Fix warnings first, especially syntax and high complexity.</li><li>Add short docstrings to explain each function.</li><li>Remove imports you no longer need.</li><li>Re-analyze after each small change.</li></ol>`; else html='<h3>What is cyclomatic complexity?</h3><p>It is a simple count of the different paths through code. Each <code>if</code>, loop, or exception branch adds a path. Smaller, focused functions keep that number manageable.</p>'; showTutor(html); }
function makeReport(){ if(!result) return null; return `# CodeLens Analysis Report\n\n**File:** ${result.file}  \n**Analyzed:** ${result.at}  \n**Code health:** ${result.score}/100\n\n## Statistics\n- Lines of code: ${result.loc}\n- Functions: ${result.functions}\n- Classes: ${result.classes}\n- Imports: ${result.imports}\n- Cyclomatic complexity: ${result.complexity}\n\n## Findings\n${result.findings.length?result.findings.map(f=>`- **${f.title}** (line ${f.line}) — ${f.body}\n  - Suggestion: ${f.tip}`).join('\n'):'No improvement points found.'}\n\n---\nGenerated locally by CodeLens. The health score is a learning metric, not an industry standard.`; }
function download(name, content, type){const a=document.createElement('a');a.href=URL.createObjectURL(content instanceof Blob?content:new Blob([content],{type}));a.download=name;a.click();URL.revokeObjectURL(a.href);}
async function exportReport(format){ if(!result){toast('Analyze code before exporting a report');navigate('editor');return;} const report=makeReport();if(format==='md')download('codelens-report.md',report,'text/markdown');if(format==='json')download('codelens-analysis.json',JSON.stringify(result,null,2),'application/json');if(format==='pdf'){try{toast('Generating PDF report…');const response=await fetch('http://127.0.0.1:8000/reports/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code.value,file_name:$('#fileName').value||'main.py'})});if(!response.ok)throw new Error();download('codelens-report.pdf',await response.blob(),'application/pdf');toast('PDF report ready');}catch{toast('Start the local API to generate the branded PDF report');}} }

code.value=localStorage.getItem('codelens-code')||sample; syncConfig(); updateLines();pos();renderHistory();
code.addEventListener('input',()=>{updateLines();localStorage.setItem('codelens-code',code.value)});code.addEventListener('keyup',pos);code.addEventListener('click',pos);code.addEventListener('scroll',()=>$('#lineNumbers').scrollTop=code.scrollTop);
$$('.nav-item[data-view]').forEach(x=>x.onclick=()=>navigate(x.dataset.view));$$('.go-editor').forEach(x=>x.onclick=()=>navigate('editor'));$$('.go-analysis').forEach(x=>x.onclick=()=>navigate('analysis'));$$('.go-tutor').forEach(x=>x.onclick=()=>navigate('tutor'));
$('#newCode').onclick=()=>{navigate('editor');code.focus()};$('#analyzeTop').onclick=runAnalysis;$('#analyzeEditor').onclick=runAnalysis;$('#reanalyze').onclick=runAnalysis;$('#loadSample').onclick=()=>{code.value=sample;updateLines();toast('Starter code loaded')};$('#clearCode').onclick=()=>{if(confirm('Clear the editor?')){code.value='';updateLines();}};
$('#fileInput').onchange=e=>{const f=e.target.files[0];if(!f)return;const reader=new FileReader();reader.onload=()=>{code.value=reader.result;$('#fileName').value=f.name;updateLines();toast('File opened')};reader.readAsText(f)};$('#saveCode').onclick=()=>download($('#fileName').value||'untitled.py',code.value,'text/x-python');
$('#runCode').onclick=async()=>{const output=$('#runOutput'),status=$('#runStatus'); const source=code.value.trim(); if(!source){status.textContent='No code';output.textContent='Add Python code before running.';return;} status.textContent='Running…';output.textContent='Starting controlled Python execution…';try{const response=await fetch('http://127.0.0.1:8000/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:source,timeout_seconds:4})});if(!response.ok)throw new Error('API unavailable');const data=await response.json();status.textContent=data.ok?`Completed · ${data.time_ms}ms`:`${data.kind} · ${data.time_ms}ms`;output.textContent=data.output||data.message||'Program completed with no output.';toast(data.ok?'Execution completed':'Execution failed');}catch{if(/(^|\n)\s*(os\.system|subprocess|open\s*\(|requests\.)/.test(source)){status.textContent='Blocked';output.textContent='The offline preview will not run code with system or file access.';return;}const prints=[...source.matchAll(/print\s*\(\s*(["'])(.*?)\1\s*\)/g)].map(m=>m[2]);status.textContent='Preview only';output.textContent=prints.length?prints.join('\n'):'Start the local CodeLens API for genuine Python execution.';toast('Backend unavailable: safe preview shown');}};
$$('.pill').forEach(p=>p.onclick=()=>{filter=p.dataset.filter;$$('.pill').forEach(x=>x.classList.toggle('active',x===p));renderFindings()});$$('[data-prompt]').forEach(x=>x.onclick=()=>tutorAnswer(x.dataset.prompt));$$('[data-question]').forEach(x=>x.onclick=()=>showTutor(`<h3>${esc(x.dataset.question)}</h3><p>${x.dataset.question.startsWith('Why')?'A docstring is a short note inside a function. It tells a future reader what the function does, its inputs, and its output without needing to decode the implementation.':'Cyclomatic complexity counts how many paths could be taken through a function. More decisions mean more paths to test and reason about.'}</p>`));
$('#tutorForm').onsubmit=e=>{e.preventDefault();const q=$('#tutorInput').value.trim();if(!q)return;let answer='Try the prompt buttons for a focused explanation.';if(/complex|path/i.test(q))answer='<h3>About complexity</h3><p>Complexity rises when code has many decisions. In your current file it is '+(result?result.complexity:'not calculated yet')+'. Give each function one job and use early returns when possible.</p>';else if(/doc|string|comment/i.test(q))answer='<h3>About documentation</h3><p>Use a docstring directly below <code>def</code> to explain purpose, parameters and results. It helps both people and documentation tools.</p>';else if(/improv|fix|better/i.test(q))answer='<h3>Where to begin</h3><p>'+(result&&result.findings[0]?esc(result.findings[0].tip):'Analyze your code first so I can offer a specific next step.')+'</p>';showTutor(answer);$('#tutorInput').value=''};
$$('.export').forEach(x=>x.onclick=()=>exportReport(x.dataset.format));$('#saveSettings').onclick=()=>{Object.keys(defaults).forEach(k=>config[k]=Number($('#'+k).value)||defaults[k]);localStorage.setItem('codelens-settings',JSON.stringify(config));toast('Preferences saved')};
const legacyPrint=$('[data-format="print"]');if(legacyPrint){legacyPrint.dataset.format='pdf';legacyPrint.innerHTML='Download PDF <span>↓</span>';legacyPrint.closest('.report-card').querySelector('h3').textContent='PDF report';legacyPrint.closest('.report-card').querySelector('p').textContent='A branded report with metrics and detailed findings.';legacyPrint.onclick=()=>exportReport('pdf');}
$('#clearHistory').onclick=()=>{if(confirm('Clear all saved CodeLens analyses from this browser?')){localStorage.removeItem('codelens-history');renderHistory();toast('Analysis history cleared');}};

let authMode='login';
function refreshAuth(){const user=JSON.parse(localStorage.getItem('codelens-user')||'null');const button=$('#openAuth');if(user){button.innerHTML=`<span>◉</span> ${esc(user.name||user.email.split('@')[0])}`;button.title='Log out';button.onclick=()=>{localStorage.removeItem('codelens-user');refreshAuth();toast('Logged out');};}else{button.innerHTML='<span>◉</span> Log in or sign up';button.title='Log in or sign up';button.onclick=()=>$('#authModal').classList.add('open');}}
function setAuthMode(mode){authMode=mode;$$('[data-auth-tab]').forEach(x=>x.classList.toggle('active',x.dataset.authTab===mode));$('#nameField').classList.toggle('hidden',mode==='login');$('#authTitle').textContent=mode==='login'?'Welcome back':'Create your local account';$('#authSubmit').innerHTML=(mode==='login'?'Log in':'Create account')+' <span>→</span>';$('#authPassword').autocomplete=mode==='login'?'current-password':'new-password';}
$('#closeAuth').onclick=()=>$('#authModal').classList.remove('open');$('#authModal').onclick=e=>{if(e.target===$('#authModal'))$('#authModal').classList.remove('open')};$$('[data-auth-tab]').forEach(x=>x.onclick=()=>setAuthMode(x.dataset.authTab));
$('#authForm').onsubmit=e=>{e.preventDefault();const email=$('#authEmail').value.trim().toLowerCase(),password=$('#authPassword').value,name=$('#authName').value.trim();const accounts=JSON.parse(localStorage.getItem('codelens-accounts')||'{}');if(authMode==='signup'){if(accounts[email]){toast('An account for this email already exists');return;}accounts[email]={name:name||email.split('@')[0],password};localStorage.setItem('codelens-accounts',JSON.stringify(accounts));localStorage.setItem('codelens-user',JSON.stringify({email,name:accounts[email].name}));toast('Local account created');}else{if(!accounts[email]||accounts[email].password!==password){toast('Incorrect email or password');return;}localStorage.setItem('codelens-user',JSON.stringify({email,name:accounts[email].name}));toast('Logged in');}$('#authModal').classList.remove('open');$('#authForm').reset();refreshAuth();};
refreshAuth();
