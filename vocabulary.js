(() => {
  'use strict';
  const KEY='kanaTrainerVocabularyV1',MIN=60000,DAY=86400000;
  const intervals=[10*MIN,60*MIN,DAY,3*DAY,7*DAY,14*DAY,30*DAY,90*DAY,180*DAY,365*DAY];
  const deck=window.KANA_VOCABULARY||{cards:[],metadata:{categories:[]}},cards=deck.cards,categories=deck.metadata.categories;
  const byId=new Map(cards.map(c=>[c.id,c])),PAGE_SIZE=24;
  const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalize=v=>String(v).normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-96));
  const empty=()=>({seen:0,remembered:0,hard:0,forgot:0,streak:0,stage:0,lastAt:0,dueAt:0});
  let host,ui,progress={},active=false,category='all',query='',stateFilter='all',page=0,session=null,token=0,wake=0,speechText=null,speechTask=null;
  function validateProgress(data){
    if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Повреждён прогресс словаря.');
    const clean={},number=(v,max=1e9)=>{if(!Number.isSafeInteger(v)||v<0||v>max)throw Error('Некорректные счётчики словаря.');return v};
    for(const [id,p] of Object.entries(data)){
      if(!byId.has(id))continue;
      if(!p||typeof p!=='object'||Array.isArray(p))throw Error('Повреждена словарная карточка.');
      const n=empty();for(const k of ['seen','remembered','hard','forgot','streak'])n[k]=number(p[k]??0);
      n.stage=number(p.stage??0,intervals.length);
      n.lastAt=number(p.lastAt??0,Date.UTC(2200,0,1));n.dueAt=number(p.dueAt??0,Date.UTC(2200,0,1));
      if(n.remembered+n.hard+n.forgot!==n.seen||n.streak>n.remembered||!n.seen&&(n.stage||n.lastAt||n.dueAt))throw Error('Счётчики словаря не совпадают.');
      clean[id]=n;
    }
    if(Object.keys(data).length&&!Object.keys(clean).length)throw Error('В файле нет знакомых словарных карточек.');return clean;
  }
  function message(text,error=false){if(ui){ui.message.textContent=text;ui.message.classList.toggle('is-error',error)}}
  function save(next){try{localStorage.setItem(KEY,JSON.stringify(next));progress=next;return true}catch(e){message('Не удалось сохранить ответ. Освободите место в браузере и попробуйте ещё раз.',true);return false}}
  function load(){try{progress=validateProgress(JSON.parse(localStorage.getItem(KEY)||'{}'))}catch(e){progress={};message('Не удалось прочитать прогресс словаря. Старые данные в браузере не удалены.',true)}}
  function status(p,now=Date.now()){return !p?.seen?'new':p.dueAt<=now?'due':p.stage>=5?'mastered':'learning'}
  function nextProgress(previous,grade,now=Date.now()){
    if(!['again','hard','remembered'].includes(grade))throw Error('Неизвестная оценка.');
    const p={...empty(),...previous},next={...p,seen:p.seen+1,lastAt:now};
    if(grade==='again'){next.forgot++;next.stage=0;next.streak=0;next.dueAt=now+MIN}
    else if(grade==='hard'){next.hard++;next.stage=Math.max(0,p.stage-1);next.streak=0;next.dueAt=now+10*MIN}
    else{next.remembered++;next.streak++;next.stage=Math.min(intervals.length,p.stage+1);next.dueAt=now+intervals[next.stage-1]}
    return next;
  }
  function eligible(ignoreStatus=false){const text=normalize(query).trim();return cards.filter(c=>(category==='all'||c.category===category)&&(ignoreStatus||stateFilter==='all'||status(progress[c.id])===stateFilter)&&(!text||normalize([c.japanese,c.reading,c.romaji,c.russian].join(' ')).includes(text)))}
  function due(list=cards,now=Date.now()){return list.filter(c=>progress[c.id]?.seen&&progress[c.id].dueAt<=now).sort((a,b)=>progress[a.id].dueAt-progress[b.id].dueAt)}
  function duration(ms){return ms<60*MIN?`${Math.max(1,Math.ceil(ms/MIN))} мин`:ms<DAY?`${Math.ceil(ms/(60*MIN))} ч`:`${Math.ceil(ms/DAY)} дн`}
  function label(id){return categories.find(c=>c.id===id)?.label||id}
  function stop(){token++;clearTimeout(wake);speechText=null;speechTask=null;host?.cancelSpeech()}
  function wordSpeechText(card){const reading=card.reading.normalize('NFKC');return ({'は':'ハ','へ':'ヘ','を':'ヲ'})[reading]||reading}
  function scrollPractice(){if(active)ui.practice.scrollIntoView({block:'start',behavior:document.documentElement.dataset.motion==='off'||window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})}
  function renderMetrics(){
    const values=Object.values(progress),started=values.filter(p=>p.seen),answers=values.reduce((n,p)=>n+p.seen,0),remembered=values.reduce((n,p)=>n+p.remembered,0);
    const metrics=[[started.length+'/'+cards.length,'Слов изучается'],[due().length,'Пора повторить'],[started.filter(p=>status(p)==='mastered').length,'Закреплено'],[answers?Math.round(remembered/answers*100)+'%':'—','Вспомнил(а) уверенно']];
    ui.metrics.innerHTML=metrics.map(([n,t])=>`<div class="grammar-metric"><strong>${n}</strong><span>${t}</span></div>`).join('');
    const list=eligible(true);ui.learn.textContent=`Учить новые · ${Math.min(10,list.filter(c=>!progress[c.id]?.seen).length)}`;ui.review.textContent=`Повторить · ${due(list).length}`;
  }
  function renderCatalog(){
    const filtered=eligible(),totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));page=Math.max(0,Math.min(page,totalPages-1));
    const names={new:'Новая',due:'Пора повторить',learning:'Изучается',mastered:'Закреплена'};
    ui.grid.innerHTML=filtered.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map(c=>{const p=progress[c.id],s=status(p);return `<button type="button" class="vocab-item is-${s}" data-vocab-id="${c.id}"><span class="vocab-item-label">${escape(label(c.category))} · ${names[s]}</span><strong lang="ja">${escape(c.japanese)}</strong><span lang="ja">${escape(c.reading)}</span><span class="vocab-roman">${escape(c.romaji)}</span><span class="vocab-meaning">${escape(c.russian)}</span><span class="vocab-item-track" aria-hidden="true"><i style="width:${p?.seen?Math.min(100,p.stage/5*100):0}%"></i></span></button>`}).join('')||'<p class="vocab-empty">Ничего не найдено. Попробуйте другой запрос или категорию.</p>';
    ui.grid.querySelectorAll('[data-vocab-id]').forEach(b=>b.addEventListener('click',()=>openDetail(b.dataset.vocabId)));
    ui.pageText.textContent=`${filtered.length?`${page*PAGE_SIZE+1}–${Math.min((page+1)*PAGE_SIZE,filtered.length)}`:'0'} из ${filtered.length} · страница ${page+1}/${totalPages}`;
    ui.prev.disabled=page===0;ui.next.disabled=page>=totalPages-1;
  }
  function openCatalog(){stop();session=null;ui.practice.hidden=true;ui.catalog.hidden=false;renderMetrics();renderCatalog()}
  function detailContent(c){return `<p class="vocab-detail-reading" lang="ja">${escape(c.reading)}</p><p class="vocab-roman">${escape(c.romaji)}</p><p class="vocab-detail-meaning">${escape(c.russian)}</p><div class="vocab-example"><strong lang="ja">${escape(c.example)}</strong><p>${escape(c.exampleRussian)}</p></div>`}
  function openDetail(id){
    const c=byId.get(id);if(!c)return;stop();ui.dialogTitle.textContent=c.japanese;
    const p=progress[id];ui.dialogBody.innerHTML=`<p class="grammar-eyebrow">${escape(label(c.category))}</p>${detailContent(c)}<div class="vocab-audio"><button class="grammar-secondary" data-vocab-speak="word" type="button">♪ Слово</button><button class="grammar-secondary" data-vocab-speak="example" type="button">♪ Пример</button></div><p class="grammar-note">${p?.seen?`${p.seen} ответов · вспомнил(а) ${p.remembered} · с трудом ${p.hard} · не вспомнил(а) ${p.forgot}. Следующий повтор: ${p.dueAt<=Date.now()?'уже доступен':duration(p.dueAt-Date.now())}.`:'Эта карточка ещё не изучалась.'}</p><button class="btn" id="vocabStudyOne" type="button">Потренировать карточку</button>`;
    ui.dialogBody.querySelectorAll('[data-vocab-speak]').forEach(b=>b.addEventListener('click',()=>speak(b.dataset.vocabSpeak==='word'?wordSpeechText(c):c.example,true)));
    ui.dialogBody.querySelector('#vocabStudyOne').addEventListener('click',()=>{ui.dialog.close();begin([c.id],'manual')});ui.dialog.showModal();
  }
  async function speak(text,force=false){
    if(speechText===text&&speechTask)return speechTask;
    const current=++token;clearTimeout(wake);speechText=text;
    try{
      const task=Promise.resolve(host.speak(text,force,{requireJapaneseVoice:true}));speechTask=task;
      const result=await task;if(current!==token)return result;
      if(result?.status==='no-voice'||result?.status==='unsupported')speechError('В браузере недоступен японский голос. Проверьте наличие японской озвучки в системе или откройте сайт в другом браузере.');
      else if(result?.status==='error'||result?.status==='timeout')speechError('Японский голос не смог завершить озвучку. Нажмите «Произнести» ещё раз.');
      else if(result?.status==='completed'&&ui.message.dataset.speechError===ui.message.textContent){message('',false);delete ui.message.dataset.speechError}
      return result;
    }catch(e){if(current===token)speechError('Не удалось озвучить. Проверьте поддержку японской речи в браузере.')}
    finally{if(current===token){speechText=null;speechTask=null}}
  }
  function speechError(text){message(text,true);ui.message.dataset.speechError=text}
  function start(kind){
    const list=eligible(true),queue=kind==='new'?list.filter(c=>!progress[c.id]?.seen).slice(0,10):due(list).slice(0,30);
    begin(queue.map(c=>c.id),kind);
  }
  function begin(queue,kind){stop();ui.catalog.hidden=true;ui.practice.hidden=false;session={queue,kind,direction:ui.direction.value,current:null,revealed:false,locked:false,answers:0,remembered:0,hard:0,forgot:0};nextCard()}
  function nextCard(){
    stop();if(!session)return;session.current=session.queue.shift();session.revealed=false;session.locked=false;
    if(!session.current){finish();return}const c=byId.get(session.current),reverse=session.direction==='ru-ja';ui.practice.dataset.cardId=c.id;
    ui.practice.innerHTML=`<div class="grammar-practice-head"><p class="grammar-eyebrow">Словарные карточки · ${session.kind==='review'?'Повторение':session.kind==='new'?'Новые слова':'Свободная тренировка'}</p><span class="grammar-counter">Осталось ${session.queue.length+1}</span></div><p class="vocab-prompt">${reverse?'Вспомните японское слово или выражение':'Вспомните значение по-русски'}</p><div class="vocab-study-card"><p class="vocab-front ${reverse?'is-russian':''}" ${reverse?'':'lang="ja"'}>${escape(reverse?c.russian:c.japanese)}</p><div class="vocab-back" hidden>${reverse?`<p class="vocab-back-word" lang="ja">${escape(c.japanese)}</p>`:''}${detailContent(c)}</div></div><div class="vocab-audio">${reverse?'':'<button id="vocabFrontSpeak" class="grammar-secondary" type="button">♪ Произнести</button>'}<button class="btn" id="vocabReveal" type="button">Показать ответ</button></div><div class="vocab-grade" hidden aria-label="Как получилось вспомнить"><button type="button" data-vocab-grade="again"><strong>1 · Не помню</strong><span>Повторим ещё раз</span></button><button type="button" data-vocab-grade="hard"><strong>2 · С трудом</strong><span>Через 10 минут</span></button><button type="button" data-vocab-grade="remembered"><strong>3 · Помню</strong><span>Увеличить интервал</span></button></div><p class="vocab-feedback" role="status" aria-live="polite"></p><div class="vocab-bottom"><button class="grammar-secondary" id="vocabExit" type="button">К словарю</button><button class="btn" id="vocabNextCard" type="button" hidden>Дальше →</button></div><p class="grammar-note">Сначала вспомните ответ, затем откройте и честно оцените себя. Пробел — показать ответ; 1/2/3 — оценка.</p>`;
    ui.practice.querySelector('#vocabReveal').addEventListener('click',reveal);
    ui.practice.querySelector('#vocabFrontSpeak')?.addEventListener('click',()=>speak(wordSpeechText(c),true));
    ui.practice.querySelectorAll('[data-vocab-grade]').forEach(b=>b.addEventListener('click',()=>grade(b.dataset.vocabGrade)));
    ui.practice.querySelector('#vocabNextCard').addEventListener('click',nextCard);ui.practice.querySelector('#vocabExit').addEventListener('click',openCatalog);
    if(active)ui.practice.querySelector('#vocabReveal').focus({preventScroll:true});
    scrollPractice();
  }
  function reveal(){
    if(!session?.current||session.revealed)return;session.revealed=true;const c=byId.get(session.current);
    ui.practice.querySelector('.vocab-back').hidden=false;ui.practice.querySelector('.vocab-study-card').classList.add('is-revealed');ui.practice.querySelector('.vocab-grade').hidden=false;ui.practice.querySelector('#vocabReveal').hidden=true;
    ui.practice.querySelector('.vocab-audio').insertAdjacentHTML('beforeend','<button class="grammar-secondary" id="vocabBackSpeak" type="button">♪ Слово</button><button class="grammar-secondary" id="vocabExampleSpeak" type="button">♪ Пример</button>');
    ui.practice.querySelector('#vocabBackSpeak').addEventListener('click',()=>speak(wordSpeechText(c),true));ui.practice.querySelector('#vocabExampleSpeak').addEventListener('click',()=>speak(c.example,true));
    if(active&&host.soundEnabled())speak(wordSpeechText(c));
  }
  function grade(value){
    if(!session?.revealed||session.locked)return;
    const id=session.current,p=nextProgress(progress[id],value);if(!save({...progress,[id]:p}))return;
    session.locked=true;session.answers++;session[value==='again'?'forgot':value]++;
    if(value==='again')session.queue.splice(Math.min(2,session.queue.length),0,id);
    ui.practice.querySelectorAll('[data-vocab-grade]').forEach(b=>{b.disabled=true;b.classList.toggle('is-selected',b.dataset.vocabGrade===value)});
    ui.practice.querySelector('.vocab-feedback').textContent=value==='again'?'Карточка вернётся в этой тренировке. Следующий плановый повтор — через минуту.':`Сохранено. Следующий повтор через ${duration(p.dueAt-Date.now())}.`;
    const next=ui.practice.querySelector('#vocabNextCard');next.hidden=false;next.focus({preventScroll:true});renderMetrics();
    const audioToken=token;
    if(host.soundEnabled())Promise.resolve(speechTask).then(()=>{if(active&&audioToken===token&&session?.current===id&&session.locked)return host.tone(value!=='again')}).catch(()=>{});
  }
  function finish(){
    renderMetrics();const list=eligible(true),available=due(list),future=list.map(c=>progress[c.id]?.dueAt).filter(t=>t>Date.now()),next=future.length?Math.min(...future):null;
    ui.practice.innerHTML=`<div class="vocab-finish"><span class="grammar-hero-mark" aria-hidden="true">休</span><h3>${session.answers?'Тренировка завершена':session.kind==='new'?'Новых карточек в этом наборе нет':'Сейчас всё повторено'}</h3><p>${session.answers?`${session.answers} ответов · помню ${session.remembered} · с трудом ${session.hard} · не помню ${session.forgot}.`:'Измените категорию или поисковый запрос, чтобы выбрать другой набор.'}</p>${next&&!available.length?`<p>Приходите через ${duration(next-Date.now())} — появятся новые повторения.</p>`:''}<div class="course-actions"><button class="grammar-secondary" id="vocabFinishBack" type="button">К словарю</button>${available.length?`<button class="btn" id="vocabContinue" type="button">Повторить доступные · ${available.length}</button>`:''}</div></div>`;
    ui.practice.querySelector('#vocabFinishBack').addEventListener('click',openCatalog);ui.practice.querySelector('#vocabContinue')?.addEventListener('click',()=>start('review'));
    if(!session.finished){session.finished=true;scrollPractice()}
    if(!available.length&&next&&active)wake=setTimeout(finish,Math.max(1000,Math.min(30000,next-Date.now()+50)));
  }
  function setProgress(data,options={}){const clean=validateProgress(data);if(options.persist!==false&&!save(clean))return false;progress=clean;if(ui){ui.dialog.open&&ui.dialog.close();openCatalog()}return true}
  function reset(){if(!save({}))return false;openCatalog();message('Сброшен только словарь. Кана, грамматика и видеокурс сохранены.');return true}
  function onViewChange(value){active=value;if(!value){stop();if(ui?.dialog.open)ui.dialog.close()}else if(ui){renderMetrics();if(!session)renderCatalog();else if(!session.current)finish()}}
  function init(api){
    host=api;const id=n=>document.getElementById(n);ui={metrics:id('vocabMetrics'),catalog:id('vocabCatalog'),grid:id('vocabGrid'),practice:id('vocabPractice'),learn:id('vocabLearn'),review:id('vocabReview'),direction:id('vocabDirection'),message:id('vocabMessage'),prev:id('vocabPrev'),next:id('vocabNext'),pageText:id('vocabPageText'),dialog:id('vocabDialog'),dialogTitle:id('vocabDialogTitle'),dialogBody:id('vocabDialogBody')};
    id('vocabCategory').innerHTML='<option value="all">Все категории · '+cards.length+'</option>'+categories.map(c=>`<option value="${c.id}">${escape(c.label)} · ${c.count}</option>`).join('');
    id('vocabCategory').addEventListener('change',e=>{category=e.target.value;page=0;openCatalog()});id('vocabSearch').addEventListener('input',e=>{query=e.target.value;page=0;openCatalog()});id('vocabState').addEventListener('change',e=>{stateFilter=e.target.value;page=0;openCatalog()});
    ui.prev.addEventListener('click',()=>{page--;renderCatalog()});ui.next.addEventListener('click',()=>{page++;renderCatalog()});ui.learn.addEventListener('click',()=>start('new'));ui.review.addEventListener('click',()=>start('review'));id('vocabMapButton').addEventListener('click',openCatalog);
    id('vocabDialogClose').addEventListener('click',()=>ui.dialog.close());ui.dialog.addEventListener('close',stop);ui.dialog.addEventListener('click',e=>{if(e.target===ui.dialog)ui.dialog.close()});
    id('vocabExport').addEventListener('click',host.exportProgress);id('vocabImport').addEventListener('click',host.importProgress);id('vocabReset').addEventListener('click',()=>{if(confirm('Сбросить только прогресс словаря? Остальные разделы останутся без изменений.'))reset()});
    document.addEventListener('keydown',e=>{if(!active||!session?.current||ui.dialog.open||e.target.matches('input,select,textarea,[contenteditable]')||e.repeat||e.ctrlKey||e.metaKey||e.altKey)return;
      if(e.target.closest('button,a,[role=button]')&&(e.code==='Space'||e.key==='Enter'))return;
      if((e.code==='Space'||e.key==='Enter')&&!session.revealed){e.preventDefault();reveal()}
      else if(['1','2','3'].includes(e.key)&&session.revealed&&!session.locked){e.preventDefault();grade(['again','hard','remembered'][Number(e.key)-1])}
      else if(e.key==='Enter'&&session.locked){e.preventDefault();nextCard()}
    });
    window.addEventListener('hashchange',()=>{if(location.hash==='#vocabulary'){host.openVocabulary();openCatalog()}});
    window.addEventListener('storage',e=>{if(e.key===KEY){load();openCatalog();message('Прогресс словаря изменён в другой вкладке. Данные обновлены; начните новую тренировку.')}});
    load();renderMetrics();renderCatalog();if(location.hash==='#vocabulary')host.openVocabulary();
  }
  window.KanaVocabulary={storageKey:KEY,init,onViewChange,getProgress:()=>JSON.parse(JSON.stringify(progress)),setProgress,validateProgress,reset,testing:{nextProgress,status,due,normalize,wordSpeechText}};
})();
