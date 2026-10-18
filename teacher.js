(() => {
  const $ = selector => document.querySelector(selector);
  const studentView = $('#student-view');
  const teacherView = $('#teacher-view');
  const studentEntryView = $('#student-entry-view');
  const studentCatalogView = $('#student-catalog-view');
  const teacherAuthPanel = $('#teacher-auth-panel');
  const teacherDashboard = $('#teacher-dashboard');
  let client = null;
  let teacher = null;
  let classes = [];
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
  }

  function updateMode(isTeacher) {
    teacherView.hidden = !isTeacher;
    if (isTeacher) {
      studentView.hidden = true;
      studentEntryView.hidden = true;
      studentCatalogView.hidden = true;
    } else if (window.studentPortal?.showCurrentView) {
      window.studentPortal.showCurrentView();
    } else {
      studentView.hidden = false;
    }
    $('#mode-label').textContent = isTeacher ? '교사 모드' : '학생 연습 모드';
    $('#teacher-mode-toggle').textContent = isTeacher ? '학생 화면' : '교사 화면';
  }

  async function openTeacherView() {
    updateMode(true);
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

  function renderClassOptions() {
    const list = $('#teacher-class-list');
    const assignmentSelect = $('#teacher-assignment-class');
    const progressSelect = $('#teacher-progress-class');
    list.replaceChildren();
    assignmentSelect.replaceChildren(new Option('반 선택', ''));
    progressSelect.replaceChildren(new Option('반 선택', ''));
    for (const item of classes) {
      const title = `${item.grade}학년 ${item.class_name}`;
      assignmentSelect.add(new Option(title, item.id));
      progressSelect.add(new Option(title, item.id));
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'teacher-class-chip';
      button.textContent = title;
      button.setAttribute('aria-pressed', String(item.id === selectedClassId));
      button.addEventListener('click', () => selectTeacherClass(item.id));
      list.append(button);
    }
    assignmentSelect.value = selectedClassId;
    progressSelect.value = selectedClassId;
    assignmentSelect.disabled = !classes.length;
    progressSelect.disabled = !classes.length;
    $('#teacher-summary-classes').textContent = classes.length;
    if (!classes.length) list.innerHTML = '<p class="teacher-empty-note">반을 등록하면 여기에 표시됩니다.</p>';
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
    await loadTeacherData();
    message($('#teacher-class-message'), '담당 반을 등록했어요.');
  }

  async function handleCreateAssignment(event) {
    event.preventDefault();
    const classId = $('#teacher-assignment-class').value;
    const file = $('#teacher-score-file').files[0];
    if (!classId || !file) return;
    message($('#teacher-assignment-message'), '악보를 업로드하고 있습니다.');
    const db = await getSupabase();
    const path = `${classId}/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await db.storage.from('musicxml').upload(path, file, {
      upsert: false,
      contentType: file.type || 'application/octet-stream'
    });
    if (uploadError) {
      message($('#teacher-assignment-message'), uploadError.message || '악보 파일을 올리지 못했어요.', true);
      return;
    }
    const title = file.name.replace(/\.(xml|musicxml|mxl)$/i, '');
    const { error } = await db.from('assignments').insert({
      class_id: classId,
      title,
      musicxml_path: path,
      created_by: teacher.id
    });
    if (error) {
      await db.storage.from('musicxml').remove([path]);
      message($('#teacher-assignment-message'), error.message || '과제를 등록하지 못했어요.', true);
      return;
    }
    $('#teacher-score-file').value = '';
    await loadClassDetails(classId);
    message($('#teacher-assignment-message'), '악보를 과제로 등록했어요.');
  }

  async function toggleTeacherMode() {
    const entering = teacherView.hidden;
    updateMode(entering);
    if (!entering) return;
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
      message($('#teacher-auth-message'), error.message || 'Supabase 연결을 확인하지 못했어요.', true);
    }
  }

  async function generateTeacherQr() {
    const grade = $('#teacher-qr-grade').value;
    const url = new URL('/', location.origin);
    url.searchParams.set('join', '1');
    url.searchParams.set('grade', grade);
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
    const grade = $('#teacher-qr-grade').value;
    const url = new URL('/', location.origin);
    url.searchParams.set('join', '1');
    url.searchParams.set('grade', grade);
    try {
      await navigator.clipboard.writeText(url.toString());
      $('#teacher-qr-link').textContent = '학생 접속 링크를 복사했어요.';
      $('#teacher-qr-link').classList.remove('is-error');
    } catch {
      $('#teacher-qr-link').textContent = url.toString();
    }
  }

  $('#teacher-mode-toggle').addEventListener('click', toggleTeacherMode);
  $('#teacher-login-form').addEventListener('submit', handleTeacherLogin);
  $('#teacher-signup').addEventListener('click', handleTeacherSignup);
  $('#teacher-class-form').addEventListener('submit', handleCreateClass);
  $('#teacher-assignment-form').addEventListener('submit', handleCreateAssignment);
  $('#teacher-qr-generate').addEventListener('click', generateTeacherQr);
  $('#teacher-qr-copy').addEventListener('click', copyTeacherQrLink);
  $('#teacher-progress-class').addEventListener('change', event => selectTeacherClass(event.target.value));
  $('#teacher-assignment-class').addEventListener('change', event => selectTeacherClass(event.target.value));
  $('#teacher-logout').addEventListener('click', async () => {
    try { await (await getSupabase()).auth.signOut(); } catch {}
    teacher = null;
    selectedClassId = '';
    showAuth();
    message($('#teacher-auth-message'), '로그아웃했습니다.');
  });
})();
