(() => {
  const $ = selector => document.querySelector(selector);
  const teacherView = $('#teacher-view');
  const teacherAuthPanel = $('#teacher-auth-panel');
  const teacherDashboard = $('#teacher-dashboard');
  let client = null;
  let teacher = null;
  let classes = [];
  let practiceSongs = [];
  let repertoireLinks = [];
  let repertoireLoadVersion = 0;
  let repertoireClassIds = [];
  let repertoireSongIds = [];
  let assignmentClassIds = [];
  let selectedClassId = '';

  function message(element, text, isError = false) {
    element.textContent = text;
    element.classList.toggle('is-error', isError);
  }

  async function getSupabase() {
    if (client) return client;
    if (location.hostname === 'localhost' || location.hostname.endsWith('.jitda.io')) {
      throw new Error('교사 Supabase 기능은 Vercel 배포 주소에서 확인해 주세요.');
    }
    const response = await fetch('/api/supabase-config', { cache: 'no-store' });
    if (!response.ok) throw new Error('Vercel에 SUPABASE_PUBLISHABLE_KEY 환경변수를 등록해 주세요.');
    const config = await response.json();
    const createClient = window.supabase?.createClient;
    if (!config.url || !config.publishableKey || !createClient) {
      throw new Error('Supabase 공개 키 설정을 확인해 주세요.');
    }
    client = createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return client;
  }

  function showAuth() {
    teacherAuthPanel.hidden = false;
    teacherDashboard.hidden = true;
    $('#teacher-logout').hidden = true;
  }

  function showDashboard() {
    teacherAuthPanel.hidden = true;
    teacherDashboard.hidden = false;
    $('#teacher-logout').hidden = false;
    $('#teacher-heading-account').textContent = teacher?.email || '';
    selectTeacherTab('overview');
  }

  function selectTeacherTab(tabName) {
    const overview = tabName === 'overview';
    $('#teacher-tab-overview').classList.toggle('is-active', overview);
    $('#teacher-tab-overview').setAttribute('aria-selected', String(overview));
    $('#teacher-tab-settings').classList.toggle('is-active', !overview);
    $('#teacher-tab-settings').setAttribute('aria-selected', String(!overview));
    $('#teacher-overview-panel').hidden = !overview;
    $('#teacher-settings-panel').hidden = overview;
  }

  async function openTeacherView() {
    teacherView.hidden = false;
    $('#mode-label').textContent = '교사 전용';
    showAuth();
    message($('#teacher-auth-message'), 'Supabase 연결을 확인하고 있습니다.');
    try {
      const db = await getSupabase();
      const { data: { session }, error } = await db.auth.getSession();
      if (error) throw error;
      if (!session?.user) {
        message($('#teacher-auth-message'), '교사 계정으로 로그인하거나 새 계정을 만들어 주세요.');
        return;
      }
      teacher = session.user;
      showDashboard();
      await loadTeacherData();
    } catch (error) {
      message($('#teacher-auth-message'), error.message || 'Supabase에 연결하지 못했어요.', true);
    }
  }

  function renderClassChecklist(container, name, selectedIds, onChange) {
    container.replaceChildren();
    if (!classes.length) {
      const empty = document.createElement('span');
      empty.className = 'teacher-empty-note';
      empty.textContent = '반을 먼저 등록해 주세요.';
      container.append(empty);
      return;
    }
    for (const item of classes) {
      const label = document.createElement('label');
      label.className = 'teacher-check-choice';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = name;
      checkbox.value = item.id;
      checkbox.checked = selectedIds.includes(item.id);
      const text = document.createElement('span');
      text.textContent = `${item.grade}학년 ${item.class_name}`;
      checkbox.addEventListener('change', () => {
        onChange([...container.querySelectorAll('input:checked')].map(input => input.value));
      });
      label.append(checkbox, text);
      container.append(label);
    }
  }

  function renderClassOptions() {
    const list = $('#teacher-class-list'), progressSelect = $('#teacher-progress-class'), qrSelect = $('#teacher-qr-class');
    const currentQrClass = qrSelect.value;
    list.replaceChildren();
    progressSelect.replaceChildren(new Option('반 선택', ''));
    qrSelect.replaceChildren(new Option('반 선택', ''));
    for (const item of classes) {
      const title = `${item.grade}학년 ${item.class_name}`;
      progressSelect.add(new Option(title, item.id));
      qrSelect.add(new Option(title, item.id));
      const row = document.createElement('div');
      row.className = 'teacher-class-row';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'teacher-class-chip';
      button.textContent = title;
      button.setAttribute('aria-pressed', String(item.id === selectedClassId));
      button.addEventListener('click', () => selectTeacherClass(item.id));
      const qrButton = document.createElement('button');
      qrButton.type = 'button';
      qrButton.className = 'teacher-class-qr-button';
      qrButton.textContent = '학생 QR';
      qrButton.setAttribute('aria-label', `${title} 학생 접속 QR 만들기`);
      qrButton.addEventListener('click', () => {
        qrSelect.value = item.id;
        selectTeacherTab('overview');
        generateTeacherQr();
      });
      row.append(button, qrButton);
      list.append(row);
    }
    repertoireClassIds = repertoireClassIds.filter(id => classes.some(item => item.id === id));
    assignmentClassIds = assignmentClassIds.filter(id => classes.some(item => item.id === id));
    if (!repertoireClassIds.length && selectedClassId) repertoireClassIds = [selectedClassId];
    if (!assignmentClassIds.length && selectedClassId) assignmentClassIds = [selectedClassId];
    renderClassChecklist($('#teacher-repertoire-class-list'), 'repertoire-class', repertoireClassIds, ids => {
      repertoireClassIds = ids;
      $('#teacher-repertoire-class-count').textContent = ids.length ? `${ids.length}개 반 선택됨` : '반을 선택해 주세요';
      loadRepertoireLinks();
    });
    renderClassChecklist($('#teacher-assignment-class-list'), 'assignment-class', assignmentClassIds, ids => {
      assignmentClassIds = ids;
      $('#teacher-assignment-class-count').textContent = ids.length ? `${ids.length}개 반 선택됨` : '반을 선택해 주세요';
      $('#teacher-assignment-submit').textContent = `3. ${ids.length || ''}개 반에 과제 등록`;
    });
    $('#teacher-repertoire-class-count').textContent = repertoireClassIds.length ? `${repertoireClassIds.length}개 반 선택됨` : '반을 선택해 주세요';
    $('#teacher-assignment-class-count').textContent = assignmentClassIds.length ? `${assignmentClassIds.length}개 반 선택됨` : '반을 선택해 주세요';
    $('#teacher-assignment-submit').textContent = `3. ${assignmentClassIds.length || ''}개 반에 과제 등록`;
    progressSelect.value = selectedClassId;
    qrSelect.value = classes.some(item => item.id === currentQrClass) ? currentQrClass : selectedClassId;
    progressSelect.disabled = !classes.length;
    qrSelect.disabled = !classes.length;
    $('#teacher-summary-classes').textContent = classes.length;
    if (!classes.length) list.innerHTML = '<p class="teacher-empty-note">반을 등록하면 여기에 표시됩니다.</p>';
  }

  function teacherVisiblePracticeSongs() {
    const overriddenDefaults = new Set(practiceSongs
      .filter(song => song.created_by === teacher?.id && song.musicxml_path.startsWith('builtin:'))
      .map(song => song.musicxml_path));
    return practiceSongs.filter(song => !(song.created_by === null && song.musicxml_path.startsWith('builtin:') && overriddenDefaults.has(song.musicxml_path)));
  }

  function renderPracticeSongs() {
    const select = $('#teacher-assignment-song'), list = $('#teacher-practice-song-list');
    const selectedSongId = select.value;
    const visibleLibrary = teacherVisiblePracticeSongs();
    select.replaceChildren(new Option('목록에서 곡을 고르세요', ''));
    for (const song of visibleLibrary.filter(item => item.is_active)) {
      select.add(new Option(`${song.title}${song.difficulty ? ` · ${song.difficulty}` : ''}`, song.id));
    }
    select.value = visibleLibrary.some(song => song.id === selectedSongId && song.is_active) ? selectedSongId : '';
    list.replaceChildren();
    const showHidden = $('#teacher-library-show-hidden').checked;
    const visibleSongs = visibleLibrary.filter(song => showHidden || song.is_active);
    if (!visibleSongs.length) {
      list.innerHTML = '<p class="teacher-empty-note">표시할 연습곡이 없습니다. 파일을 올릴 때 목록에도 추가할 수 있어요.</p>';
      renderRepertoireSongPicker();
      return;
    }
    for (const song of visibleSongs) {
      const owned = song.created_by === teacher?.id;
      const builtin = song.created_by === null && song.musicxml_path.startsWith('builtin:');
      const editable = owned || builtin;
      const row = document.createElement('article');
      row.className = `teacher-song-item${song.is_active ? '' : ' is-archived'}`;
      row.dataset.librarySongId = song.id;
      const main = document.createElement('div');
      main.className = 'teacher-song-main';
      const copy = document.createElement('div');
      copy.className = 'teacher-song-copy';
      const title = document.createElement('strong');
      title.textContent = song.title;
      const meta = document.createElement('span');
      meta.className = 'teacher-song-meta';
      const personalDefault = owned && song.musicxml_path.startsWith('builtin:');
      meta.textContent = `${song.difficulty || '난이도 미지정'} · ${builtin || personalDefault ? '기본 연습곡' : owned ? '내 연습곡' : '연습곡'}${personalDefault ? ' · 내 설정' : ''} · ${song.is_active ? '목록에 표시' : '숨김'}`;
      copy.append(title, meta);
      main.append(copy);
      if (editable) {
        const actions = document.createElement('div');
        actions.className = 'teacher-song-actions';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.dataset.songAction = 'edit';
        edit.dataset.songId = song.id;
        edit.textContent = '수정';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.dataset.songAction = 'toggle';
        toggle.dataset.songId = song.id;
        toggle.textContent = song.is_active ? '목록에서 숨기기' : '다시 표시';
        actions.append(edit, toggle);
        main.append(actions);
      }
      row.append(main);
      if (owned) {
        const editor = document.createElement('form');
        editor.className = 'teacher-song-editor';
        editor.dataset.songEditForm = '';
        editor.dataset.songId = song.id;
        editor.hidden = true;
        const titleLabel = document.createElement('label');
        titleLabel.textContent = '곡 이름';
        const titleInput = document.createElement('input');
        titleInput.name = 'title';
        titleInput.value = song.title;
        titleInput.required = true;
        titleInput.maxLength = 100;
        titleLabel.append(titleInput);
        const difficultyLabel = document.createElement('label');
        difficultyLabel.textContent = '난이도';
        const difficultyInput = document.createElement('input');
        difficultyInput.name = 'difficulty';
        difficultyInput.value = song.difficulty || '';
        difficultyInput.maxLength = 30;
        difficultyLabel.append(difficultyInput);
        const save = document.createElement('button');
        save.type = 'submit';
        save.className = 'primary-button';
        save.textContent = '저장';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'secondary-control';
        cancel.dataset.songAction = 'cancel';
        cancel.textContent = '취소';
        editor.append(titleLabel, difficultyLabel, save, cancel);
        row.append(editor);
      }
      list.append(row);
    }
    renderRepertoireSongPicker();
  }

  function renderRepertoireSongPicker() {
    const list = $('#teacher-repertoire-song-list');
    list.replaceChildren();
    const songs = teacherVisiblePracticeSongs().filter(song => song.is_active);
    repertoireSongIds = repertoireSongIds.filter(id => songs.some(song => song.id === id));
    if (!repertoireClassIds.length) {
      list.innerHTML = '<span class="teacher-empty-note">먼저 반을 선택해 주세요.</span>';
      $('#teacher-repertoire-song-count').textContent = '곡을 선택해 주세요';
      return;
    }
    if (!songs.length) {
      list.innerHTML = '<span class="teacher-empty-note">표시 중인 연습곡이 없습니다.</span>';
      $('#teacher-repertoire-song-count').textContent = '곡을 선택해 주세요';
      return;
    }
    for (const song of songs) {
      const label = document.createElement('label');
      label.className = 'teacher-check-choice teacher-song-check-choice';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'repertoire-song';
      checkbox.value = song.id;
      checkbox.checked = repertoireSongIds.includes(song.id);
      const title = document.createElement('span');
      title.textContent = song.title;
      const assigned = repertoireClassIds.filter(classId => repertoireLinks.some(link =>
        link.class_id === classId && link.practice_song_id === song.id && link.is_active
      )).length;
      const status = document.createElement('small');
      status.textContent = `${assigned}/${repertoireClassIds.length}개 반에 배정`;
      checkbox.addEventListener('change', () => {
        repertoireSongIds = [...list.querySelectorAll('input:checked')].map(input => input.value);
        $('#teacher-repertoire-song-count').textContent = `${repertoireSongIds.length}곡 선택됨`;
      });
      label.append(checkbox, title, status);
      list.append(label);
    }
    $('#teacher-repertoire-song-count').textContent = repertoireSongIds.length ? `${repertoireSongIds.length}곡 선택됨` : '곡을 선택해 주세요';
  }

  async function loadRepertoireLinks() {
    const requestVersion = ++repertoireLoadVersion;
    const classIds = [...repertoireClassIds];
    if (!classIds.length) {
      repertoireLinks = [];
      renderRepertoireSongPicker();
      return;
    }
    try {
      const db = await getSupabase();
      const { data, error } = await db.from('class_practice_songs')
        .select('class_id, practice_song_id, is_active')
        .in('class_id', classIds);
      if (error) throw error;
      if (requestVersion !== repertoireLoadVersion) return;
      repertoireLinks = data || [];
      message($('#teacher-repertoire-message'), '');
    } catch (error) {
      if (requestVersion !== repertoireLoadVersion) return;
      repertoireLinks = [];
      message($('#teacher-repertoire-message'), '학급별 곡 연결을 읽지 못했어요. Supabase에서 class-repertoire.sql을 실행해 주세요.', true);
    }
    renderRepertoireSongPicker();
  }

  async function loadPracticeSongs() {
    try {
      const db = await getSupabase();
      const { data, error } = await db.from('practice_songs')
        .select('id, title, musicxml_path, difficulty, sort_order, is_active, created_by')
        .order('sort_order')
        .order('title');
      if (error) throw error;
      practiceSongs = data || [];
      renderPracticeSongs();
      message($('#teacher-library-message'), '');
    } catch (error) {
      practiceSongs = [];
      renderPracticeSongs();
      message($('#teacher-library-message'), '연습곡 목록을 읽지 못했어요. Supabase에서 teacher-library.sql을 실행해 주세요.', true);
    }
  }

  async function loadTeacherData() {
    const db = await getSupabase();
    const { data, error } = await db.from('classes')
      .select('id, grade, class_name')
      .order('grade')
      .order('class_name');
    if (error) {
      message($('#teacher-class-message'), '담당 반을 읽지 못했어요. Supabase에서 teacher-screen.sql을 실행했는지 확인해 주세요.', true);
      return;
    }
    classes = data || [];
    if (!classes.some(item => item.id === selectedClassId)) selectedClassId = classes[0]?.id || '';
    renderClassOptions();
    await loadPracticeSongs();
    await loadRepertoireLinks();
    if (selectedClassId) await loadClassDetails(selectedClassId);
    else {
      renderAssignments([]);
      renderAttempts([], [], []);
      $('#teacher-summary-assignments').textContent = '0';
      $('#teacher-summary-completed').textContent = '0';
      $('#teacher-summary-accuracy').textContent = '—';
      message($('#teacher-class-message'), '담당 반을 등록해 주세요.');
    }
  }

  async function selectTeacherClass(classId) {
    selectedClassId = classId;
    renderClassOptions();
    await loadClassDetails(classId);
  }

  async function loadClassDetails(classId) {
    if (!classId) return;
    const db = await getSupabase();
    const [assignmentResult, studentResult] = await Promise.all([
      db.from('assignments').select('id, title, created_at, is_active').eq('class_id', classId).order('created_at', { ascending: false }),
      db.from('students').select('id, display_name').eq('class_id', classId).order('display_name')
    ]);
    if (assignmentResult.error || studentResult.error) {
      message($('#teacher-class-message'), '반 기록을 읽지 못했어요. teacher-screen.sql의 권한 설정을 확인해 주세요.', true);
      return;
    }
    const assignments = assignmentResult.data || [];
    const students = studentResult.data || [];
    let attempts = [];
    if (students.length) {
      const result = await db.from('practice_attempts')
        .select('id, student_id, assignment_id, practice_song_id, practice_song:practice_songs(title), current_note_index, total_notes, correct_count, incorrect_count, status, started_at, updated_at')
        .in('student_id', students.map(student => student.id))
        .order('started_at', { ascending: true });
      if (result.error) {
        message($('#teacher-class-message'), '연습 회차를 읽지 못했어요. teacher-screen.sql의 권한 설정을 확인해 주세요.', true);
        return;
      }
      attempts = result.data || [];
    }
    renderAssignments(assignments);
    renderAttempts(students, assignments, attempts);
    $('#teacher-summary-assignments').textContent = assignments.length;
    $('#teacher-summary-completed').textContent = attempts.filter(attempt => attempt.status === 'completed').length;
    const answered = attempts.reduce((sum, attempt) => sum + attempt.correct_count + attempt.incorrect_count, 0);
    const correct = attempts.reduce((sum, attempt) => sum + attempt.correct_count, 0);
    $('#teacher-summary-accuracy').textContent = answered ? `${Math.round(correct / answered * 100)}%` : '—';
    message($('#teacher-class-message'), '');
  }

  function renderAssignments(assignments) {
    const list = $('#teacher-assignment-list');
    list.replaceChildren();
    if (!assignments.length) {
      list.innerHTML = '<p class="teacher-empty-note">이 반에는 아직 연습곡이 없습니다.</p>';
      return;
    }
    for (const assignment of assignments) {
      const chip = document.createElement('div');
      chip.className = 'teacher-assignment-chip';
      chip.textContent = assignment.title;
      list.append(chip);
    }
  }

  function renderAttempts(students, assignments, attempts) {
    const body = $('#teacher-progress-rows');
    body.replaceChildren();
    if (!attempts.length) {
      body.innerHTML = '<tr><td colspan="7" class="teacher-empty">아직 연습 기록이 없습니다.</td></tr>';
      return;
    }
    const studentNames = new Map(students.map(student => [student.id, student.display_name]));
    const assignmentNames = new Map(assignments.map(assignment => [assignment.id, assignment.title]));
    const rounds = new Map(), roundNumbers = new Map();
    for (const attempt of attempts) {
      const key = `${attempt.student_id}:${attempt.assignment_id || attempt.practice_song_id || 'free'}`;
      const round = (rounds.get(key) || 0) + 1;
      rounds.set(key, round);
      roundNumbers.set(attempt.id, round);
    }
    for (const attempt of [...attempts].reverse()) {
      const answered = attempt.correct_count + attempt.incorrect_count;
      const progress = attempt.total_notes ? Math.min(100, Math.round(attempt.current_note_index / attempt.total_notes * 100)) : 0;
      const values = [
        studentNames.get(attempt.student_id) || '학생',
        assignmentNames.get(attempt.assignment_id) || attempt.practice_song?.title || '자유 연습',
        `${roundNumbers.get(attempt.id)}회`,
        `${progress}%`,
        answered ? `${Math.round(attempt.correct_count / answered * 100)}%` : '—',
        String(attempt.incorrect_count),
        attempt.status === 'completed' ? '완료' : '연습 중'
      ];
      const row = document.createElement('tr');
      values.forEach(value => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      });
      body.append(row);
    }
  }

  async function handleTeacherLogin(event) {
    event.preventDefault();
    message($('#teacher-auth-message'), '로그인 중입니다.');
    try {
      const db = await getSupabase();
      const { data, error } = await db.auth.signInWithPassword({
        email: $('#teacher-email').value.trim(),
        password: $('#teacher-password').value
      });
      if (error) throw error;
      teacher = data.user;
      showDashboard();
      await loadTeacherData();
    } catch (error) {
      message($('#teacher-auth-message'), error.message || '로그인하지 못했어요.', true);
    }
  }

  async function handleTeacherSignup() {
    message($('#teacher-auth-message'), '교사 계정을 만드는 중입니다.');
    try {
      const db = await getSupabase();
      const { data, error } = await db.auth.signUp({
        email: $('#teacher-email').value.trim(),
        password: $('#teacher-password').value
      });
      if (error) throw error;
      if (!data.session) {
        message($('#teacher-auth-message'), '인증 메일을 확인한 뒤 로그인해 주세요.');
        return;
      }
      teacher = data.user;
      showDashboard();
      await loadTeacherData();
    } catch (error) {
      message($('#teacher-auth-message'), error.message || '계정을 만들지 못했어요.', true);
    }
  }

  async function handleCreateClass(event) {
    event.preventDefault();
    const grade = Number($('#teacher-grade').value);
    const className = $('#teacher-class-name').value.trim();
    if (!grade || !className || !teacher) return;
    message($('#teacher-class-message'), '반을 등록하고 있습니다.');
    const db = await getSupabase();
    const { data: newClass, error } = await db.from('classes')
      .insert({ grade, class_name: className, created_by: teacher.id })
      .select('id, grade, class_name')
      .single();
    if (error) {
      message($('#teacher-class-message'), error.message || '반을 등록하지 못했어요.', true);
      return;
    }
    const link = await db.from('teacher_classes').insert({ teacher_id: teacher.id, class_id: newClass.id });
    if (link.error) {
      message($('#teacher-class-message'), '반은 등록됐지만 계정에 연결되지 않았어요. 권한 SQL을 확인해 주세요.', true);
      await loadTeacherData();
      return;
    }
    $('#teacher-class-name').value = '';
    selectedClassId = newClass.id;
    repertoireClassIds = [newClass.id];
    repertoireSongIds = [];
    assignmentClassIds = [newClass.id];
    await loadTeacherData();
    message($('#teacher-class-message'), '담당 반을 등록했어요.');
  }

  async function handleRepertoireSubmit(event) {
    event.preventDefault();
    const action = event.submitter?.value || 'add';
    const classIds = repertoireClassIds.filter(id => classes.some(item => item.id === id));
    const songIds = repertoireSongIds.filter(id => teacherVisiblePracticeSongs().some(song => song.id === id && song.is_active));
    if (!classIds.length || !songIds.length) {
      message($('#teacher-repertoire-message'), '반과 연습곡을 하나 이상 선택해 주세요.', true);
      return;
    }
    const db = await getSupabase();
    if (action === 'remove') {
      const activeLinks = repertoireLinks.filter(link => classIds.includes(link.class_id) && songIds.includes(link.practice_song_id) && link.is_active);
      if (!activeLinks.length) {
        message($('#teacher-repertoire-message'), '선택한 반에 표시 중인 연습곡 연결이 없습니다.');
        return;
      }
      const { error } = await db.from('class_practice_songs')
        .update({ is_active: false, added_by: teacher.id })
        .in('class_id', classIds)
        .in('practice_song_id', songIds);
      if (error) {
        message($('#teacher-repertoire-message'), error.message || '선택한 반에서 연습곡을 숨기지 못했어요.', true);
        return;
      }
      await loadRepertoireLinks();
      message($('#teacher-repertoire-message'), `${activeLinks.length}개 반·곡 연결을 숨겼어요. 학생 기록은 보존됩니다.`);
      return;
    }

    const rows = classIds.flatMap(classId => songIds.map(practiceSongId => ({
      class_id: classId,
      practice_song_id: practiceSongId,
      added_by: teacher.id,
      is_active: true
    })));
    const { error } = await db.from('class_practice_songs')
      .upsert(rows, { onConflict: 'class_id,practice_song_id' });
    if (error) {
      message($('#teacher-repertoire-message'), error.message || '선택한 반에 연습곡을 추가하지 못했어요.', true);
      return;
    }
    await loadRepertoireLinks();
    message($('#teacher-repertoire-message'), `${songIds.length}곡을 ${classIds.length}개 반의 자유 연습에 추가했어요.`);
  }

  async function handleCreateAssignment(event) {
    event.preventDefault();
    const classIds = assignmentClassIds.filter(id => classes.some(item => item.id === id));
    const file = $('#teacher-score-file').files[0];
    const songId = $('#teacher-assignment-song').value;
    const title = $('#teacher-assignment-title').value.trim();
    if (!classIds.length) return message($('#teacher-assignment-message'), '과제를 받을 반을 하나 이상 선택해 주세요.', true);
    if (Boolean(file) === Boolean(songId)) return message($('#teacher-assignment-message'), '연습곡 목록에서 한 곡을 고르거나 새 MusicXML 파일을 올려 주세요.', true);
    if (!title) return message($('#teacher-assignment-message'), '과제 이름을 입력해 주세요.', true);

    const button = $('#teacher-assignment-submit');
    button.disabled = true;
    message($('#teacher-assignment-message'), file ? '악보를 저장하고 과제를 등록하고 있어요.' : '선택한 연습곡을 과제로 등록하고 있어요.');
    let db, uploadPath = '', librarySong = null;
    try {
      db = await getSupabase();
      let musicxmlPath;
      if (songId) {
        const song = practiceSongs.find(item => item.id === songId && item.is_active);
        if (!song) throw new Error('목록에서 연습곡을 다시 선택해 주세요.');
        musicxmlPath = song.musicxml_path;
      } else {
        const extension = file.name.match(/\.(xml|musicxml|mxl)$/i)?.[1]?.toLowerCase();
        if (!extension) throw new Error('XML, MusicXML 또는 MXL 파일을 선택해 주세요.');
        const addToLibrary = $('#teacher-library-optin').checked;
        uploadPath = addToLibrary
          ? `library/${teacher.id}/${crypto.randomUUID()}.${extension}`
          : `${classIds[0]}/${crypto.randomUUID()}.${extension}`;
        musicxmlPath = uploadPath;
        if (addToLibrary) {
          const { data, error } = await db.from('practice_songs').insert({
            title,
            musicxml_path: uploadPath,
            difficulty: $('#teacher-library-difficulty').value,
            sort_order: 100,
            is_active: true,
            created_by: teacher.id
          }).select('id, title, musicxml_path, difficulty, sort_order, is_active, created_by').single();
          if (error) throw error;
          librarySong = data;
        }
        const { error: uploadError } = await db.storage.from('musicxml').upload(uploadPath, file, {
          upsert: false,
          contentType: file.type || (extension === 'mxl' ? 'application/zip' : 'application/xml')
        });
        if (uploadError) {
          if (librarySong) await db.from('practice_songs').delete().eq('id', librarySong.id);
          throw uploadError;
        }
      }

      const assignmentRows = classIds.map(classId => ({
        class_id: classId,
        title,
        musicxml_path: musicxmlPath,
        created_by: teacher.id
      }));
      const { error } = await db.from('assignments').insert(assignmentRows);
      if (error) {
        if (uploadPath && !librarySong) await db.storage.from('musicxml').remove([uploadPath]);
        if (librarySong) await loadPracticeSongs();
        throw error;
      }
      $('#teacher-score-file').value = '';
      $('#teacher-assignment-song').value = '';
      $('#teacher-assignment-title').value = '';
      $('#teacher-score-file-name').textContent = 'XML 또는 MXL 파일을 선택하세요';
      $('#teacher-library-optin').checked = false;
      $('#teacher-library-optin-wrap').hidden = true;
      $('#teacher-library-difficulty-wrap').hidden = true;
      selectedClassId = classIds[0];
      renderClassOptions();
      await Promise.all([loadClassDetails(selectedClassId), loadPracticeSongs()]);
      message($('#teacher-assignment-message'), librarySong
        ? `과제를 ${classIds.length}개 반에 등록하고 연습곡 보관함에도 저장했어요.`
        : `과제를 ${classIds.length}개 반에 등록했어요.`);
    } catch (error) {
      const detail = /invalid key/i.test(error.message || '')
        ? '파일 경로에 사용할 수 없는 문자가 포함되어 있어요. 안전한 파일 경로로 다시 시도해 주세요.'
        : /row-level security|permission denied/i.test(error.message || '')
          ? '저장 권한이 없어요. Supabase에서 teacher-library.sql을 실행했는지 확인해 주세요.'
          : error.message || '과제를 등록하지 못했어요.';
      message($('#teacher-assignment-message'), `과제를 등록하지 못했어요. ${detail}`, true);
    } finally {
      button.disabled = false;
    }
  }

  function handleAssignmentSongChange() {
    const song = practiceSongs.find(item => item.id === $('#teacher-assignment-song').value);
    if (!song) return;
    $('#teacher-score-file').value = '';
    $('#teacher-score-file-name').textContent = '연습곡 목록에서 선택됨';
    $('#teacher-library-optin-wrap').hidden = true;
    $('#teacher-library-difficulty-wrap').hidden = true;
    $('#teacher-library-optin').checked = false;
    $('#teacher-assignment-title').value = song.title;
  }

  function handleScoreFileChange() {
    const file = $('#teacher-score-file').files[0];
    $('#teacher-score-file-name').textContent = file?.name || 'XML 또는 MXL 파일을 선택하세요';
    $('#teacher-library-optin-wrap').hidden = !file;
    $('#teacher-library-difficulty-wrap').hidden = true;
    if (!file) return;
    $('#teacher-assignment-song').value = '';
    $('#teacher-assignment-title').value = file.name.replace(/\.(xml|musicxml|mxl)$/i, '');
    $('#teacher-library-optin').checked = false;
  }

  async function handlePracticeSongClick(event) {
    const button = event.target.closest('button[data-song-action]');
    if (!button) return;
    const song = practiceSongs.find(item => item.id === button.dataset.songId);
    const builtin = song?.created_by === null && song.musicxml_path.startsWith('builtin:');
    if (!song || (song.created_by !== teacher?.id && !builtin)) return;
    if (button.dataset.songAction === 'edit') {
      if (builtin) {
        const db = await getSupabase();
        const { data, error } = await db.from('practice_songs').insert({
          title: song.title,
          musicxml_path: song.musicxml_path,
          difficulty: song.difficulty,
          sort_order: song.sort_order,
          is_active: song.is_active,
          created_by: teacher.id
        }).select('id').single();
        if (error) {
          message($('#teacher-library-message'), error.message || '기본 연습곡 설정을 만들지 못했어요.', true);
          return;
        }
        await loadPracticeSongs();
        const editor = document.querySelector(`[data-library-song-id="${data.id}"] .teacher-song-editor`);
        if (editor) editor.hidden = false;
        message($('#teacher-library-message'), '이 기본 연습곡은 내 계정에서 따로 관리됩니다.');
        return;
      }
      const editor = button.closest('.teacher-song-item').querySelector('.teacher-song-editor');
      editor.hidden = !editor.hidden;
      return;
    }
    if (button.dataset.songAction === 'cancel') {
      button.closest('.teacher-song-editor').hidden = true;
      return;
    }
    if (button.dataset.songAction === 'toggle') {
      const db = await getSupabase();
      const result = builtin
        ? await db.from('practice_songs').insert({
          title: song.title,
          musicxml_path: song.musicxml_path,
          difficulty: song.difficulty,
          sort_order: song.sort_order,
          is_active: !song.is_active,
          created_by: teacher.id
        })
        : await db.from('practice_songs').update({ is_active: !song.is_active }).eq('id', song.id).eq('created_by', teacher.id);
      const { error } = result;
      if (error) {
        message($('#teacher-library-message'), error.message || '연습곡 공개 상태를 바꾸지 못했어요.', true);
        return;
      }
      await loadPracticeSongs();
      message($('#teacher-library-message'), builtin
        ? (song.is_active ? '이 기본 연습곡을 내 계정에서 숨겼어요. 다른 선생님 설정에는 영향이 없습니다.' : '기본 연습곡을 내 목록에 다시 표시했어요.')
        : (song.is_active ? '연습곡을 목록에서 숨겼어요. 기존 기록은 보존됩니다.' : '연습곡을 다시 목록에 표시했어요.'));
    }
  }

  async function handlePracticeSongEdit(event) {
    const form = event.target.closest('form[data-song-edit-form]');
    if (!form) return;
    event.preventDefault();
    const songId = form.dataset.songId;
    const title = form.elements.title.value.trim();
    const difficulty = form.elements.difficulty.value.trim();
    if (!title) return message($('#teacher-library-message'), '곡 이름을 입력해 주세요.', true);
    const db = await getSupabase();
    const { error } = await db.from('practice_songs').update({ title, difficulty: difficulty || null }).eq('id', songId).eq('created_by', teacher.id);
    if (error) return message($('#teacher-library-message'), error.message || '연습곡 정보를 저장하지 못했어요.', true);
    await loadPracticeSongs();
    message($('#teacher-library-message'), '연습곡 정보를 수정했어요.');
  }

  async function generateTeacherQr() {
    const classId = $('#teacher-qr-class').value;
    const classInfo = classes.find(item => item.id === classId);
    if (!classInfo) {
      message($('#teacher-qr-link'), 'QR을 만들 반을 선택해 주세요.', true);
      return;
    }
    const url = new URL('/', location.origin);
    url.searchParams.set('join', '1');
    url.searchParams.set('classId', classId);
    const qrElement = $('#teacher-qr-canvas');
    const label = $('#teacher-qr-link');
    label.textContent = url.toString();
    label.classList.add('teacher-qr-link-text');
    label.classList.remove('is-error');
    qrElement.hidden = true;
    qrElement.replaceChildren();
    if (typeof window.QRCode !== 'function') {
      message(label, 'QR 도구를 불러오지 못했어요. 링크는 복사해 사용할 수 있습니다.', true);
      return;
    }
    try {
      new window.QRCode(qrElement, {
        text: url.toString(),
        width: 144,
        height: 144,
        colorDark: '#201c38',
        colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel?.M ?? 0
      });
      qrElement.hidden = false;
    } catch {
      message(label, 'QR을 만들지 못했어요. 링크를 직접 복사해 주세요.', true);
    }
  }

  async function copyTeacherQrLink() {
    const classId = $('#teacher-qr-class').value;
    if (!classes.some(item => item.id === classId)) {
      message($('#teacher-qr-link'), 'QR을 만들 반을 선택해 주세요.', true);
      return;
    }
    const url = new URL('/', location.origin);
    url.searchParams.set('join', '1');
    url.searchParams.set('classId', classId);
    try {
      await navigator.clipboard.writeText(url.toString());
      $('#teacher-qr-link').textContent = '학생 접속 링크를 복사했어요.';
      $('#teacher-qr-link').classList.remove('is-error');
    } catch {
      $('#teacher-qr-link').textContent = url.toString();
    }
  }

  $('#teacher-login-form').addEventListener('submit', handleTeacherLogin);
  $('#teacher-signup').addEventListener('click', handleTeacherSignup);
  $('#teacher-tab-overview').addEventListener('click', () => selectTeacherTab('overview'));
  $('#teacher-tab-settings').addEventListener('click', () => selectTeacherTab('settings'));
  $('#teacher-class-form').addEventListener('submit', handleCreateClass);
  $('#teacher-repertoire-form').addEventListener('submit', handleRepertoireSubmit);
  $('#teacher-assignment-form').addEventListener('submit', handleCreateAssignment);
  $('#teacher-assignment-song').addEventListener('change', handleAssignmentSongChange);
  $('#teacher-score-file').addEventListener('change', handleScoreFileChange);
  $('#teacher-library-optin').addEventListener('change', event => {
    $('#teacher-library-difficulty-wrap').hidden = !event.target.checked;
  });
  $('#teacher-practice-song-list').addEventListener('click', handlePracticeSongClick);
  $('#teacher-practice-song-list').addEventListener('submit', handlePracticeSongEdit);
  $('#teacher-library-show-hidden').addEventListener('change', renderPracticeSongs);
  $('#teacher-qr-generate').addEventListener('click', generateTeacherQr);
  $('#teacher-qr-copy').addEventListener('click', copyTeacherQrLink);
  $('#teacher-qr-class').addEventListener('change', generateTeacherQr);
  $('#teacher-progress-class').addEventListener('change', event => selectTeacherClass(event.target.value));
  $('#teacher-logout').addEventListener('click', async () => {
    try { await (await getSupabase()).auth.signOut(); } catch {}
    teacher = null;
    selectedClassId = '';
    showAuth();
    message($('#teacher-auth-message'), '로그아웃했습니다.');
  });

  if (new URLSearchParams(location.search).get('join') !== '1') openTeacherView();
})();
