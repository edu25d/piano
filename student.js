(() => {
  const $ = selector => document.querySelector(selector);
  const entryView = $('#student-entry-view'), catalogView = $('#student-catalog-view'), practiceView = $('#student-view');
  const query = new URLSearchParams(location.search);
  const joinMode = query.get('join') === '1';
  const classIdFromQr = query.get('classId') || '';
  let screen = 'entry';
  let profile = null;
  let qrClass = null;
  let saveQueue = Promise.resolve();
  const apiErrors = {
    server_configuration_missing: '서버의 Supabase 설정을 확인해 주세요.',
    database_request_failed: 'Supabase 요청을 완료하지 못했어요.',
    student_not_found: '학생 정보를 다시 입력해 주세요.',
    resource_not_found: '이 연습곡은 현재 열 수 없어요.',
    score_not_found: '악보를 찾지 못했어요.',
    attempt_not_found: '연습 회차를 찾지 못했어요.',
    attempt_out_of_sync: '저장된 연습 위치를 다시 불러와 주세요.'
  };

  function showMessage(element, text, error = false) {
    element.textContent = text;
    element.classList.toggle('is-error', error);
  }

  function setScreen(next) {
    screen = next;
    entryView.hidden = next !== 'entry';
    catalogView.hidden = next !== 'catalog';
    practiceView.hidden = next !== 'practice';
    $('#teacher-view').hidden = true;
  }

  function showCurrentView() {
    setScreen(screen);
  }

  async function apiGet(params) {
    const response = await fetch(`/api/student-portal?${new URLSearchParams(params)}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(apiErrors[data.error] || '서버에 연결하지 못했어요.');
    return data;
  }

  async function apiPost(body) {
    const response = await fetch('/api/student-portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(apiErrors[data.error] || '저장하지 못했어요.');
    return data;
  }

  async function loadQrClass() {
    const form = $('#student-entry-form'), display = $('#student-class-display');
    form.hidden = true;
    display.hidden = true;
    if (!classIdFromQr) {
      showMessage($('#student-entry-message'), '학급별 QR 주소가 아니에요. 선생님께 새 QR을 요청해 주세요.', true);
      return;
    }
    showMessage($('#student-entry-message'), 'QR에 연결된 학급을 확인하고 있어요.');
    try {
      const data = await apiGet({ action: 'class', classId: classIdFromQr });
      qrClass = data.class;
      if (!qrClass) throw new Error('class_not_found');
      display.textContent = `${qrClass.grade}학년 ${qrClass.class_name}`;
      display.hidden = false;
      $('#student-grade-prompt').textContent = '이 QR은 위 학급에 연결되어 있어요. 이름을 입력해 주세요.';
      form.hidden = false;
      showMessage($('#student-entry-message'), '');
    } catch (error) {
      qrClass = null;
      showMessage($('#student-entry-message'), '이 학급 QR을 확인하지 못했어요. 선생님께 새 QR을 요청해 주세요.', true);
    }
  }

  function attemptFor(attempts, type, resourceId) {
    const field = type === 'assignment' ? 'assignment_id' : 'practice_song_id';
    return attempts.find(item => item[field] === resourceId) || null;
  }

  function songCard(item, type, attempts) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'student-song-card';
    const title = document.createElement('strong');
    title.textContent = item.title;
    const status = document.createElement('span');
    const previous = attemptFor(attempts, type, item.id);
    if (previous?.status === 'in_progress') {
      const percent = previous.total_notes ? Math.round(previous.current_note_index / previous.total_notes * 100) : 0;
      status.textContent = `이어서 연습 · ${percent}% 진행`;
    } else if (previous?.status === 'completed') {
      status.textContent = '완료 · 다시 연습할 수 있어요';
    } else {
      status.textContent = type === 'assignment' ? '선생님 과제' : item.difficulty || '자유 연습';
    }
    button.append(title, status);
    button.addEventListener('click', () => openSong(item, type));
    return button;
  }

  async function loadCatalog() {
    const { studentId } = profile;
    setScreen('catalog');
    showMessage($('#student-catalog-message'), '연습곡을 불러오고 있어요.');
    try {
      const data = await apiGet({ action: 'catalog', studentId });
      $('#student-name-label').textContent = profile.displayName;
      $('#student-class-label').textContent = `${profile.grade}학년 ${profile.className}`;
      const assignments = $('#student-assignment-list'), songs = $('#student-free-list');
      assignments.replaceChildren();
      songs.replaceChildren();
      for (const item of data.assignments || []) assignments.append(songCard(item, 'assignment', data.attempts || []));
      for (const item of data.practiceSongs || []) songs.append(songCard(item, 'practice', data.attempts || []));
      if (!assignments.children.length) assignments.innerHTML = '<p class="teacher-empty-note">아직 배정된 과제가 없습니다.</p>';
      if (!songs.children.length) songs.innerHTML = '<p class="teacher-empty-note">자유 연습곡이 없습니다. Supabase에서 student-flow.sql을 실행해 주세요.</p>';
      showMessage($('#student-catalog-message'), '곡을 고르면 연습을 시작할 수 있어요.');
      setScreen('catalog');
    } catch (error) {
      showMessage($('#student-catalog-message'), `연습곡을 불러오지 못했어요. ${error.message}`, true);
    }
  }

  async function openSong(item, type) {
    showMessage($('#student-catalog-message'), '악보를 준비하고 있어요.');
    try {
      const score = await apiGet({ action: 'score', studentId: profile.studentId, type, resourceId: item.id });
      let xml;
      if (score.builtin) {
        xml = window.getBuiltinScoreXml?.(score.builtin);
        if (!xml) throw new Error('기본 연습곡 파일을 찾지 못했어요.');
      } else {
        const response = await fetch(score.scoreUrl);
        if (!response.ok) throw new Error('악보 파일을 내려받지 못했어요.');
        if (!score.isMxl) {
          xml = await response.text();
        } else {
          const zip = await JSZip.loadAsync(await response.blob());
          const container = zip.file('META-INF/container.xml');
          let entryPath;
          if (container) entryPath = new DOMParser().parseFromString(await container.async('string'), 'application/xml').querySelector('rootfile')?.getAttribute('full-path');
          if (!entryPath) entryPath = Object.keys(zip.files).find(path => /\.musicxml$|\.xml$/i.test(path) && !path.startsWith('META-INF/'));
          const entry = entryPath && zip.file(entryPath);
          if (!entry) throw new Error('MXL 파일 안에서 악보를 찾지 못했어요.');
          xml = await entry.async('string');
        }
      }
      if (!await window.practiceBridge.loadScore(xml, score.title || item.title)) throw new Error('악보를 불러오지 못했어요.');
      const noteSequence = window.practiceBridge.getNoteSequence();
      const { attempt } = await apiPost({ action: 'start', studentId: profile.studentId, type, resourceId: item.id, noteSequence });
      if (!attempt) throw new Error('연습 회차를 만들지 못했어요.');
      window.practiceBridge.setStudentSession(profile, attempt, { ...item, type });
      $('#sample-button').hidden = true;
      $('#upload-button').hidden = true;
      $('#reset-button').hidden = true;
      $('#student-back-button').hidden = false;
      $('#mode-label').textContent = '학생 연습';
      setScreen('practice');
    } catch (error) {
      showMessage($('#student-catalog-message'), `연습곡을 열지 못했어요. ${error.message}`, true);
    }
  }

  async function saveAnswer(answer) {
    const session = window.practiceBridge.getStudentSession();
    if (!session && (!answer.studentId || !answer.attemptId)) return;
    const payload = { action: 'answer', studentId: answer.studentId || session.student.studentId, attemptId: answer.attemptId || session.attempt.id, noteIndex: answer.noteIndex, playedMidi: answer.playedMidi, clientEventId: answer.clientEventId };
    for (let retry = 0; retry < 3; retry++) {
      try {
        const result = await apiPost(payload);
        if (result.currentNoteIndex !== undefined && window.practiceBridge.getStudentSession()?.attempt.id === payload.attemptId) window.practiceBridge.updateStudentAttempt({ current_note_index: result.currentNoteIndex, status: result.completed ? 'completed' : 'in_progress' });
        return;
      } catch {
        if (retry < 2) await new Promise(resolve => setTimeout(resolve, 350 * (retry + 1)));
      }
    }
    $('#status-message').textContent = '연결이 잠시 끊겼어요. 연습 위치가 저장되지 않았을 수 있어요.';
  }

  function queueAnswer(answer) {
    saveQueue = saveQueue.then(() => saveAnswer(answer)).catch(() => {});
    return saveQueue;
  }

  async function restartAttempt() {
    const session = window.practiceBridge.getStudentSession();
    if (!session) return;
    try {
      const { attempt } = await apiPost({ action: 'start', studentId: session.student.studentId, type: session.task.type, resourceId: session.task.id, noteSequence: window.practiceBridge.getNoteSequence(), forceNew: true });
      window.practiceBridge.setStudentSession(profile, attempt, session.task);
    } catch (error) {
      $('#status-message').textContent = `새 회차를 시작하지 못했어요. ${error.message}`;
    }
  }

  async function handleEntrySubmit(event) {
    event.preventDefault();
    const displayName = $('#student-display-name').value.trim();
    if (!qrClass || !displayName) {
      showMessage($('#student-entry-message'), '학급 QR을 확인하고 이름을 입력해 주세요.', true);
      return;
    }
    showMessage($('#student-entry-message'), '학생 정보를 저장하고 있어요.');
    try {
      const { student, class: classInfo } = await apiPost({ action: 'join', classId: qrClass.id, displayName });
      profile = { studentId: student.id, classId: classInfo.id, grade: classInfo.grade, className: classInfo.class_name, displayName: student.display_name };
      await loadCatalog();
    } catch (error) {
      showMessage($('#student-entry-message'), `학생 정보를 저장하지 못했어요. ${error.message}`, true);
    }
  }

  function showEntry() {
    profile = null;
    setScreen('entry');
    $('#student-display-name').value = '';
    $('#student-grade-prompt').textContent = '이 QR은 반이 지정되어 있어요. 이름을 입력해 주세요.';
    showMessage($('#student-entry-message'), '');
    if (qrClass) {
      $('#student-class-display').textContent = `${qrClass.grade}학년 ${qrClass.class_name}`;
      $('#student-class-display').hidden = false;
      $('#student-entry-form').hidden = false;
    } else {
      $('#student-class-display').hidden = true;
      $('#student-entry-form').hidden = true;
      loadQrClass();
    }
  }

  $('#student-entry-form').addEventListener('submit', handleEntrySubmit);
  $('#student-change-identity').addEventListener('click', showEntry);
  $('#student-back-button').addEventListener('click', () => {
    window.practiceBridge.pauseStudent();
    setScreen('catalog');
  });

  window.studentPortal = {
    showCurrentView,
    recordAnswer: answer => queueAnswer(answer),
    restartAttempt
  };

  if (joinMode) {
    $('#mode-label').textContent = '학생 연습';
    $('#help-button').hidden = false;
    setScreen('entry');
    $('#student-entry-form').hidden = true;
    loadQrClass();
  } else {
    $('#help-button').hidden = true;
  }
})();
