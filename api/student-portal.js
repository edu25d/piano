const UUID_RE = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;

function reply(res, status, data) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(data);
}

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw Object.assign(new Error('server_configuration_missing'), { status: 503 });
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  return { url, headers };
}

async function db(path, options = {}) {
  const { url, headers } = config();
  const response = await fetch(`${url}${path}`, {
    method: options.method || 'GET',
    headers: { ...headers, ...(options.prefer ? { Prefer: options.prefer } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(data?.message || 'database_request_failed'), { status: response.status });
  return data;
}

function validId(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

async function studentFor(studentId) {
  if (!validId(studentId)) throw Object.assign(new Error('invalid_student'), { status: 400 });
  const rows = await db(`/rest/v1/students?id=eq.${studentId}&select=id,class_id,display_name&limit=1`);
  if (!rows?.length) throw Object.assign(new Error('student_not_found'), { status: 404 });
  return rows[0];
}

async function teacherIdsForClass(classId) {
  const links = await db(`/rest/v1/teacher_classes?class_id=eq.${classId}&select=teacher_id`);
  return [...new Set((links || []).map(link => link.teacher_id))];
}

async function getSignedScore(path) {
  const { url } = config(), encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const signed = await db(`/storage/v1/object/sign/musicxml/${encodedPath}`, { method: 'POST', body: { expiresIn: 3600 } });
  return signed.signedURL?.startsWith('http') ? signed.signedURL : `${url}/storage/v1${signed.signedURL}`;
}

async function getRequest(req, res) {
  const action = req.query?.action;
  if (action === 'classes') {
    const grade = Number(req.query?.grade);
    if (!Number.isInteger(grade) || grade < 1 || grade > 12) return reply(res, 400, { error: 'invalid_grade' });
    const classes = await db(`/rest/v1/classes?grade=eq.${grade}&select=id,grade,class_name&order=class_name`);
    return reply(res, 200, { classes: classes || [] });
  }

  if (action === 'catalog') {
    const student = await studentFor(req.query?.studentId);
    const [assignments, practiceSongs, attempts, teacherIds] = await Promise.all([
      db(`/rest/v1/assignments?class_id=eq.${student.class_id}&is_active=eq.true&select=id,title,created_at&order=created_at.desc`),
      db('/rest/v1/practice_songs?is_active=eq.true&select=id,title,musicxml_path,difficulty,sort_order,created_by&order=sort_order.asc'),
      db(`/rest/v1/practice_attempts?student_id=eq.${student.id}&select=id,assignment_id,practice_song_id,current_note_index,total_notes,correct_count,incorrect_count,status,updated_at&order=updated_at.desc`),
      teacherIdsForClass(student.class_id)
    ]);
    const visibleSongs = (practiceSongs || []).filter(song =>
      (song.created_by && teacherIds.includes(song.created_by)) || (!song.created_by && song.musicxml_path.startsWith('builtin:'))
    );
    return reply(res, 200, { student, assignments: assignments || [], practiceSongs: visibleSongs, attempts: attempts || [] });
  }

  if (action === 'score') {
    const student = await studentFor(req.query?.studentId), resourceId = req.query?.resourceId, type = req.query?.type;
    if (!validId(resourceId) || !['assignment', 'practice'].includes(type)) return reply(res, 400, { error: 'invalid_resource' });
    const table = type === 'assignment' ? 'assignments' : 'practice_songs';
    const filter = type === 'assignment' ? `id=eq.${resourceId}&class_id=eq.${student.class_id}&is_active=eq.true` : `id=eq.${resourceId}&is_active=eq.true`;
    const rows = await db(`/rest/v1/${table}?${filter}&select=id,title,musicxml_path,created_by&limit=1`);
    if (!rows?.length) return reply(res, 404, { error: 'score_not_found' });
    const score = rows[0];
    if (type === 'practice' && ((score.created_by && !(await teacherIdsForClass(student.class_id)).includes(score.created_by)) || (!score.created_by && !score.musicxml_path.startsWith('builtin:')))) return reply(res, 404, { error: 'score_not_found' });
    if (score.musicxml_path.startsWith('builtin:')) return reply(res, 200, { title: score.title, builtin: score.musicxml_path });
    return reply(res, 200, { title: score.title, scoreUrl: await getSignedScore(score.musicxml_path), isMxl: /\.mxl$/i.test(score.musicxml_path) });
  }

  return reply(res, 400, { error: 'unknown_action' });
}

async function joinStudent(body, res) {
  const classId = body.classId, displayName = String(body.displayName || '').trim();
  if (!validId(classId) || !displayName || displayName.length > 40) return reply(res, 400, { error: 'invalid_student' });
  const classes = await db(`/rest/v1/classes?id=eq.${classId}&select=id,grade,class_name&limit=1`);
  if (!classes?.length) return reply(res, 404, { error: 'class_not_found' });
  const students = await db('/rest/v1/students?on_conflict=class_id,display_name', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: { class_id: classId, display_name: displayName, last_seen_at: new Date().toISOString() }
  });
  if (!students?.length) return reply(res, 500, { error: 'student_save_failed' });
  return reply(res, 200, { student: students[0], class: classes[0] });
}

async function startAttempt(body, res) {
  const { studentId, resourceId, type, noteSequence, forceNew } = body;
  if (!validId(studentId) || !validId(resourceId) || !['assignment', 'practice'].includes(type)) return reply(res, 400, { error: 'invalid_attempt' });
  if (!Array.isArray(noteSequence) || noteSequence.length < 1 || noteSequence.length > 5000 || noteSequence.some(midi => !Number.isInteger(midi) || midi < 21 || midi > 108)) return reply(res, 400, { error: 'invalid_note_sequence' });
  const student = await studentFor(studentId), table = type === 'assignment' ? 'assignments' : 'practice_songs';
  const resourceFilter = type === 'assignment' ? `id=eq.${resourceId}&class_id=eq.${student.class_id}&is_active=eq.true` : `id=eq.${resourceId}&is_active=eq.true`;
  const resources = await db(`/rest/v1/${table}?${resourceFilter}&select=id,created_by,musicxml_path&limit=1`);
  if (!resources?.length) return reply(res, 404, { error: 'resource_not_found' });
  if (type === 'practice' && ((resources[0].created_by && !(await teacherIdsForClass(student.class_id)).includes(resources[0].created_by)) || (!resources[0].created_by && !resources[0].musicxml_path.startsWith('builtin:')))) return reply(res, 404, { error: 'resource_not_found' });
  const relation = type === 'assignment' ? `assignment_id=eq.${resourceId}&practice_song_id=is.null` : `practice_song_id=eq.${resourceId}&assignment_id=is.null`;
  if (!forceNew) {
    const open = await db(`/rest/v1/practice_attempts?student_id=eq.${studentId}&${relation}&status=eq.in_progress&select=id,student_id,assignment_id,practice_song_id,current_note_index,total_notes,note_midi_sequence,correct_count,incorrect_count,status&order=updated_at.desc&limit=1`);
    if (open?.length) return reply(res, 200, { attempt: open[0], resumed: true });
  }
  const attempts = await db('/rest/v1/practice_attempts', {
    method: 'POST',
    prefer: 'return=representation',
    body: { student_id: studentId, assignment_id: type === 'assignment' ? resourceId : null, practice_song_id: type === 'practice' ? resourceId : null, current_note_index: 0, total_notes: noteSequence.length, note_midi_sequence: noteSequence, correct_count: 0, incorrect_count: 0, status: 'in_progress' }
  });
  return reply(res, 200, { attempt: attempts?.[0], resumed: false });
}

async function saveAnswer(body, res) {
  const { studentId, attemptId, noteIndex, playedMidi, clientEventId } = body;
  if (!validId(studentId) || !validId(attemptId) || !validId(clientEventId) || !Number.isInteger(noteIndex) || !Number.isInteger(playedMidi)) return reply(res, 400, { error: 'invalid_answer' });
  const duplicate = await db(`/rest/v1/answer_events?client_event_id=eq.${clientEventId}&select=is_correct&limit=1`);
  if (duplicate?.length) return reply(res, 200, { saved: true, correct: duplicate[0].is_correct, duplicate: true });
  const attempts = await db(`/rest/v1/practice_attempts?id=eq.${attemptId}&student_id=eq.${studentId}&select=id,current_note_index,total_notes,note_midi_sequence,correct_count,incorrect_count,status&limit=1`);
  if (!attempts?.length) return reply(res, 404, { error: 'attempt_not_found' });
  const attempt = attempts[0];
  if (attempt.status !== 'in_progress' || attempt.current_note_index !== noteIndex || noteIndex >= attempt.total_notes) return reply(res, 409, { error: 'attempt_out_of_sync', currentNoteIndex: attempt.current_note_index });
  const targetMidi = attempt.note_midi_sequence[noteIndex], correct = playedMidi === targetMidi;
  const previous = await db(`/rest/v1/answer_events?attempt_id=eq.${attemptId}&note_index=eq.${noteIndex}&select=try_number&order=try_number.desc&limit=1`);
  await db('/rest/v1/answer_events', { method: 'POST', prefer: 'return=minimal', body: { attempt_id: attemptId, note_index: noteIndex, try_number: (previous?.[0]?.try_number || 0) + 1, client_event_id: clientEventId, target_midi: targetMidi, played_midi: playedMidi, is_correct: correct } });
  const nextIndex = correct ? noteIndex + 1 : noteIndex, completed = nextIndex >= attempt.total_notes;
  await db(`/rest/v1/practice_attempts?id=eq.${attemptId}&student_id=eq.${studentId}`, { method: 'PATCH', prefer: 'return=minimal', body: { current_note_index: nextIndex, correct_count: attempt.correct_count + Number(correct), incorrect_count: attempt.incorrect_count + Number(!correct), status: completed ? 'completed' : 'in_progress', updated_at: new Date().toISOString(), ...(completed ? { completed_at: new Date().toISOString() } : {}) } });
  return reply(res, 200, { saved: true, correct, currentNoteIndex: nextIndex, completed });
}

module.exports = async function studentPortal(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') return await getRequest(req, res);
    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.action === 'join') return await joinStudent(body, res);
      if (body.action === 'start') return await startAttempt(body, res);
      if (body.action === 'answer') return await saveAnswer(body, res);
    }
    res.setHeader('Allow', 'GET, POST');
    return reply(res, 405, { error: 'method_not_allowed' });
  } catch (error) {
    return reply(res, error.status || 500, { error: error.message || 'request_failed' });
  }
};
