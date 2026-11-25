'use strict';
(() => {
  const D = window.STUDY_DATA;
  const main = document.querySelector('#main');
  if (!D) { main.innerHTML = '<div class="empty"><h1>数据文件未加载</h1><p>请保留 data.js 与 index.html 在同一目录，然后重新打开网站。</p></div>'; return; }
  const topics = new Map(D.topics.map(t => [t.id, t]));
  const questions = new Map(D.questions.map(q => [q.id, q]));
  const lessons = new Map(D.lessons.map(l => [l.lesson, l]));
  const examsList = Array.isArray(D.exams) ? D.exams : [];
  const exams = new Map(examsList.map(e => [e.id, e]));
  const examQuestions = new Map();
  const examOfQuestion = new Map();
  for (const ex of examsList) {
    for (const q of ex.questions) {
      examQuestions.set(q.id, q);
      examOfQuestion.set(q.id, ex.id);
    }
  }
  const KEY = 'c-system-study-v1';
  const fresh = () => ({version:1, mastered:[], bookmarks:[], records:{}, sessions:[], active:null, examRecords:{}, examAttempts:{}, examSessions:[]});
  let db = fresh(), storageOK = true, drawerReturn = null, drawerRef = null, quizTimer = null, examBrowseExpand = false, lastBrowsePaper = null;
  const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  try { const saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved && saved.version === 1) db = sanitize(saved); } catch { storageOK = false; }
  function sanitizeAttempt(a, qMap, allowIdFn = null) {
    if (!a || !Array.isArray(a.ids) || !a.ids.length || !a.ids.every(id => qMap.has(id) && (!allowIdFn || allowIdFn(id)))) return null;
    const ids = [...new Set(a.ids)];
    const out = {ids, idx:Math.min(Math.max(Number(a.idx)||0,0),ids.length-1), answers:{}, created:Number(a.created)||Date.now(), finished:!!a.finished, style:a.style === 'exam'?'exam':'learn', summarySaved:!!a.summarySaved};
    for (const id of out.ids) {
      const r = a.answers?.[id], q = qMap.get(id);
      if (r) out.answers[id] = {choice:Array.isArray(r.choice)?r.choice.filter(n => Number.isInteger(n) && n >= 0 && n < (q.options?.length||0)):[],draft:String(r.draft||'').slice(0,30000),submitted:!!r.submitted,shown:!!r.shown,grade:typeof r.grade === 'boolean'?r.grade:null,recorded:!!r.recorded};
    }
    return out;
  }
  function sanitize(value) {
    const out = fresh();
    out.mastered = [...new Set((value.mastered || []).filter(id => topics.has(id)))];
    out.bookmarks = [...new Set((value.bookmarks || []).filter(id => topics.has(id)))];
    for (const [id, r] of Object.entries(value.records || {})) {
      if (questions.has(id) && r && typeof r.correct === 'boolean') out.records[id] = {correct:r.correct, self:!!r.self, attempts:Math.max(1, Number(r.attempts)||1), last:Number(r.last)||Date.now()};
    }
    out.sessions = Array.isArray(value.sessions) ? value.sessions.slice(-100).filter(s => s && typeof s.date === 'number' && typeof s.total === 'number').map(s => ({date:s.date,total:s.total,objective:Number(s.objective)||0,correct:Number(s.correct)||0,self:Number(s.self)||0,style:s.style === 'exam' ? 'exam':'learn'})) : [];
    out.active = sanitizeAttempt(value.active, questions);
    for (const [id, r] of Object.entries(value.examRecords || {})) {
      if (examQuestions.has(id) && r && typeof r.correct === 'boolean') out.examRecords[id] = {correct:r.correct, self:!!r.self, attempts:Math.max(1, Number(r.attempts)||1), last:Number(r.last)||Date.now()};
    }
    for (const [eid, att] of Object.entries(value.examAttempts || {})) {
      if (exams.has(eid)) {
        const clean = sanitizeAttempt(att, examQuestions, qid => examOfQuestion.get(qid) === eid);
        if (clean) out.examAttempts[eid] = clean;
      }
    }
    out.examSessions = Array.isArray(value.examSessions) ? value.examSessions.slice(-100).filter(s => s && exams.has(s.examId) && typeof s.date === 'number' && typeof s.total === 'number').map(s => ({examId:s.examId,date:s.date,total:s.total,objective:Number(s.objective)||0,correct:Number(s.correct)||0,self:Number(s.self)||0,style:s.style === 'exam'?'exam':'learn'})) : [];
    return out;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { if (storageOK) toast('浏览器无法保存进度，请通过「复习记录」导出备份。'); storageOK = false; } }
  function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2800); }
  function inline(text) {
    const pieces = [];
    const hold = html => { pieces.push(html); return '\u0001' + (pieces.length - 1) + '\u0001'; };
    let s = String(text)
      .replace(/``([^`\n]+(?:`[^`\n]+)*)``/g, (_, code) => {
        if (code.length >= 2 && code.startsWith(' ') && code.endsWith(' ') && /[^ ]/.test(code)) code = code.slice(1, -1);
        return hold('<code>' + escape(code) + '</code>');
      })
      .replace(/`([^`\n]+)`/g, (_, code) => hold('<code>' + escape(code) + '</code>'))
      .replace(/\\([\\*_\[\]<>|~`])/g, (_, ch) => hold(escape(ch)));
    s = escape(s);
    const renderSingleStar = str => {
      let out = '', i = 0;
      const beforeOk = c => !c || /[\s(\[（【“‘，。；：！？、—-]/.test(c);
      const afterOpenBad = c => !c || /[\s(\[)\],.;:!?/：。、，+\-=&|<>*]/.test(c);
      const beforeCloseBad = c => !c || /[\s(\[/+\-=&|<>*]/.test(c);
      const afterCloseOk = c => !c || /[\s)\],.;:!?）】”’，。；：！？、—-]/.test(c);
      while (i < str.length) {
        if (str[i] === '*' && (i === 0 || str[i - 1] !== '*') && str[i + 1] !== '*' && beforeOk(str[i - 1]) && !afterOpenBad(str[i + 1])) {
          let j = i + 2, matched = -1;
          while (j < str.length) {
            if (str[j] === '*' && str[j - 1] !== '*' && str[j + 1] !== '*' && !beforeCloseBad(str[j - 1]) && afterCloseOk(str[j + 1])) {
              matched = j;
              break;
            }
            j++;
          }
          if (matched !== -1) {
            out += '<em>' + str.slice(i + 1, matched) + '</em>';
            i = matched + 1;
            continue;
          }
        }
        out += str[i++];
      }
      return out;
    };
    let out = '', i = 0;
    while (i < s.length) {
      if (s[i] === '*' && s[i + 1] === '*' && (i === 0 || s[i - 1] !== '*') && s[i + 2] !== '*' && !(s[i - 1] && /[A-Za-z0-9_]/.test(s[i - 1])) && i + 2 < s.length && !/[\s)\],.;:!?：。、，*]/.test(s[i + 2])) {
        let j = i + 3, matched = -1;
        while (j + 1 < s.length) {
          if (s[j] === '*' && s[j + 1] === '*' && s[j - 1] !== '*' && s[j + 2] !== '*' && !/[\s(\[*]/.test(s[j - 1]) && !(s[j + 2] && /[A-Za-z0-9_]/.test(s[j + 2]))) {
            matched = j;
            break;
          }
          j++;
        }
        if (matched !== -1) {
          out += hold('<strong>' + renderSingleStar(s.slice(i + 2, matched)) + '</strong>');
          i = matched + 2;
          continue;
        }
      }
      out += s[i++];
    }
    s = renderSingleStar(out);
    for (let pass = 0; pass < 4 && s.includes('\u0001'); pass++) {
      s = s.replace(/\u0001(\d+)\u0001/g, (_, n) => pieces[Number(n)]);
    }
    return s;
  }
  function md(value) {
    const lines = String(value || '').replace(/\r/g,'').split('\n');
    let out = '', i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {i++; continue;}
      if (/^\s*```/.test(line)) {const code=[]; i++; while(i<lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]); i++; out+='<pre><code>'+escape(code.join('\n'))+'</code></pre>'; continue;}
      const heading = line.match(/^(#{1,6})\s+(.+)/);
      if (heading) {const level=Math.min(heading[1].length+1,6); out+=`<h${level}>${inline(heading[2])}</h${level}>`; i++; continue;}
      if (/^\s*\|/.test(line) && i+1<lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i+1])) {
        const cells = row => row.trim().replace(/^\||(?<!\\)\|$/g,'').split(/(?<!\\)\|(?=(?:[^`]*`[^`]*`)*[^`]*$)/).map(c => c.trim().replace(/\\\|/g,'|'));
        out+='<div class="table-scroll"><table><thead><tr>'+cells(line).map(c=>'<th>'+inline(c)+'</th>').join('')+'</tr></thead><tbody>'; i+=2;
        while(i<lines.length && /^\s*\|/.test(lines[i])) {out+='<tr>'+cells(lines[i++]).map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>';}
        out+='</tbody></table></div>'; continue;
      }
      if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
        const ordered=/^\s*\d+[.)]\s+/.test(line), re=ordered?/^\s*\d+[.)]\s+/:/^\s*[-*+]\s+/;
        out+=ordered?'<ol>':'<ul>';
        while(i<lines.length && re.test(lines[i])) {out+='<li>'+inline(lines[i++].replace(re,''))+'</li>';}
        out+=ordered?'</ol>':'</ul>'; continue;
      }
      if (/^>\s?/.test(line)) {const block=[]; while(i<lines.length && /^>\s?/.test(lines[i])) block.push(lines[i++].replace(/^>\s?/,'')); out+='<blockquote>'+md(block.join('\n'))+'</blockquote>'; continue;}
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {out+='<hr>'; i++; continue;}
      const para = [line]; i++;
      while (i<lines.length && lines[i].trim() && !/^(?:\s*```|#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|>\s?|\s*\||\s*([-*_])\1{2,}\s*$)/.test(lines[i])) para.push(lines[i++]);
      out+='<p>'+para.map(inline).join('<br>')+'</p>';
    }
    return out;
  }
  const href = params => '#knowledge?'+new URLSearchParams(params).toString();
  function route() {const [view, query] = location.hash.slice(1).split('?'); return {view: ['overview','knowledge','practice','exams','sources','progress'].includes(view)?view:'overview',p:new URLSearchParams(query||'')};}
  function go(hash) {if (location.hash === hash) render(); else location.hash=hash;}
  function option(value,label,selected) {return `<option value="${escape(value)}" ${String(value)===String(selected)?'selected':''}>${escape(label)}</option>`;}
  function lessonOptions(selected='') {return option('','全部课件',selected)+D.lessons.map(l=>option(l.lesson,`第${l.lesson}课 · ${l.shortTitle || l.title}`,selected)).join('');}
  const typeName = {single:'单选题',multiple:'多选题',truefalse:'判断题',short:'简答题',code:'代码分析 / 编程题',essay:'问答题'};
  const diffName = {1:'基础',2:'进阶',3:'综合'};
  function badge(q) {return `<span class="pill">${typeName[q.type]}</span><span class="pill ${q.difficulty===3?'orange':''}">${diffName[q.difficulty]}</span><span class="pill">第 ${q.lesson} 课</span>`;}
  function examBadge(ex,q) {return `<span class="pill">${escape(ex.tag)}</span><span class="pill">${typeName[q.type]||escape(q.type)}</span><span class="pill">第 ${q.number} 题</span><span class="pill">第 ${q.lesson} 课</span>`;}
  function renderRubricItem(v) {return '<li>'+((String(v).includes('\n')||/^\s*```/.test(v))?md(v):inline(v))+'</li>';}
  function promptPreview(q) {return q.prompt.replace(/```[\s\S]*?```/g,' [代码] ').replace(/`([^`\n]+)`/g,'$1').replace(/\*\*(.+?)\*\*/g,'$1').replace(/\s+/g,' ').trim();}
  function answerIn(attempt,id) {return attempt.answers[id] ||= {choice:[],draft:'',submitted:false,shown:false,grade:null,recorded:false};}
  function recordTo(map,q,r) {if(r.recorded || typeof r.grade!=='boolean')return; const previous=map[q.id]; map[q.id]={correct:r.grade,self:!Array.isArray(q.answer),attempts:(previous?.attempts||0)+1,last:Date.now()};r.recorded=true;}
  function elapsedFor(attempt) {const min=Math.floor((Date.now()-attempt.created)/60000); return `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`;}
  function examStats(ex) {let answered=0,correctCount=0; for(const q of ex.questions){const rec=db.examRecords[q.id]; if(rec){answered++; if(rec.correct)correctCount++;}} return {total:ex.questions.length,answered,correct:correctCount,wrong:answered-correctCount};}
  function sourceButtons(refs) {return refs.map(r=>`<button class="source-button" data-action="source" data-lesson="${r.lesson}" data-pages="${r.pages.join(',')}">▤ 第${r.lesson}课 · 第${formatPages(r.pages)}页 ↗</button>`).join('');}
  function formatPages(pages) {const a=[...new Set(pages)].sort((a,b)=>a-b), s=[]; for(let i=0;i<a.length;i++){let start=a[i],end=start; while(i+1<a.length && a[i+1]===end+1) end=a[++i]; s.push(start===end?String(start):`${start}–${end}`);} return s.join('、');}
  function stats() {const rs=Object.values(db.records), wrong=rs.filter(r=>!r.correct).length; return {answered:rs.length,wrong,correct:rs.length-wrong,mastered:db.mastered.length};}
  function stat(value,name,symbol) {return `<div class="stat"><div><div class="name">${name}</div><div class="value">${value}</div></div><span class="symbol">${symbol}</span></div>`;}
  function heading(kicker,title,description,actions='') {return `<div class="page-heading"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${description}</p></div>${actions}</div>`;}
  document.querySelector('#lesson-nav').innerHTML=D.lessons.map(l=>`<a href="${href({lesson:l.lesson})}" title="${escape(l.title)}"><span class="num">0${l.lesson}</span><span class="label">${escape(l.shortTitle || l.title)}</span></a>`).join('');
  function overview() {
    const s=stats();
    main.innerHTML=`<section class="hero"><div><div class="eyebrow">C SYSTEM PROGRAMMING / REVISION NOTES</div><h1>把每一个知识点，<br>复习到<em>心中有数。</em></h1><p>从对象、类型和表达式开始，理清指针、数组与函数的底层语义。<br>7 份课件逐页整理，知识点与练习均可追溯到原课件。</p><div class="hero-actions"><a class="button primary" href="#knowledge">打开知识点手册 →</a><a class="button" href="#practice">随机练习 ✎</a></div></div><div class="hero-code" aria-hidden="true"><div class="code-top"><span>THE OBJECT MODEL</span><span>● ● ●</span></div><span class="gray">// 从类型，到对象，再到求值</span><br><span class="orange">int</span> a[3] = {1, 2, 3};<br><span class="orange">int</span> (*p)[3] = &amp;a;<br><br>sizeof a; <span class="gray">// 数组对象</span><br>sizeof p; <span class="gray">// 指针对象</span><br>(*p)[1]; <span class="gray">// 定位 → 读值</span></div></section>
      <div class="stat-grid">${stat(D.topics.length,'可检索知识点','≡')}${stat(D.questions.length,'分层练习题','✎')}${stat(D.meta.totalPages,'原课件 PDF 页','▤')}${stat(s.mastered+'/'+D.topics.length,'已标记掌握','✓')}</div>
      <div class="section-top"><h2>沿着课程脉络复习</h2><p>先建立模型，再分析代码</p></div><div class="lesson-grid">${D.lessons.map(l=>{const n=D.topics.filter(t=>t.lesson===l.lesson).length, q=D.questions.filter(t=>t.lesson===l.lesson).length; return `<a class="lesson-card" href="${href({lesson:l.lesson})}"><div class="lesson-top"><span class="lesson-number">LESSON 0${l.lesson}</span><span class="pill">${l.pages} 页</span></div><h3>${escape(l.title)}</h3><p>${escape(l.description||'逐项梳理核心规则、代码示例与考试易错点。')}</p><div class="lesson-bottom"><span>${n} 个知识点 · ${q} 道练习</span><b>↗</b></div></a>`;}).join('')}</div>
      <div class="section-top"><h2>让复习更有针对性</h2><a class="micro muted" href="#progress">查看学习记录 →</a></div><div class="info-grid"><section class="panel"><h3>一个代码题的分析顺序</h3><ol class="checklist"><li>先读声明：对象类型、被指向类型与限定符。</li><li>再分组：运算符优先级、表达式类型与左值性。</li><li>判断转换：左值转换、数组退化、整型提升。</li><li>追踪对象：定位、读写、存储期与生命周期。</li><li>检查结论：约束违反、未定义、未指定、实现定义。</li></ol><a class="button small" href="${href({search:'未定义'})}">查阅未定义行为相关知识点 →</a></section><section class="panel"><h3>继续你的复习</h3><p class="muted micro">已练习 ${s.answered} 道题，当前错题 ${s.wrong} 道，收藏 ${db.bookmarks.length} 个知识点。</p><div class="row"><a class="button small" href="#practice?pool=wrong">复习错题 ${s.wrong}</a><a class="button small" href="${href({saved:'1'})}">查看收藏 ${db.bookmarks.length}</a>${examsList.length?`<a class="button small" href="#exams">往年题与模拟卷 ${examsList.length} 套</a>`:''}</div><div class="note" style="margin-top:20px;margin-bottom:0">页码一律指 PDF 中从 1 开始的物理页。课件中的教学术语、标准版本差异和平台假设均在正文中注明。</div></section></div>${!storageOK?'<p class="note warning">当前浏览器限制本地存储。请导出学习记录备份，或使用附带启动脚本。</p>':''}`;
  }
  function filteredTopics(p) {
    const search=(p.get('search')||'').toLowerCase().trim().split(/\s+/).filter(Boolean);
    return D.topics.filter(t=>(!p.get('lesson')||t.lesson===Number(p.get('lesson')))&&(!p.get('section')||t.section===p.get('section'))&&(!p.get('saved')||db.bookmarks.includes(t.id))&&search.every(word=>[t.title,t.summary,t.section,...t.keywords,t.content].join(' ').toLowerCase().includes(word)));
  }
  function knowledge(p) {
    const list=filteredTopics(p), t=topics.get(p.get('topic'));
    const current=t && list.some(v=>v.id===t.id)?t:list[0], sections=[...new Set(D.topics.map(t=>t.section))].sort();
    main.innerHTML=heading('KNOWLEDGE LIBRARY','知识点手册','搜索标题、规则、英文术语或 C 代码，点击出处可定位原课件。',`<div class="row"><button class="button small" data-action="print">打印当前知识点</button><a class="button small" href="../C语言系统级编程知识点汇总.md" download>↓ 完整 Markdown</a></div>`)+
      `<form id="knowledge-filters" class="filters"><label class="search-wrap"><span aria-hidden="true">⌕</span><input name="search" type="search" aria-label="全文搜索知识点" placeholder="搜索，如：const、数组退化、sizeof…" value="${escape(p.get('search')||'')}"></label><select name="lesson" aria-label="筛选课件">${lessonOptions(p.get('lesson')||'')}</select><select name="section" aria-label="筛选主题">${option('','全部主题',p.get('section'))}${sections.map(v=>option(v,v,p.get('section'))).join('')}</select><select name="saved" aria-label="收藏筛选">${option('','所有知识点',p.get('saved'))}${option('1','仅看收藏',p.get('saved'))}</select><button class="button small primary" type="submit">搜索</button></form>`+
      (list.length?`<div class="knowledge-layout"><aside class="topic-index" aria-label="知识点目录"><div class="index-header"><span>匹配 ${list.length} 个知识点</span><span>已掌握 ${list.filter(t=>db.mastered.includes(t.id)).length}</span></div>${list.map((v,i)=>`${i===0||v.lesson!==list[i-1].lesson?`<div class="index-section">第 ${v.lesson} 课 · ${escape(lessons.get(v.lesson).shortTitle||lessons.get(v.lesson).title)}</div>`:''}<a class="topic-link ${v.id===current.id?'active':''}" href="${href({...Object.fromEntries(p),topic:v.id})}" ${v.id===current.id?'aria-current="true"':''}>${escape(v.title)}<span class="topic-meta"><span>${escape(v.section)}</span>${db.mastered.includes(v.id)?'<span>✓ 已掌握</span>':''}${db.bookmarks.includes(v.id)?'<span>★</span>':''}</span></a>`).join('')}</aside><section class="topic-detail" id="topic-detail"><article class="panel"><div class="topic-toolbar"><span class="eyebrow" style="margin:0">LESSON 0${current.lesson} / ${escape(current.section)}</span><div class="row"><button class="button small" data-action="bookmark" data-id="${current.id}" aria-pressed="${db.bookmarks.includes(current.id)}">${db.bookmarks.includes(current.id)?'★ 已收藏':'☆ 收藏'}</button><button class="button small" data-action="master" data-id="${current.id}" aria-pressed="${db.mastered.includes(current.id)}">${db.mastered.includes(current.id)?'✓ 已掌握':'标记掌握'}</button></div></div><h2>${escape(current.title)}</h2><div class="row">${current.keywords.map(k=>`<a class="pill" href="${href({search:k})}">${escape(k)}</a>`).join('')}</div><p class="topic-summary">${escape(current.summary)}</p><div class="article">${md(current.content)}</div><div class="source-strip"><p class="micro muted">原课件出处 · 点击查看页码与 PDF</p><div class="row">${sourceButtons(current.refs)}</div></div><div class="row" style="margin-top:18px"><a class="button primary small" href="#practice?topic=${current.id}">练习本知识点 · ${D.questions.filter(q=>q.topicIds.includes(current.id)).length} 题 →</a><a class="button small" href="#sources?lesson=${current.lesson}">查看本课页码索引</a></div></article><div class="topic-next">${list.indexOf(current)>0?`<a class="button small" href="${href({...Object.fromEntries(p),topic:list[list.indexOf(current)-1].id})}">← 上一知识点</a>`:'<span></span>'}${list.indexOf(current)<list.length-1?`<a class="button small" href="${href({...Object.fromEntries(p),topic:list[list.indexOf(current)+1].id})}">下一知识点 →</a>`:''}</div></section></div>`:'<div class="empty"><h3>没有匹配的知识点</h3><p>试试更短的关键词，或清除课件、主题和收藏筛选。</p><a class="button small" href="#knowledge">查看全部知识点</a></div>');
    document.querySelector('#knowledge-filters').addEventListener('submit', e=>{e.preventDefault(); const params=Object.fromEntries(new FormData(e.currentTarget)); for(const k in params) if(!params[k]) delete params[k]; go(href(params));});
    document.querySelectorAll('#knowledge-filters select').forEach(el=>el.addEventListener('change',()=>document.querySelector('#knowledge-filters').requestSubmit()));
  }
  function practice(p) {
    if (db.active && !p.has('setup') && !p.has('topic') && !p.has('pool')) { if(db.active.finished) result(); else quiz(); return; }
    const topic=topics.get(p.get('topic')), s=stats();
    main.innerHTML=heading('PRACTICE LAB','练习与组卷','按课件、主题、题型和难度挑选题目；客观题自动判分，简答与代码题按要点自评。',db.active?'<button class="button small" data-action="resume">继续上一套题 →</button>':'')+
      `<div class="setup-layout"><section class="panel"><h3>设置你的练习</h3><form id="practice-form"><div class="form-grid"><div class="field"><label for="quiz-lesson">课件范围</label><select class="form-select" id="quiz-lesson" name="lesson">${lessonOptions(topic?.lesson||'')}</select></div><div class="field"><label for="quiz-diff">难度梯度</label><select class="form-select" id="quiz-diff" name="difficulty">${option('','全部难度','')}${[1,2,3].map(v=>option(v,diffName[v],'')).join('')}</select></div><div class="field"><label for="quiz-type">题型</label><select class="form-select" id="quiz-type" name="type">${option('','全部题型','')}${Object.entries(typeName).filter(([v])=>v!=='essay').map(([v,n])=>option(v,n,'')).join('')}</select></div><div class="field"><label for="quiz-pool">题目来源</label><select class="form-select" id="quiz-pool" name="pool">${option('all','全部题库',p.get('pool')||'all')}${option('new','未练习题目',p.get('pool'))}${option('wrong',`当前错题（${s.wrong}）`,p.get('pool'))}</select></div><div class="field full"><label for="quiz-topic">指定知识点（可选）</label><select class="form-select" id="quiz-topic" name="topic">${option('','全部知识点',topic?.id||'')}${D.topics.map(t=>option(t.id,`第${t.lesson}课 · ${t.title}`,topic?.id||'')).join('')}</select></div><div class="field"><label for="quiz-count">组卷题数</label><select class="form-select" id="quiz-count" name="count">${[10,20,30,50].map(v=>option(v,v+' 题',20)).join('')}${option('all','全部匹配题目',20)}</select></div><div class="field"><label for="quiz-style">练习方式</label><select class="form-select" id="quiz-style" name="style">${option('learn','逐题练习 · 立即看解析','learn')}${option('exam','模拟组卷 · 交卷后看解析','learn')}</select></div></div><div class="row between" style="margin-top:25px"><span class="micro muted">每次随机抽取，不重复出题。</span><button class="button primary" type="submit">生成练习 →</button></div></form></section><aside class="panel"><div class="eyebrow">QUESTION BANK</div><h3>从理解规则，到独立分析</h3><div class="setup-count" id="available-count">${D.questions.length}</div><p class="micro muted" id="available-description">道题符合当前条件</p><div class="row">${[1,2,3].map(v=>`<span class="pill ${v===3?'orange':''}">${diffName[v]} ${D.questions.filter(q=>q.difficulty===v).length}</span>`).join('')}</div><hr style="border:0;border-top:1px solid var(--line);margin:22px 0"><ul class="checklist"><li>基础：术语、类型与规则判断。</li><li>进阶：声明辨析、转换与代码求值。</li><li>综合：跨知识点分析、边界条件与错误修正。</li><li>多选题需选齐所有正确项。</li><li>代码不在浏览器中执行；自评结果单独统计。</li></ul><div class="note" style="margin-bottom:0">练习会自动保存，可随时离开后继续。错题以最近一次已评分作答为准。</div></aside></div>`;
    const form=document.querySelector('#practice-form');
    const pool=()=>filterQuestions(Object.fromEntries(new FormData(form)));
    const update=()=>{const n=pool().length; document.querySelector('#available-count').textContent=n; document.querySelector('#available-description').textContent=`道题符合当前条件${n && form.count.value!=='all' && n<Number(form.count.value)?'，将使用全部匹配题':''}`;};
    form.addEventListener('change',update); update();
    form.addEventListener('submit',e=>{e.preventDefault(); const settings=Object.fromEntries(new FormData(form)), all=pool(); if(!all.length){toast('当前条件没有匹配题目，请放宽筛选。');return;} if(db.active&&!db.active.finished&&!confirm('开始新练习将替换未完成的这套题。已评分记录会保留，是否继续？')) return; for(let i=all.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [all[i],all[j]]=[all[j],all[i]];} db.active={ids:all.slice(0,settings.count==='all'?all.length:Number(settings.count)).map(q=>q.id),idx:0,answers:{},created:Date.now(),finished:false,style:settings.style,summarySaved:false};save();go('#practice');});
  }
  function filterQuestions(p) {return D.questions.filter(q=>(!p.lesson||q.lesson===Number(p.lesson))&&(!p.difficulty||q.difficulty===Number(p.difficulty))&&(!p.type||q.type===p.type)&&(!p.topic||q.topicIds.includes(p.topic))&&(p.pool!=='wrong'||db.records[q.id]?.correct===false)&&(p.pool!=='new'||!db.records[q.id]));}
  function answerFor(id) {return answerIn(db.active, id);}
  function correct(q, selected) {return q.answer.length===selected.length && q.answer.every(v=>selected.includes(v));}
  function record(q,r) {recordTo(db.records, q, r);}
  function elapsed() {return elapsedFor(db.active);}
  function renderSessionQuiz(opts) {
    const {attempt:a, qMap, kicker, title, description, topActions, badgeFn, paletteHtml, actions, examId} = opts;
    const q = qMap.get(a.ids[a.idx]), r = answerIn(a, q.id), self = !Array.isArray(q.answer), show = a.finished || (a.style==='learn' && r.shown), submitted = r.submitted || a.finished;
    const answered = a.ids.filter(id => a.answers[id]?.submitted).length;
    const attr = examId ? ` data-exam="${escape(examId)}"` : '';
    const relTopics = (q.topicIds || []).filter(id => topics.has(id));
    main.innerHTML = heading(kicker, title, description, topActions) +
      `<div class="practice-top"><span class="counter">QUESTION ${String(a.idx+1).padStart(2,'0')} / ${a.ids.length}</span><span class="micro muted">已提交 ${answered} / ${a.ids.length} · <span id="quiz-time">${elapsedFor(a)}</span> 小时:分钟</span></div><div class="progress-bar"><i style="width:${100*answered/a.ids.length}%"></i></div><div class="quiz-layout"><section class="panel question-panel"><div class="row">${badgeFn(q)}${self?'<span class="pill orange">按要点自评</span>':''}</div><div class="question-title"><div class="article">${md(q.prompt)}</div></div>${self?`<label for="answer-draft" class="micro muted">填写你的${q.type==='code'?'分析或代码':'答案'}，然后对照参考答案评分。</label><textarea id="answer-draft" class="answer-area" placeholder="在这里写下你的思路…" ${submitted?'readonly':''}>${escape(r.draft)}</textarea>`:`<div class="options" role="group" aria-label="答案选项">${q.options.map((text,i)=>`<label class="option ${r.choice.includes(i)?'selected':''} ${show&&q.answer.includes(i)?'correct':''} ${show&&r.choice.includes(i)&&!q.answer.includes(i)?'incorrect':''}"><input type="${q.type==='multiple'?'checkbox':'radio'}" name="answer-choice" value="${i}" ${r.choice.includes(i)?'checked':''} ${submitted?'disabled':''}><span class="option-letter">${String.fromCharCode(65+i)}</span><span class="option-text article">${md(text)}</span></label>`).join('')}</div>`}
      ${show?`<div class="feedback ${r.grade===false?'bad':''}"><h3>${self?(r.grade===null?'参考答案 · 请完成自评':r.grade?'自评：已掌握':'自评：需要复习'):(r.grade?'✓ 回答正确':r.choice.length?'需要再复习一下':'未作答')} ${!self?`<span class="micro muted">正确答案：${q.answer.map(i=>String.fromCharCode(65+i)).join('、')}</span>`:''}</h3>${self?`<div class="article">${md(q.answer)}</div>${q.rubric?.length?`<h4>评分要点</h4><ul class="checklist article">${q.rubric.map(renderRubricItem).join('')}</ul>`:''}`:''}<div class="article">${md(q.explanation)}</div>${self&&r.grade===null?`<div class="row"><button class="button small primary" data-action="${actions.selfGrade}"${attr} data-grade="yes">符合要点 · 已掌握</button><button class="button small" data-action="${actions.selfGrade}"${attr} data-grade="no">未符合要点 · 加入错题</button></div>`:''}${(q.refs||[]).length?`<div class="source-strip"><div class="row">${sourceButtons(q.refs)}</div></div>`:''}</div>`:''}
      <div class="quiz-actions"><button class="button" data-action="${actions.prev}"${attr} ${a.idx===0?'disabled':''}>← 上一题</button>${!submitted?`<button class="button primary" data-action="${actions.submit}"${attr}>${self?(a.style==='exam'?'保存作答':'查看参考答案'):'提交答案'}</button>`:a.style==='exam'&&!a.finished?`<button class="button" data-action="${actions.edit}"${attr}>修改作答</button>`:''}<button class="button ${submitted?'primary':''}" data-action="${actions.next}"${attr} ${a.idx===a.ids.length-1?'disabled':''} title="${!a.finished?'已作答时点击将自动提交本题并进入下一题':''}">下一题 →</button>${!a.finished?`<button class="button small" data-action="${actions.finish}"${attr}>结束并交卷</button>`:''}</div>${!a.finished?`<p class="micro muted" style="margin:12px 0 0">${a.style==='exam'?'提示：选好选项或填写作答后，直接点击「下一题」或「结束并交卷」会自动保存提交本题，交卷后统一显示解析。':`提示：选好选项或填写作答后，直接点击「下一题」会自动提交本题并进入下一题；点击「${self?'查看参考答案':'提交答案'}」可在当前页立刻查看解析。`}</p>`:''}</section><aside class="quiz-side"><section class="panel"><h3>答题卡</h3>${paletteHtml}<p class="micro muted" style="margin:14px 0 0">绿色：已掌握<br>红色：需复习<br>米色：已提交 / 待自评</p></section><section class="panel"><h3>关联知识点</h3>${relTopics.length?relTopics.map(id=>`<a class="list-link" href="${href({lesson:topics.get(id).lesson,topic:id})}">${escape(topics.get(id).title)} <span>↗</span></a>`).join(''):'<p class="micro muted">无关联知识点</p>'}${!a.finished&&a.style==='exam'?'<p class="micro muted" style="margin-top:12px">解析在交卷后显示。可先标记作答，再统一检查。</p>':((q.refs||[]).length?`<div style="margin-top:14px" class="row">${sourceButtons(q.refs)}</div>`:'')}</section></aside></div>`;
    document.querySelectorAll('[name="answer-choice"]').forEach(el=>el.addEventListener('change',()=>{r.choice=[...document.querySelectorAll('[name="answer-choice"]:checked')].map(el=>Number(el.value));save();document.querySelectorAll('.option').forEach(label=>label.classList.toggle('selected',label.querySelector('input').checked));}));
    const draft=document.querySelector('#answer-draft');if(draft) draft.addEventListener('input',()=>{r.draft=draft.value;save();});
    clearInterval(quizTimer);if(!a.finished) quizTimer=setInterval(()=>{const el=document.querySelector('#quiz-time');if(el)el.textContent=elapsedFor(a);},30000);
  }
  function quiz(review=false) {
    const a=db.active;
    const paletteHtml=`<div class="question-palette">${a.ids.map((id,i)=>{const v=a.answers[id];return `<button title="第${i+1}题" aria-label="跳转第${i+1}题" class="${a.idx===i?'current':''} ${v?.grade===true?'done':v?.grade===false?'wrong':v?.submitted?'pending':''}" data-action="quiz-jump" data-index="${i}">${i+1}</button>`;}).join('')}</div>`;
    renderSessionQuiz({
      attempt:a, qMap:questions,
      kicker:a.finished?'ANSWER REVIEW':'ACTIVE PRACTICE',
      title:a.finished?'答案与解析':a.style==='exam'?'模拟组卷':'逐题练习',
      description:'每道题都关联知识点与课件出处。',
      topActions:`<div class="row"><button class="button small" data-action="${a.finished?'results':'setup'}">${a.finished?'返回结果':'更换设置'}</button></div>`,
      badgeFn:badge, paletteHtml, examId:null,
      actions:{prev:'quiz-prev',submit:'submit-answer',edit:'edit-answer',next:'quiz-next',finish:'finish',selfGrade:'self-grade',results:'results'}
    });
  }
  function hasPendingAnswer(q, r) {
    if (!r || r.submitted) return false;
    return Array.isArray(q.answer) ? r.choice.length > 0 : !!r.draft.trim();
  }
  function autoSubmitSessionAnswer(a, qMap, recordMap, label) {
    if (!a || a.finished) return false;
    const q = qMap.get(a.ids[a.idx]), r = answerIn(a, q.id);
    if (!hasPendingAnswer(q, r)) return false;
    if (Array.isArray(q.answer)) {
      r.submitted = true;
      if (a.style === 'learn') {
        r.grade = correct(q, r.choice);
        r.shown = true;
        recordTo(recordMap, q, r);
        toast(r.grade ? `已自动提交第 ${label} 题：✓ 回答正确` : `已自动提交第 ${label} 题：需要复习（正确答案：${q.answer.map(i => String.fromCharCode(65 + i)).join('、')}）`);
      }
    } else {
      r.submitted = true;
      r.shown = a.style === 'learn';
      if (a.style === 'learn') toast(`已自动提交第 ${label} 题作答，可点答题卡回看参考答案自评`);
    }
    return true;
  }
  function submitSessionAnswer(a, qMap, recordMap, renderFn) {
    const q=qMap.get(a.ids[a.idx]), r=answerIn(a, q.id);
    if(Array.isArray(q.answer)){if(!r.choice.length){toast('请选择答案后提交。');return;}r.submitted=true;if(a.style==='learn'){r.grade=correct(q,r.choice);r.shown=true;recordTo(recordMap,q,r);}}
    else{if(!r.draft.trim()){toast('请先写下你的答案或分析。');return;}r.submitted=true;r.shown=a.style==='learn';}
    save(); renderFn();
  }
  function finishSession(a, qMap, recordMap, doneFn) {
    const n=a.ids.filter(id=>{const q=qMap.get(id),r=a.answers[id];return !r?.submitted&&!hasPendingAnswer(q,r);}).length;
    if(n&&!confirm(`还有 ${n} 道题未作答。交卷后客观题未作答计为错误，是否交卷？`)) return;
    a.finished=true;
    for(const id of a.ids){const q=qMap.get(id),r=answerIn(a,id);if(hasPendingAnswer(q,r))r.submitted=true;r.shown=true;if(Array.isArray(q.answer)){r.grade=r.submitted&&correct(q,r.choice);r.submitted=true;recordTo(recordMap,q,r);}}
    save(); doneFn();
  }
  function submitAnswer() {submitSessionAnswer(db.active, questions, db.records, ()=>quiz());}
  function finish() {finishSession(db.active, questions, db.records, ()=>result());}
  function result() {clearInterval(quizTimer);const a=db.active;if(!a){practice(new URLSearchParams('setup=1'));return;}const objective=a.ids.filter(id=>Array.isArray(questions.get(id).answer)), count=objective.filter(id=>a.answers[id]?.grade).length,self=a.ids.length-objective.length, rated=a.ids.filter(id=>!Array.isArray(questions.get(id).answer)&&typeof a.answers[id]?.grade==='boolean').length;
    if(!a.summarySaved){db.sessions.push({date:Date.now(),total:a.ids.length,objective:objective.length,correct:count,self,style:a.style});db.sessions=db.sessions.slice(-100);a.summarySaved=true;save();}
    main.innerHTML=heading('SESSION COMPLETE','这次练习，复盘一下。','客观题成绩与主观题自评分别记录。未作答的客观题按错误统计。',`<a class="button primary small" href="#practice?setup=1">再练一套 →</a>`)+
      `<div class="stat-grid">${stat(objective.length?Math.round(count/objective.length*100)+'%':'—','客观题正确率','✓')}${stat(count+'/'+objective.length,'客观题正确数','✎')}${stat(rated+'/'+self,'主观题已自评','◷')}${stat(a.ids.length,'本次题数','▤')}</div><div class="note">${self?`还有 ${self-rated} 道主观题待自评，点击下方「查看解析」对照参考答案和评分要点。`:'点击每道题查看解析，回到相关知识点或原课件复习。'}</div><div class="row"><button class="button small" data-action="session-wrong">重练本次错题</button><a class="button small" href="#progress">查看所有复习记录 →</a></div><div class="review-list">${a.ids.map((id,i)=>{const q=questions.get(id),r=a.answers[id],self=!Array.isArray(q.answer),preview=promptPreview(q);return `<div class="review-row"><span class="pill ${r?.grade===true?'green':r?.grade===false?'red':'orange'}">${r?.grade===true?(self?'自评掌握':'正确'):r?.grade===false?'需复习':'待自评'}</span><div class="review-text"><strong>${i+1}. ${escape(preview.slice(0,110))}${preview.length>110?'…':''}</strong><div class="row" style="margin-top:5px">${badge(q)}</div></div><button class="button small" data-action="review-question" data-index="${i}">查看解析 →</button></div>`;}).join('')}</div>`;
  }
  function createFreshAttempt(ex, style) {return {ids:ex.questions.map(q=>q.id),idx:0,answers:{},created:Date.now(),finished:false,style:style==='exam'?'exam':'learn',summarySaved:false};}
  function startExam(examId, style) {
    const ex=exams.get(examId); if(!ex) return;
    const prev=db.examAttempts[ex.id];
    if(prev&&!prev.finished&&Object.keys(prev.answers).length&&!confirm('开始新练习将替换本卷未完成的作答。已评分记录会保留，是否继续？')) return;
    db.examAttempts[ex.id]=createFreshAttempt(ex, style);
    save(); go('#exams?paper='+encodeURIComponent(ex.id)+'&mode=practice');
  }
  function examBrowse(ex) {
    if(lastBrowsePaper!==ex.id){examBrowseExpand=false;lastBrowsePaper=ex.id;}
    const eid=escape(ex.id);
    main.innerHTML=heading(ex.category==='past'?'PAST EXAM PAPER':'MOCK EXAM PAPER',escape(ex.title),escape(ex.subtitle),`<div class="row"><a class="button small" href="#exams">← 全部试卷</a><button class="button small" data-action="exam-toggle-all" data-exam="${eid}">${examBrowseExpand?'收起全部参考答案':'展开全部参考答案'}</button><button class="button small primary" data-action="exam-start" data-exam="${eid}" data-style="learn">逐题练习</button><button class="button small" data-action="exam-start" data-exam="${eid}" data-style="exam">模拟考试</button><button class="button small" data-action="print">打印试卷</button><a class="button small" href="../往年题与模拟卷及参考答案.md" download>↓ Markdown</a></div>`)+
      (ex.sourceNote?`<div class="note">${escape(ex.sourceNote)}</div>`:'')+
      ex.sections.map(sec=>{const qs=ex.questions.filter(q=>q.section===sec.id); return `<div class="exam-section-head"><div><h2>${escape(sec.title)}</h2>${sec.description?`<p class="micro muted" style="margin:4px 0 0">${escape(sec.description)}</p>`:''}</div><span class="pill">${qs.length} 题</span></div><div class="exam-browse-list ${examBrowseExpand?'show-answers':''}">${qs.map(q=>{const self=!Array.isArray(q.answer), rec=db.examRecords[q.id], relTopics=(q.topicIds||[]).filter(id=>topics.has(id)); return `<article class="panel exam-browse-item"><div class="exam-browse-head"><div class="row">${examBadge(ex,q)}</div>${rec?`<span class="pill ${rec.correct?'green':'red'}">${rec.correct?(self?'上次自评：掌握':'上次作答：正确'):'上次作答：需复习'}</span>`:''}</div><div class="article">${md(q.prompt)}</div>${!self?`<div class="browse-options">${q.options.map((text,i)=>`<div class="browse-option ${q.answer.includes(i)?'is-answer':''}"><span class="option-letter">${String.fromCharCode(65+i)}</span><div class="option-text article">${md(text)}</div></div>`).join('')}</div>`:''}<details class="exam-solution" ${examBrowseExpand?'open':''}><summary>查看参考答案与解析 ▾</summary><div class="exam-solution-body">${self?`<div class="article">${md(q.answer)}</div>${q.rubric?.length?`<h4>评分要点</h4><ul class="checklist article">${q.rubric.map(renderRubricItem).join('')}</ul>`:''}`:`<p><strong>正确答案：${q.answer.map(i=>String.fromCharCode(65+i)).join('、')}</strong></p>`}<div class="article">${md(q.explanation)}</div>${relTopics.length?`<div class="row" style="margin-top:12px">${relTopics.map(id=>`<a class="inline-topic" href="${href({lesson:topics.get(id).lesson,topic:id})}">${escape(topics.get(id).title)}</a>`).join('')}</div>`:''}${(q.refs||[]).length?`<div class="source-strip"><div class="row">${sourceButtons(q.refs)}</div></div>`:''}</div></details></article>`;}).join('')}</div>`;}).join('');
  }
  function examQuiz(ex) {
    const a=db.examAttempts[ex.id];
    const eid=escape(ex.id), hrefPaper=encodeURIComponent(ex.id);
    const paletteHtml=ex.sections.map(sec=>{
      const items=[]; for(let i=0;i<a.ids.length;i++){const q=examQuestions.get(a.ids[i]); if(q&&q.section===sec.id) items.push({idx:i,q});}
      if(!items.length) return '';
      return `<div class="palette-group"><div class="palette-title">${escape(sec.title)}</div><div class="question-palette">${items.map(({idx,q})=>{const v=a.answers[q.id]; return `<button title="第${q.number}题" aria-label="跳转第${q.number}题" class="${a.idx===idx?'current':''} ${v?.grade===true?'done':v?.grade===false?'wrong':v?.submitted?'pending':''}" data-action="exam-jump" data-exam="${eid}" data-index="${idx}">${q.number}</button>`;}).join('')}</div></div>`;
    }).join('');
    renderSessionQuiz({
      attempt:a, qMap:examQuestions,
      kicker:a.finished?'EXAM REVIEW':(ex.category==='past'?'PAST EXAM PRACTICE':'MOCK EXAM PRACTICE'),
      title:escape(ex.title)+(a.finished?' · 答案与解析':a.style==='exam'?' · 模拟考试':' · 逐题练习'),
      description:escape(ex.subtitle),
      topActions:`<div class="row"><a class="button small" href="#exams?paper=${hrefPaper}&mode=browse">整卷浏览与答案</a>${a.finished?`<button class="button small" data-action="exam-results" data-exam="${eid}">返回成绩单</button>`:''}<a class="button small" href="#exams">全部试卷</a></div>`,
      badgeFn:q=>examBadge(ex,q), paletteHtml, examId:ex.id,
      actions:{prev:'exam-prev',submit:'exam-submit',edit:'exam-edit',next:'exam-next',finish:'exam-finish',selfGrade:'exam-self-grade',results:'exam-results'}
    });
  }
  function examSubmitAnswer(examId) {const ex=exams.get(examId); if(ex) submitSessionAnswer(db.examAttempts[ex.id], examQuestions, db.examRecords, ()=>examQuiz(ex));}
  function examFinish(examId) {const ex=exams.get(examId); if(ex) finishSession(db.examAttempts[ex.id], examQuestions, db.examRecords, ()=>examResult(ex));}
  function examResult(ex) {
    clearInterval(quizTimer);
    const a=db.examAttempts[ex.id]; if(!a){examBrowse(ex);return;}
    const eid=escape(ex.id), hrefPaper=encodeURIComponent(ex.id);
    const objective=a.ids.filter(id=>Array.isArray(examQuestions.get(id).answer)), count=objective.filter(id=>a.answers[id]?.grade).length, self=a.ids.length-objective.length, rated=a.ids.filter(id=>!Array.isArray(examQuestions.get(id).answer)&&typeof a.answers[id]?.grade==='boolean').length;
    if(!a.summarySaved){db.examSessions.push({examId:ex.id,date:Date.now(),total:a.ids.length,objective:objective.length,correct:count,self,style:a.style});db.examSessions=db.examSessions.slice(-100);a.summarySaved=true;save();}
    main.innerHTML=heading('EXAM COMPLETE',`${escape(ex.title)} · 交卷复盘`,'客观题自动统计正确率，简答与问答题按评分要点自评。',`<a class="button primary small" href="#exams">返回试卷列表 →</a>`)+
      `<div class="stat-grid">${stat(objective.length?Math.round(count/objective.length*100)+'%':'—','客观题正确率','✓')}${stat(count+'/'+objective.length,'客观题正确数','✎')}${stat(rated+'/'+self,'主观题已自评','◷')}${stat(a.ids.length,'本次题数','▤')}</div><div class="note">${self?`还有 ${self-rated} 道主观题待自评，点击下方「查看解析」对照参考答案和评分要点。`:'点击每道题查看解析与评分要点。'}</div><div class="row"><button class="button small" data-action="exam-wrong" data-exam="${eid}">重练本卷错题</button><a class="button small" href="#exams?paper=${hrefPaper}&mode=browse">整卷浏览答案</a><button class="button small" data-action="exam-start" data-exam="${eid}" data-style="${a.style}">重新作答本卷</button><a class="button small" href="#progress">查看复习记录 →</a></div><div class="review-list">${a.ids.map((id,i)=>{const q=examQuestions.get(id),r=a.answers[id],isSelf=!Array.isArray(q.answer),preview=promptPreview(q);return `<div class="review-row"><span class="pill ${r?.grade===true?'green':r?.grade===false?'red':'orange'}">${r?.grade===true?(isSelf?'自评掌握':'正确'):r?.grade===false?'需复习':'待自评'}</span><div class="review-text"><strong>${q.number}. ${escape(preview.slice(0,110))}${preview.length>110?'…':''}</strong><div class="row" style="margin-top:5px">${examBadge(ex,q)}</div></div><button class="button small" data-action="exam-review" data-exam="${eid}" data-index="${i}">查看解析 →</button></div>`;}).join('')}</div>`;
  }
  function examsView(p) {
    const paper=p.get('paper'), mode=p.get('mode')||'browse', cat=p.get('cat')||'all';
    if(paper && exams.has(paper)){
      const ex=exams.get(paper);
      if(mode==='practice'){if(!db.examAttempts[ex.id]){db.examAttempts[ex.id]=createFreshAttempt(ex,'learn');save();} if(db.examAttempts[ex.id].finished) examResult(ex); else examQuiz(ex); return;}
      if(mode==='result'){if(db.examAttempts[ex.id]) examResult(ex); else examBrowse(ex); return;}
      examBrowse(ex); return;
    }
    const pastCount=examsList.filter(e=>e.category==='past').length, mockCount=examsList.filter(e=>e.category==='mock').length;
    const shown=cat==='past'||cat==='mock'?examsList.filter(e=>e.category===cat):examsList;
    main.innerHTML=heading('PAST EXAMS & MOCK PAPERS','往年题与模拟卷','收录 2025 年秋季期末回忆全卷与 3 套对标模拟卷，支持整卷浏览解析、逐题练习与模拟考试。','<a class="button small" href="../往年题与模拟卷及参考答案.md" download>↓ 完整试卷 Markdown</a>')+
      `<div class="exam-tabs"><a class="button small ${cat!=='past'&&cat!=='mock'?'primary':''}" href="#exams">全部 (${examsList.length})</a><a class="button small ${cat==='past'?'primary':''}" href="#exams?cat=past">往年真题 / 回忆 (${pastCount})</a><a class="button small ${cat==='mock'?'primary':''}" href="#exams?cat=mock">模拟卷 (${mockCount})</a></div>`+
      (shown.length?`<div class="exam-grid">${shown.map(ex=>{const st=examStats(ex),att=db.examAttempts[ex.id],inProgress=att&&!att.finished,eid=escape(ex.id),hrefPaper=encodeURIComponent(ex.id);return `<section class="panel exam-card"><div><div class="row between" style="margin-bottom:10px"><div class="row"><span class="pill ${ex.category==='past'?'orange':''}">${escape(ex.tag)}</span><span class="pill">${escape(ex.year)}</span><span class="pill">${ex.questions.length} 题</span></div>${inProgress?'<span class="pill green">进行中</span>':''}</div><h3>${escape(ex.title)}</h3><p style="margin-top:8px">${escape(ex.subtitle)}</p><p class="micro muted" style="margin-top:10px">${ex.sections.map(s=>`${escape(s.title)} ${ex.questions.filter(q=>q.section===s.id).length} 题`).join(' · ')} · 建议 ${ex.durationMinutes} 分钟<br>已作答 ${st.answered} / ${st.total} 题${st.answered?`（已掌握 ${st.correct} · 需复习 ${st.wrong}）`:''}</p></div><div class="row"><a class="button small primary" href="#exams?paper=${hrefPaper}&mode=browse">浏览试卷与答案</a><button class="button small" data-action="exam-start" data-exam="${eid}" data-style="learn">逐题练习</button><button class="button small" data-action="exam-start" data-exam="${eid}" data-style="exam">模拟考试</button>${inProgress?`<a class="button small accent" href="#exams?paper=${hrefPaper}&mode=practice">继续上次作答 →</a>`:att&&att.finished?`<a class="button small" href="#exams?paper=${hrefPaper}&mode=result">上次成绩</a>`:''}</div></section>`;}).join('')}</div>`:'<div class="empty"><h3>暂无匹配试卷</h3><p>切换分类标签查看全部往年题与模拟卷。</p><a class="button small" href="#exams">查看全部试卷</a></div>');
  }
  const kindName={content:'知识内容',review:'回顾',divider:'章节页',exercise:'示例 / 练习',admin:'课程信息'};
  function sourcesView(p) {main.innerHTML=heading('SOURCE INDEX','课件页码索引','逐页映射知识点。章节页、课程说明与教学内容分别标注；页码均为 PDF 的物理页。')+'<div class="note">点击页码打开原 PDF，点击对应知识点返回整理正文。浏览器若未直接跳页，请在 PDF 阅读器页码框中输入标注页数。</div>'+D.lessons.map(l=>`<details class="panel lesson-source" ${p.get('lesson')===String(l.lesson)?'open':''}><summary><div><h3>第 ${l.lesson} 课 · ${escape(l.title)}</h3><p>${escape(l.file)} · ${l.pages} 页 · ${D.topics.filter(t=>t.lesson===l.lesson).length} 个知识点</p></div><span>＋</span></summary><div class="source-pages"><table class="page-table"><thead><tr><th>PDF 页</th><th>页内容</th><th>分类</th><th>关联知识点</th></tr></thead><tbody>${l.pageMap.map(pg=>`<tr><td><button class="source-button" data-action="source" data-lesson="${l.lesson}" data-pages="${pg.page}">P${String(pg.page).padStart(3,'0')} ↗</button></td><td>${escape(pg.label)}</td><td><span class="pill">${kindName[pg.kind]||'知识内容'}</span></td><td>${pg.topicIds.length?pg.topicIds.map(id=>`<a class="inline-topic" href="${href({lesson:topics.get(id).lesson,topic:id})}">${escape(topics.get(id).title)}</a>`).join(''):'<span class="muted">无需独立知识点</span>'}</td></tr>`).join('')}</tbody></table></div></details>`).join('');}
  function progressView() {const s=stats();main.innerHTML=heading('PERSONAL WORKSPACE','我的复习记录','以最近一次已评分作答判断错题；收藏与掌握标记可随时调整。',`<div class="row"><button class="button small" data-action="export">导出备份</button><button class="button small" data-action="import">导入备份</button><input id="import-file" type="file" accept="application/json,.json" hidden></div>`)+
    `<div class="stat-grid">${stat(s.answered,'已练习题目','✎')}${stat(s.wrong,'当前错题','↺')}${stat(s.answered?Math.round(s.correct/s.answered*100)+'%':'—','最近作答掌握率（含自评）','✓')}${stat(db.bookmarks.length,'收藏知识点','☆')}</div><div class="info-grid"><section class="panel"><h3>各课掌握进度</h3>${D.lessons.map(l=>{const all=D.topics.filter(t=>t.lesson===l.lesson),n=all.filter(t=>db.mastered.includes(t.id)).length;return `<a class="progress-lesson" href="${href({lesson:l.lesson})}"><span>第 ${l.lesson} 课</span><div class="progress-bar"><i style="width:${n/all.length*100}%"></i></div><span class="micro muted">${n}/${all.length}</span></a>`;}).join('')}<p class="micro muted">这里的进度来自知识点页上的「标记掌握」，用于安排复习范围。</p></section><section class="panel"><h3>下一步复习</h3><p class="micro muted">当前错题包含客观题答错和主观题自评未掌握。再次作答并掌握后，该题会自动移出错题集。</p><div class="row"><a class="button small primary" href="#practice?pool=wrong">重练错题 ${s.wrong} →</a><a class="button small" href="#practice?pool=new">练习未做题</a><a class="button small" href="${href({saved:'1'})}">收藏知识点</a></div><div class="note" style="margin-top:22px">记录保存在浏览器本地，不同浏览器和不同访问地址的记录互不共享。导出 JSON 可迁移或备份；导入会替换当前记录。</div><button class="button small danger" data-action="reset">清空学习记录</button></section></div><div class="section-top"><h2>最近练习</h2><p>最多保存最近 100 次已交卷练习</p></div>${db.sessions.length?`<div class="panel" style="overflow:auto"><table class="page-table"><thead><tr><th>交卷时间</th><th>方式</th><th>题数</th><th>客观题正确</th><th>主观题</th></tr></thead><tbody>${[...db.sessions].reverse().slice(0,20).map(s=>`<tr><td>${escape(new Date(s.date).toLocaleString('zh-CN'))}</td><td>${s.style==='exam'?'模拟组卷':'逐题练习'}</td><td>${s.total}</td><td>${s.correct} / ${s.objective}</td><td>${s.self} 题（自评分另计）</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><h3>还没有已交卷练习</h3><p>完成一套练习后，你的记录会显示在这里。</p><a class="button small primary" href="#practice">开始第一套练习 →</a></div>'}${examsList.length?`<div class="section-top"><h2>套卷进度与记录</h2><a class="micro muted" href="#exams">进入往年题与模拟卷 →</a></div><div class="panel" style="overflow:auto"><table class="page-table"><thead><tr><th>试卷</th><th>类别</th><th>已作答</th><th>已掌握 / 需复习</th><th>操作</th></tr></thead><tbody>${examsList.map(ex=>{const st=examStats(ex),hrefPaper=encodeURIComponent(ex.id);return `<tr><td>${escape(ex.title)}</td><td><span class="pill ${ex.category==='past'?'orange':''}">${escape(ex.tag)}</span></td><td>${st.answered} / ${st.total}</td><td>${st.answered?`${st.correct} / ${st.wrong}`:'—'}</td><td><a class="inline-topic" href="#exams?paper=${hrefPaper}&mode=browse">浏览</a><a class="inline-topic" href="#exams?paper=${hrefPaper}&mode=practice">练习</a></td></tr>`;}).join('')}</tbody></table></div>${db.examSessions.length?`<div class="panel" style="overflow:auto;margin-top:16px"><table class="page-table"><thead><tr><th>交卷时间</th><th>试卷</th><th>模式</th><th>题数</th><th>客观题正确</th><th>主观题</th></tr></thead><tbody>${[...db.examSessions].reverse().slice(0,20).map(es=>{const ex=exams.get(es.examId);return `<tr><td>${escape(new Date(es.date).toLocaleString('zh-CN'))}</td><td>${escape(ex?ex.title:es.examId)}</td><td>${es.style==='exam'?'模拟考试':'逐题练习'}</td><td>${es.total}</td><td>${es.correct} / ${es.objective}</td><td>${es.self} 题（自评分另计）</td></tr>`;}).join('')}</tbody></table></div>`:''}`:''}`;
    document.querySelector('#import-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>10*1024*1024)throw Error('备份文件过大');const value=JSON.parse(await file.text());if(value.version!==1||!Array.isArray(value.mastered)||!Array.isArray(value.bookmarks)||!value.records)throw Error('不是有效的复习记录备份');const imported=sanitize(value);if(!confirm('导入会替换当前学习记录。建议先导出备份，是否继续导入？'))return;db=imported;save();render();toast('学习记录已导入。');}catch(err){toast('导入失败：'+err.message);}e.target.value='';});
  }
  function pdfUrl(lesson,page) {return '../课件/'+encodeURIComponent(lessons.get(lesson).file)+'#page='+page;}
  function openSource(lesson,pages) {const l=lessons.get(lesson);if(!l)return;pages=[...new Set(pages)].filter(p=>Number.isInteger(p)&&p>0&&p<=l.pages).sort((a,b)=>a-b);if(!pages.length)return;drawerReturn=document.activeElement;drawerRef={lesson,pages,current:pages[0]};const drawer=document.querySelector('#source-drawer');drawer.innerHTML=`<div class="drawer-head"><div><div class="eyebrow">ORIGINAL SLIDES</div><h2 id="source-title">第 ${lesson} 课 · 课件出处</h2><p class="micro muted">${escape(l.file)}<br>本知识点对应 PDF 第 ${formatPages(pages)} 页 / 共 ${l.pages} 页</p></div><button class="close-button" aria-label="关闭课件出处" data-action="close-source">×</button></div><div class="page-buttons">${pages.map(p=>`<button class="${p===pages[0]?'active':''}" data-action="source-page" data-page="${p}">第 ${p} 页</button>`).join('')}</div><div class="row between"><span class="micro muted" id="source-current">正在定位：PDF 第 ${pages[0]} 页</span><a class="button primary small" id="pdf-new-tab" href="${pdfUrl(lesson,pages[0])}" target="_blank" rel="noopener">在新标签打开 PDF ↗</a></div><p class="micro muted" style="margin:14px 0 0">内嵌阅读器取决于浏览器。若预览空白或未跳页，请打开 PDF 并输入上方物理页码。</p><iframe class="pdf-frame" title="第${lesson}课原课件预览" src="${pdfUrl(lesson,pages[0])}"></iframe>`;drawer.hidden=false;document.querySelector('#source-backdrop').hidden=false;document.body.classList.add('drawer-open');drawer.querySelector('.close-button').focus();}
  function closeSource() {document.querySelector('#source-drawer').hidden=true;document.querySelector('#source-drawer').innerHTML='';document.querySelector('#source-backdrop').hidden=true;document.body.classList.remove('drawer-open');drawerRef=null;drawerReturn?.focus();}
  function sourcePage(page) {if(!drawerRef)return;drawerRef.current=page;const drawer=document.querySelector('#source-drawer'),url=pdfUrl(drawerRef.lesson,page);document.querySelector('#pdf-new-tab').href=url;document.querySelector('#source-current').textContent=`正在定位：PDF 第 ${page} 页`;const old=drawer.querySelector('iframe'), frame=old.cloneNode(false);frame.src=url;old.replaceWith(frame);drawer.querySelectorAll('[data-action="source-page"]').forEach(b=>b.classList.toggle('active',Number(b.dataset.page)===page));}
  function toggle(field,id) {if(!topics.has(id))return;const i=db[field].indexOf(id);if(i>=0)db[field].splice(i,1);else db[field].push(id);save();render();toast(field==='mastered'?(i>=0?'已取消掌握标记。':'已标记掌握。'):(i>=0?'已取消收藏。':'知识点已收藏。'));}
  function exportData() {const blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='C语言系统级编程-学习记录-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
  document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b||b.disabled)return;const action=b.dataset.action,a=db.active;switch(action){
    case 'source':openSource(Number(b.dataset.lesson),b.dataset.pages.split(',').map(Number));break;
    case 'close-source':closeSource();break;
    case 'source-page':sourcePage(Number(b.dataset.page));break;
    case 'bookmark':toggle('bookmarks',b.dataset.id);break;
    case 'master':toggle('mastered',b.dataset.id);break;
    case 'print':window.print();break;
    case 'resume':go('#practice');break;
    case 'setup':go('#practice?setup=1');break;
    case 'submit-answer':submitAnswer();break;
    case 'edit-answer':answerFor(a.ids[a.idx]).submitted=false;save();quiz();break;
    case 'quiz-prev':a.idx=Math.max(0,a.idx-1);save();quiz();break;
    case 'quiz-next':{if(!a.finished)autoSubmitSessionAnswer(a,questions,db.records,a.idx+1);a.idx=Math.min(a.ids.length-1,a.idx+1);save();quiz();break;}
    case 'quiz-jump':a.idx=Number(b.dataset.index);save();quiz();break;
    case 'review-question':a.idx=Number(b.dataset.index);save();quiz(true);break;
    case 'results':result();break;
    case 'self-grade':{const q=questions.get(a.ids[a.idx]),r=answerFor(q.id);r.grade=b.dataset.grade==='yes';record(q,r);save();quiz();break;}
    case 'finish':finish();break;
    case 'session-wrong':{const ids=a.ids.filter(id=>a.answers[id]?.grade===false);if(!ids.length){toast('本次没有已评分的错题。');break;}db.active={ids,idx:0,answers:{},created:Date.now(),finished:false,style:'learn',summarySaved:false};save();quiz();break;}
    case 'exam-start':startExam(b.dataset.exam,b.dataset.style);break;
    case 'exam-toggle-all':{const ex=exams.get(b.dataset.exam);if(!ex)break;examBrowseExpand=!examBrowseExpand;examBrowse(ex);break;}
    case 'exam-submit':examSubmitAnswer(b.dataset.exam);break;
    case 'exam-edit':{const ex=exams.get(b.dataset.exam),ea=ex&&db.examAttempts[ex.id];if(!ea)break;answerIn(ea,ea.ids[ea.idx]).submitted=false;save();examQuiz(ex);break;}
    case 'exam-prev':{const ex=exams.get(b.dataset.exam),ea=ex&&db.examAttempts[ex.id];if(!ea)break;ea.idx=Math.max(0,ea.idx-1);save();examQuiz(ex);break;}
    case 'exam-next':{const ex=exams.get(b.dataset.exam),ea=ex&&db.examAttempts[ex.id];if(!ea)break;if(!ea.finished){const curQ=examQuestions.get(ea.ids[ea.idx]);autoSubmitSessionAnswer(ea,examQuestions,db.examRecords,curQ?curQ.number:ea.idx+1);}ea.idx=Math.min(ea.ids.length-1,ea.idx+1);save();examQuiz(ex);break;}
    case 'exam-jump':case 'exam-review':{const ex=exams.get(b.dataset.exam),ea=ex&&db.examAttempts[ex.id];if(!ea)break;ea.idx=Math.min(Math.max(Number(b.dataset.index)||0,0),ea.ids.length-1);save();examQuiz(ex);break;}
    case 'exam-results':{const ex=exams.get(b.dataset.exam);if(ex)examResult(ex);break;}
    case 'exam-self-grade':{const ex=exams.get(b.dataset.exam),ea=ex&&db.examAttempts[ex.id];if(!ea)break;const q=examQuestions.get(ea.ids[ea.idx]),r=answerIn(ea,q.id);r.grade=b.dataset.grade==='yes';recordTo(db.examRecords,q,r);save();examQuiz(ex);break;}
    case 'exam-finish':examFinish(b.dataset.exam);break;
    case 'exam-wrong':{const ex=exams.get(b.dataset.exam),ea=ex&&db.examAttempts[ex.id];if(!ea)break;const ids=ea.ids.filter(id=>ea.answers[id]?.grade===false);if(!ids.length){toast('本次没有已评分的错题。');break;}db.examAttempts[ex.id]={ids,idx:0,answers:{},created:Date.now(),finished:false,style:'learn',summarySaved:false};save();examQuiz(ex);break;}
    case 'export':exportData();break;
    case 'import':document.querySelector('#import-file').click();break;
    case 'reset':if(confirm('将清空收藏、掌握标记和答题记录。此操作无法撤回，是否继续？')){db=fresh();save();render();toast('学习记录已清空。');}break;
  }});
  document.querySelector('#source-backdrop').addEventListener('click',closeSource);
  document.addEventListener('keydown',e=>{if(document.querySelector('#source-drawer').hidden)return;if(e.key==='Escape'){closeSource();return;}if(e.key==='Tab'){const focusable=[...document.querySelector('#source-drawer').querySelectorAll('button,a,iframe')],first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
  document.querySelector('#menu-toggle').addEventListener('click',e=>{const open=document.querySelector('.sidebar').classList.toggle('open');e.currentTarget.setAttribute('aria-expanded',String(open));});
  function render() {clearInterval(quizTimer);const {view,p}=route(), names={overview:'复习总览',knowledge:'知识点手册',practice:'练习与组卷',exams:'往年题与模拟卷',sources:'课件页码索引',progress:'我的复习记录'};document.querySelector('#view-name').textContent=names[view];document.title=names[view]+' · C语言系统级编程';document.querySelectorAll('#navigation a').forEach(a=>{a.classList.toggle('active',a.dataset.view===view);if(a.dataset.view===view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});document.querySelector('.sidebar').classList.remove('open');document.querySelector('#menu-toggle').setAttribute('aria-expanded','false');if(view==='knowledge')knowledge(p);else if(view==='practice')practice(p);else if(view==='exams')examsView(p);else if(view==='sources')sourcesView(p);else if(view==='progress')progressView();else overview();}
  window.addEventListener('hashchange',()=>{closeSource();render();window.scrollTo({top:0,behavior:'instant'});});
  render();
})();
