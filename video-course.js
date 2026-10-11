(() => {
  'use strict';
  const KEY='kanaTrainerVideoCourseV1',lessons=window.KANA_VIDEO_COURSE || [],MIN=60000,DAY=86400000,intervals=[10*MIN,60*MIN,DAY,3*DAY,7*DAY,14*DAY,30*DAY,90*DAY,180*DAY,365*DAY];
  let host,ui,progress={},selected=lessons[0]?.id,active=false,session=null,screen='map',token=0,videoURL=null,wake=0,mediaRevision=0,rememberVideo=null;
  const files=new Map(),escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const record=p=>p!==null && typeof p==='object' && !Array.isArray(p);
  const empty=()=>({watchedAt:0,position:0,completedAt:0,questions:{}});
  function validateProgress(data){
    if(!record(data))throw new Error('Повреждён прогресс видеокурса.');const clean={};
    const num=(v,max=1e9,int=false)=>{if(!Number.isFinite(v) || v<0 || v>max || int && !Number.isInteger(v))throw new Error('Некорректные числа в прогрессе видеокурса.');return v};
    for(const [id,p] of Object.entries(data)){
      const l=lessons.find(x=>x.id===id);if(!l)continue;if(!record(p) || !record(p.questions))throw new Error('Повреждены данные урока видеокурса.');
      const next={watchedAt:num(p.watchedAt??0,Date.UTC(2200,0,1)),position:num(p.position??0,l.seconds+1),completedAt:num(p.completedAt??0,Date.UTC(2200,0,1)),questions:{}};
      for(const [key,q] of Object.entries(p.questions)){
        if(!l.questions.some(x=>x.id===key) || !record(q))throw new Error('Неизвестное задание видеокурса.');
        const n={};for(const field of ['seen','correct','wrong','hinted','streak'])n[field]=num(q[field]??0,1e9,true);
        if(n.correct+n.wrong+n.hinted!==n.seen || n.streak>n.correct)throw new Error('Счётчики видеокурса не совпадают.');
        for(const field of ['dueAt','lastAt'])n[field]=num(q[field]??0,Date.UTC(2200,0,1));next.questions[key]=n;
      }
      clean[id]=next;
    }
    if(Object.keys(data).length && !Object.keys(clean).length)throw new Error('Не найдены знакомые уроки видеокурса.');return clean;
  }
  function message(text,error=false){if(ui){ui.message.textContent=text;ui.message.classList.toggle('is-error',error)}}
  function save(next){try{localStorage.setItem(KEY,JSON.stringify(next));progress=next;return true}catch(e){message('Не удалось сохранить видеокурс. Ответ не записан; освободите место в браузере.',true);return false}}
  function load(){try{progress=validateProgress(JSON.parse(localStorage.getItem(KEY)||'{}'))}catch(e){progress={};message('Сохранённый видеокурс не удалось прочитать. Файл в браузере не удалён.',true)}}
  function stats(p){return Object.values(p?.questions||{}).reduce((s,q)=>({seen:s.seen+q.seen,correct:s.correct+q.correct,wrong:s.wrong+q.wrong,hinted:s.hinted+q.hinted}),{seen:0,correct:0,wrong:0,hinted:0})}
  function accuracy(p){const s=stats(p);return !s.seen ? '<span class="grammar-accuracy-title">Точность · пока нет данных</span>' : `<span class="grammar-accuracy"><span class="grammar-accuracy-title">Верно ${Math.round(s.correct/s.seen*100)}% · Ошибки ${Math.round(s.wrong/s.seen*100)}%${s.hinted ? ` · С подсказкой ${Math.round(s.hinted/s.seen*100)}%` : ''}</span><span class="grammar-accuracy-bar" role="img" aria-label="${s.correct} верно, ${s.wrong} ошибок, ${s.hinted} с подсказкой из ${s.seen} ответов"><i class="is-correct" style="width:${s.correct/s.seen*100}%"></i><i class="is-wrong" style="width:${s.wrong/s.seen*100}%"></i><i class="is-hinted" style="width:${s.hinted/s.seen*100}%"></i></span><small>${s.seen} ответов</small></span>`}
  function due(now=Date.now()){return lessons.flatMap(l=>l.questions.filter(q=>progress[l.id]?.questions[q.id]?.seen && progress[l.id].questions[q.id].dueAt<=now).map(q=>({lessonId:l.id,questionId:q.id}))).sort((a,b)=>progress[a.lessonId].questions[a.questionId].dueAt-progress[b.lessonId].questions[b.questionId].dueAt)}
  function duration(ms){return ms<60*MIN ? `${Math.max(1,Math.ceil(ms/MIN))} мин` : ms<DAY ? `${Math.ceil(ms/(60*MIN))} ч` : `${Math.ceil(ms/DAY)} дн`}
  function renderMetrics(){
    const values=Object.values(progress),s=values.reduce((a,p)=>{const b=stats(p);return {seen:a.seen+b.seen,correct:a.correct+b.correct}}, {seen:0,correct:0});
    const metrics=[[values.filter(p=>p.completedAt).length+'/'+lessons.length,'Уроков пройдено'],[values.filter(p=>p.watchedAt).length,'Видео просмотрено'],[due().length,'Заданий к повторению'],[s.seen?Math.round(s.correct/s.seen*100)+'%':'—','Верно без подсказок']];
    ui.metrics.innerHTML=metrics.map(([n,t])=>`<div class="grammar-metric"><strong>${n}</strong><span>${t}</span></div>`).join('');ui.review.textContent=`Повторить · ${due().length}`;
  }
  function renderMap(){
    const dueIds=new Set(due().map(q=>q.lessonId));
    ui.map.innerHTML=lessons.map(l=>{const p=progress[l.id],solved=Object.values(p?.questions||{}).filter(q=>q.correct>0).length;
      return `<button type="button" class="course-card ${p?.completedAt?'is-completed':''} ${dueIds.has(l.id)?'is-due':''}" data-course-lesson="${l.id}"><span>${l.number ? 'Урок '+l.number : 'Дополнительно'} · ${Math.ceil(l.seconds/60)} мин</span><strong>${escape(l.title)}</strong><span>${escape(l.subtitle)}</span><span class="course-status">${p?.completedAt?'✓ Урок пройден':'Урок ещё не пройден'}${dueIds.has(l.id)?' · Пора повторить':''}</span><span class="grammar-map-progress" role="progressbar" aria-label="Задания решены самостоятельно" aria-valuemin="0" aria-valuemax="${l.questions.length}" aria-valuenow="${solved}"><i style="width:${solved/l.questions.length*100}%"></i></span><span>Закреплено ${solved}/${l.questions.length}${p?.watchedAt?' · Видео просмотрено':''}</span>${accuracy(p)}</button>`}).join('');
    ui.map.querySelectorAll('[data-course-lesson]').forEach(b=>b.addEventListener('click',()=>openLesson(b.dataset.courseLesson)));
  }
  function stop(){token++;host?.cancelSpeech();clearTimeout(wake);rememberVideo?.();const video=ui?.lesson.querySelector('video');if(video && !video.paused)video.pause()}
  function releaseVideo(){if(videoURL){URL.revokeObjectURL(videoURL);videoURL=null}}
  function show(screenName){stop();mediaRevision++;rememberVideo=null;releaseVideo();screen=screenName;ui.map.hidden=screen!=='map';ui.lesson.hidden=screen!=='lesson';ui.practice.hidden=screen!=='practice';renderMetrics();if(screen==='map')renderMap()}
  function openMap(update=true){session=null;show('map');if(update)window.history.pushState(null,'','#course');}
  function openLesson(id,update=true){
    const l=lessons.find(x=>x.id===id);if(!l)return;session=null;show('lesson');selected=id;const p=progress[id],revision=mediaRevision;
    const videoFile=files.get(id),source=videoFile ? URL.createObjectURL(videoFile) : location.protocol==='file:' ? 'Video/'+encodeURIComponent(l.file) : null;videoURL=videoFile?source:null;
    ui.lesson.innerHTML=`<p class="grammar-eyebrow">${l.number?'Урок '+l.number:'Дополнительный урок'} · ${Math.ceil(l.seconds/60)} минут</p><h3>${escape(l.title)}</h3><div class="course-player">${source?`<video controls preload="metadata" playsinline src="${escape(source)}" aria-label="Видео ${escape(l.title)}"></video>`:`<div class="course-player-placeholder"><span class="grammar-hero-mark" aria-hidden="true">映</span><p>Подключите папку Video, чтобы смотреть этот урок. Сам файл никуда не загружается. Краткое объяснение и задания ниже работают без видео.</p><button class="grammar-secondary" id="courseChooseVideo" type="button">Выбрать папку с видео</button></div>`}<div class="course-player-meta"><span class="grammar-note">EasyTravel · ${p?.watchedAt?'✓ Просмотрено':'Не отмечено просмотренным'}</span><button class="grammar-secondary" id="courseWatched" type="button" ${p?.watchedAt?'disabled':''}>Я посмотрел(а) видео</button></div></div><h4 class="course-section-title">Коротко о главном</h4><div class="course-notes">${l.notes.map(n=>`<article class="course-note"><h4>${escape(n.title)}</h4><p>${escape(n.text)}</p>${n.form?`<p><code lang="ja">${escape(n.form)}</code></p>`:''}</article>`).join('')}</div><h4 class="course-section-title">Примеры · ${l.examples.length}</h4><div class="grammar-examples">${l.examples.map((e,i)=>`<div class="grammar-example"><div><strong lang="ja">${escape(e.jp)}</strong><small>${escape(e.ru)}</small></div><button type="button" class="grammar-speak" data-course-example="${i}" aria-label="Озвучить пример ${i+1}">♪</button></div>`).join('')}</div><section class="grammar-answer-statistics"><h4>Результаты по теме</h4>${accuracy(p)}</section><div class="course-actions"><button class="btn" id="courseStart" type="button">Заниматься</button><button class="grammar-secondary" id="courseBack" type="button">К карте курса</button></div><p class="grammar-note">Задания — самостоятельная практика по темам видео. Следующий урок возвращает часть ранее пройденного. В заданиях названия правил скрыты; подсказка учитывается отдельно.</p>`;
    if(update)window.history.pushState(null,'',`#course/lesson/${id}`);
    ui.lesson.querySelector('#courseChooseVideo')?.addEventListener('click',()=>ui.folder.click());ui.lesson.querySelector('#courseBack').addEventListener('click',()=>openMap());ui.lesson.querySelector('#courseStart').addEventListener('click',()=>begin(false));
    ui.lesson.querySelectorAll('[data-course-example]').forEach(b=>b.addEventListener('click',()=>{stop();host.speak(l.examples[Number(b.dataset.courseExample)].jp,true)}));
    const watched=()=>{if(revision!==mediaRevision || !save({...progress,[id]:{...empty(),...progress[id],watchedAt:Date.now()}}))return;ui.lesson.querySelector('#courseWatched').disabled=true;ui.lesson.querySelector('.course-player-meta span').textContent='EasyTravel · ✓ Просмотрено';renderMetrics()};
    ui.lesson.querySelector('#courseWatched').addEventListener('click',watched);
    const video=ui.lesson.querySelector('video');if(video){
      video.addEventListener('loadedmetadata',()=>{if(revision===mediaRevision && p?.position && p.position<video.duration-2)video.currentTime=p.position});
      const remember=()=>{if(revision===mediaRevision && video.readyState>=1 && Number.isFinite(video.currentTime))save({...progress,[id]:{...empty(),...progress[id],position:Math.min(l.seconds,video.currentTime)}})};rememberVideo=remember;
      let savedPosition=p?.position || 0;
      video.addEventListener('timeupdate',()=>{if(Math.abs(video.currentTime-savedPosition)>=5){remember();savedPosition=video.currentTime}});
      video.addEventListener('pause',remember);video.addEventListener('seeked',remember);video.addEventListener('ended',watched);
      video.addEventListener('error',()=>message('Не удалось открыть видео. Подключите папку Video кнопкой выше.',true));
    }
  }
  function plan(id){
    const l=lessons.find(x=>x.id===id),previous=lessons.slice(0,lessons.indexOf(l)).filter(x=>progress[x.id]?.completedAt),latest=previous.at(-1);
    const weaker=previous.filter(x=>x!==latest).sort((a,b)=>{const sa=stats(progress[a.id]),sb=stats(progress[b.id]);return (sb.wrong+sb.hinted)/Math.max(1,sb.seen)-(sa.wrong+sa.hinted)/Math.max(1,sa.seen) || progress[a.id].completedAt-progress[b.id].completedAt})[0];
    const prior=[latest,weaker].filter(Boolean),queue=l.questions.map(q=>({lessonId:id,questionId:q.id}));
    prior.forEach((old,i)=>{const questions=[...old.questions].sort((a,b)=>{const sa=progress[old.id].questions[a.id],sb=progress[old.id].questions[b.id];return ((sb?.wrong||0)+(sb?.hinted||0))/Math.max(1,sb?.seen||0)-((sa?.wrong||0)+(sa?.hinted||0))/Math.max(1,sa?.seen||0) || (sa?.lastAt||0)-(sb?.lastAt||0)});queue.splice(Math.min(queue.length,3+i*3),0,{lessonId:old.id,questionId:questions[0].id})});return queue;
  }
  function begin(review){const queue=review?due():plan(selected);show('practice');session={review,owner:selected,queue,current:null,locked:false,hint:false,composing:false,answered:0,correct:0};nextQuestion()}
  function speech(q,revealed){if(q.type==='fill')return revealed?[q.before+q.answers[0]+q.after]:[q.before,q.after];return q.jp?[q.jp]:[]}
  async function speak(q){stop();const n=token,current=session?.current;for(const part of speech(q,session.locked)){if(!active || token!==n || session?.current!==current)return;if(/[\p{L}\p{N}]/u.test(part))await host.speak(part,true)}}
  function nextQuestion(){
    stop();if(!session)return;session.current=session.queue.shift();session.locked=false;session.hint=false;session.composing=false;if(!session.current){finish();return}
    const l=lessons.find(x=>x.id===session.current.lessonId),q=l.questions.find(x=>x.id===session.current.questionId);ui.practice.dataset.lessonId=l.id;ui.practice.dataset.questionId=q.id;
    const options=(q.options||[]).map((text,i)=>({text,i}));for(let i=options.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[options[i],options[j]]=[options[j],options[i]]}
    ui.practice.innerHTML=`<div class="grammar-practice-head"><div><p class="grammar-eyebrow">Видеокурс · ${session.review?'Повторение':'Практика'}</p><h3>Проверка памяти</h3></div><span class="grammar-counter">Осталось ${session.queue.length+1}</span></div><p class="grammar-note">${escape(q.type==='fill'?'Заполните пропуск по переводу.':q.prompt)}</p>${q.type==='fill'?`<p class="grammar-sentence" lang="ja">${escape(q.before)}<span class="grammar-blank">…</span>${escape(q.after)}</p><p class="grammar-translation">${escape(q.translation)}</p><div class="grammar-sentence-audio"><button class="grammar-secondary" id="courseSpeak" type="button">♪ Озвучить предложение</button><span class="grammar-note">До проверки пропуск не озвучивается.</span></div><form class="grammar-answer-form"><input id="courseAnswer" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Ответ" placeholder="Японская запись или ромадзи…"><button class="btn" type="submit">Проверить</button></form>`:`${q.jp?`<p class="grammar-sentence" lang="ja">${escape(q.jp)}</p><button class="grammar-secondary" id="courseSpeak" type="button">♪ Озвучить</button>`:''}<div class="grammar-choice-list">${options.map(o=>`<button class="grammar-choice" type="button" data-course-option="${o.i}">${escape(o.text)}</button>`).join('')}</div>`}<details class="grammar-hint"><summary>Подсказка</summary><p>${escape(q.explanation)}</p></details><div class="grammar-feedback" hidden role="status" aria-live="polite"></div><button class="grammar-secondary" id="courseExit" type="button">К уроку</button>`;
    const speakButton=ui.practice.querySelector('#courseSpeak');
    if(q.speechHint && speakButton)speakButton.textContent='♪ Озвучить чтение (подсказка)';
    speakButton?.addEventListener('click',()=>{if(q.speechHint && !session.locked)session.hint=true;speak(q).catch(()=>message('Не удалось озвучить предложение.',true))});
    ui.practice.querySelector('details').addEventListener('toggle',e=>{if(e.target.open && session)session.hint=true});ui.practice.querySelector('#courseExit').addEventListener('click',()=>openLesson(selected));
    const input=ui.practice.querySelector('input');if(input){if(active)input.focus({preventScroll:true});input.addEventListener('compositionstart',()=>session.composing=true);input.addEventListener('compositionend',()=>session.composing=false);input.addEventListener('keydown',e=>{if(e.key==='Enter' && (e.isComposing || e.keyCode===229))e.preventDefault()});ui.practice.querySelector('form').addEventListener('submit',e=>{e.preventDefault();if(input.value.trim())answer(l,q,window.KanaGrammar.testing.isAnswerCorrect(input.value,q.answers))})}
    else ui.practice.querySelectorAll('[data-course-option]').forEach(b=>b.addEventListener('click',()=>answer(l,q,Number(b.dataset.courseOption)===q.correctIndex,Number(b.dataset.courseOption))));
  }
  function answer(l,q,ok,choice){
    if(!session || session.locked || session.composing)return;
    const now=Date.now(),p={...empty(),...progress[l.id]},old=p.questions[q.id]||{seen:0,correct:0,wrong:0,hinted:0,streak:0,dueAt:0,lastAt:0},hint=session.hint || ui.practice.querySelector('details').open;
    const streak=ok && !hint?old.streak+1:0;
    const next={...old,seen:old.seen+1,correct:old.correct+Number(ok && !hint),wrong:old.wrong+Number(!ok),hinted:old.hinted+Number(ok && hint),streak,lastAt:now,dueAt:now+(ok?intervals[Math.min(intervals.length-1,Math.max(0,streak-1))]:MIN)};
    const updated={...progress,[l.id]:{...p,questions:{...p.questions,[q.id]:next}}};
    if(ok && !session.queue.length && !session.review)updated[session.owner]={...updated[session.owner],completedAt:now};
    if(!save(updated))return;session.locked=true;session.answered++;session.correct+=Number(ok && !hint);if(!ok)session.queue.splice(Math.min(2,session.queue.length),0,session.current);
    ui.practice.querySelectorAll('input,button[type=submit],[data-course-option]').forEach(b=>b.disabled=true);
    const blank=ui.practice.querySelector('.grammar-blank');if(blank){blank.textContent=q.answers[0];blank.classList.toggle('is-correct',ok)}
    ui.practice.querySelectorAll('[data-course-option]').forEach(b=>{b.classList.toggle('is-correct',Number(b.dataset.courseOption)===q.correctIndex);b.classList.toggle('is-wrong',!ok && Number(b.dataset.courseOption)===choice)});
    const feedback=ui.practice.querySelector('.grammar-feedback');feedback.hidden=false;feedback.classList.toggle('is-wrong',!ok);feedback.innerHTML=`<strong>${ok?hint?'Верно с подсказкой':'Верно!':'Правильный ответ: '+escape(q.type==='fill'?q.answers[0]:q.options[q.correctIndex])}</strong><p>${escape(q.explanation)}</p><p>${ok?'Повтор через '+duration(next.dueAt-now):'Задание вернётся после других вопросов.'}</p><button class="btn course-next" id="courseNext" type="button">Дальше →</button>`;
    feedback.querySelector('button').addEventListener('click',nextQuestion);feedback.querySelector('button').focus({preventScroll:true});stop();renderMetrics();const n=token;
    if(host.soundEnabled())Promise.resolve(host.tone(ok)).then(()=>{if(active && n===token && speech(q,true).length)return host.speak(speech(q,true)[0],false)}).catch(()=>{});
  }
  function finish(){
    renderMetrics();const l=lessons.find(x=>x.id===session.owner),next=lessons[lessons.indexOf(l)+1],future=Object.values(progress).flatMap(p=>Object.values(p.questions).map(q=>q.dueAt)).filter(t=>t>Date.now()),nextAt=future.length?Math.min(...future):null;
    ui.practice.innerHTML=`<div class="course-session-finish"><span class="grammar-hero-mark" aria-hidden="true">${session.review?'休':'学'}</span><h3>${session.review?'Доступные повторения завершены':'Урок пройден'}</h3><p>${session.answered} ответов · ${session.correct} верно без подсказок.${session.review && nextAt?'<br>Приходите через '+duration(nextAt-Date.now())+'.':''}</p>${accuracy(progress[l.id])}<div class="course-actions"><button class="grammar-secondary" id="courseFinishBack" type="button">К карте курса</button>${!session.review && next?`<button class="btn" id="courseNextLesson" type="button">Следующий урок →</button>`:''}</div></div>`;
    ui.practice.querySelector('#courseFinishBack').addEventListener('click',()=>openMap());ui.practice.querySelector('#courseNextLesson')?.addEventListener('click',()=>openLesson(next.id));
    if(session.review && due().length){
      ui.practice.querySelector('h3').textContent='Доступны новые повторения';
      ui.practice.querySelector('.course-actions').insertAdjacentHTML('beforeend','<button class="btn" id="courseRepeatNow" type="button">Повторить сейчас</button>');
      ui.practice.querySelector('#courseRepeatNow').addEventListener('click',()=>begin(true));
    }else if(session.review && nextAt && active)wake=setTimeout(finish,Math.max(1000,Math.min(30000,nextAt-Date.now()+50)));
  }
  function connect(selectedFiles){let count=0;for(const f of selectedFiles){const l=lessons.find(l=>l.file===f.name);if(l && f.name.toLowerCase().endsWith('.mp4')){files.set(l.id,f);count++}}message(`Подключено ${count} из ${lessons.length} видео. Файлы остаются только на устройстве.`);if(screen==='lesson')openLesson(selected,false)}
  function setProgress(data,options={}){const clean=validateProgress(data);mediaRevision++;rememberVideo=null;stop();if(options.persist!==false && !save(clean))return false;progress=clean;if(ui)openMap(false);return true}
  function reset(){mediaRevision++;rememberVideo=null;stop();if(!save({}))return false;if(ui){openMap(false);message('Прогресс только видеокурса сброшен. Кана и грамматика сохранены.')}return true}
  function onViewChange(value){active=value;if(!value){stop();return}if(!ui)return;renderMetrics();if(screen==='map')renderMap()}
  function init(api){
    host=api;const id=n=>document.getElementById(n);ui={map:id('courseMap'),lesson:id('courseLesson'),practice:id('coursePractice'),metrics:id('courseMetrics'),review:id('courseReview'),folder:id('courseFolder'),message:id('courseMessage')};load();renderMetrics();renderMap();
    id('courseMapButton').addEventListener('click',()=>openMap());id('courseConnect').addEventListener('click',()=>ui.folder.click());ui.folder.addEventListener('change',()=>{connect([...ui.folder.files]);ui.folder.value=''});ui.review.addEventListener('click',()=>begin(true));
    id('courseExport').addEventListener('click',host.exportProgress);id('courseImport').addEventListener('click',host.importProgress);id('courseReset').addEventListener('click',()=>{if(confirm('Сбросить только видеокурс? Прогресс каны и грамматики останется.'))reset()});
    const route=()=>{if(!location.hash.startsWith('#course'))return;const id=location.hash.match(/^#course\/lesson\/([a-z0-9-]+)$/)?.[1];if(id && lessons.some(l=>l.id===id))openLesson(id,false);else openMap(false);host.openCourse()};window.addEventListener('hashchange',route);window.addEventListener('popstate',route);window.addEventListener('storage',e=>{if(e.key===KEY && !session){mediaRevision++;rememberVideo=null;stop();load();screen==='lesson'?openLesson(selected,false):openMap(false)}});route();
  }
  window.KanaVideoCourse={storageKey:KEY,init,onViewChange,getProgress:()=>JSON.parse(JSON.stringify(progress)),setProgress,validateProgress,reset,testing:{stats,due,plan,connect}};
})();
