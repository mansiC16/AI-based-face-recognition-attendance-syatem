// server.js — Enrollment-driven attendance backend (drop-in)
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json({ limit: '6mb' }));
app.use(cors());

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
}).promise();

/* ------------------------------------------------------------------
   SCHEMA (non-destructive): attendance, faces, and NEW enrollments
------------------------------------------------------------------- */
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS attendance_sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      class_id INT NOT NULL,
      subject_id INT NOT NULL,
      teacher_id INT NOT NULL,
      started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      active TINYINT(1) NOT NULL DEFAULT 1,
      INDEX (class_id), INDEX (subject_id), INDEX (teacher_id), INDEX (active)
    )`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS attendance_marks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      session_id INT NOT NULL,
      student_id INT NOT NULL,
      subject_id INT NOT NULL,
      date DATE NOT NULL,
      status ENUM('Present','Absent') NOT NULL DEFAULT 'Present',
      marked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_mark (session_id, student_id),
      INDEX (student_id), INDEX (subject_id), INDEX (date)
    )`);

  // If your DB already has VARBINARY(2048) this will be a no-op
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_faces (
      student_id INT PRIMARY KEY,
      embedding LONGBLOB NOT NULL,
      model VARCHAR(64) DEFAULT 'insightface_arcface',
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);

  // NEW: who is enrolled to which class+subject (one row per subject)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_enrollments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      student_id INT NOT NULL,
      class_id INT NOT NULL,
      subject_id INT NOT NULL,
      enrolled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_student_subject (student_id, subject_id),
      INDEX (class_id), INDEX (student_id), INDEX (subject_id)
    )`);
}
ensureSchema().catch(console.error);

/* ------------------------------------------------------------------
   Vector helpers for face embeddings (tolerant to legacy JSON rows)
------------------------------------------------------------------- */
const toFloat32 = (arr) => Float32Array.from(arr.map(Number));
const l2norm = (v) => {
  let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  s = Math.sqrt(s) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / s;
  return out;
};
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

const bufToFloat32Array = (buf) => {
  const out = new Float32Array(512);
  for (let i = 0; i < 512; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
};
const decodeRowEmbedding = (row) => {
  const e = row?.embedding;
  if (!e) return null;
  if (Buffer.isBuffer(e)) return bufToFloat32Array(e);
  if (typeof e === 'string') {
    try {
      const arr = JSON.parse(e);
      if (Array.isArray(arr) && arr.length === 512) return toFloat32(arr);
    } catch {}
  }
  return null;
};
const encodeToBlob = (arr) => {
  const buf = Buffer.alloc(512 * 4);
  for (let i = 0; i < 512; i++) buf.writeFloatLE(Number(arr[i] || 0), i * 4);
  return buf;
};

/* ------------------------------------------------------------------
   AUTH (unchanged)
------------------------------------------------------------------- */
app.post('/api/login', async (req, res) => {
  const { email, password, role } = req.body;

  if (role === 'Admin' && email === 'admin@school.edu') {
    return res.json({ email: 'admin@school.edu', role: 'Admin' });
  }
  if (role === 'Student') {
    try {
      const [[s]] = await pool.query(
        'SELECT id,name,email,password FROM students WHERE email=?',
        [email]
      );
      if (!s || s.password !== password) return res.status(401).json({ error: 'Invalid student credentials' });
      return res.json({ id: s.id, email: s.email, name: s.name, role: 'Student' });
    } catch {
      return res.status(500).json({ error: 'Database error during student login' });
    }
  }
  if (role === 'Teacher') {
    try {
      const [[t]] = await pool.query('SELECT * FROM teachers WHERE email=?', [email]);
      if (!t) return res.status(401).json({ error: 'Invalid credentials or role mismatch' });
      return res.json({ email: t.email, name: t.name, role: 'Teacher' });
    } catch {
      return res.status(500).json({ error: 'Database error during login' });
    }
  }
  return res.status(401).json({ error: 'Invalid credentials' });
});

/* ------------------------------------------------------------------
   TEACHER DASHBOARD (kept)
------------------------------------------------------------------- */
app.get('/api/teacher-dashboard/:email', async (req, res) => {
  try {
    const [[t]] = await pool.query('SELECT id FROM teachers WHERE email=?', [req.params.email]);
    if (!t) return res.status(404).json({ error: 'Teacher not found' });
    const [assignedClasses] = await pool.query(
      `SELECT c.id AS classId, c.name AS className, c.strength,
              s.id AS subjectId, s.name AS subjectName
       FROM subjects s
       JOIN classes c ON s.class_id=c.id
       WHERE s.teacher_id=?`,
      [t.id]
    );
    const totalStudents = assignedClasses.reduce((a, c) => a + c.strength, 0);
    res.json({ assignedClasses, totalStudents });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ------------------------------------------------------------------
   CLASSES + TEACHERS (kept)
------------------------------------------------------------------- */
app.get('/classes', async (_req, res) => {
  try {
    const [classes] = await pool.query('SELECT * FROM classes');
    for (let cls of classes) {
      [cls.subjects] = await pool.query(
        'SELECT s.id, s.name, s.teacher_id, t.name AS teacher_name FROM subjects s LEFT JOIN teachers t ON s.teacher_id=t.id WHERE s.class_id=?',
        [cls.id]
      );
    }
    res.json(classes);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/classes', async (req, res) => {
  const { name, strength, subjects } = req.body;
  try {
    const [r] = await pool.query('INSERT INTO classes (name, strength) VALUES (?,?)', [name, strength]);
    const classId = r.insertId;
    for (const sub of (subjects || [])) {
      if (!sub.teacher_id) continue;
      await pool.query('INSERT INTO subjects (name, class_id, teacher_id) VALUES (?,?,?)', [sub.name, classId, sub.teacher_id]);
    }
    const [[row]] = await pool.query('SELECT * FROM classes WHERE id=?', [classId]);
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/classes/:id', async (req, res) => {
  const { id } = req.params;
  const { name, strength, subjects } = req.body;
  try {
    await pool.query('UPDATE classes SET name=?, strength=? WHERE id=?', [name, strength, id]);
    await pool.query('DELETE FROM subjects WHERE class_id=?', [id]);
    for (const sub of (subjects || [])) {
      if (!sub.teacher_id) continue;
      await pool.query('INSERT INTO subjects (name, class_id, teacher_id) VALUES (?,?,?)', [sub.name, id, sub.teacher_id]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/classes/:id', async (req, res) => {
  try { await pool.query('DELETE FROM classes WHERE id=?', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/teachers', async (_req, res) => {
  try { const [rows] = await pool.query('SELECT * FROM teachers'); res.json(rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/teachers', async (req, res) => {
  const { name, email } = req.body;
  try {
    const [r] = await pool.query('INSERT INTO teachers (name,email) VALUES (?,?)', [name, email]);
    const [[row]] = await pool.query('SELECT * FROM teachers WHERE id=?', [r.insertId]);
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ------------------------------------------------------------------
   STUDENTS (register, finish first login, subjects)
------------------------------------------------------------------- */
app.post('/api/students/register', async (req, res) => {
  const { name, roll_no, email, password } = req.body;
  try {
    if (!name || !roll_no || !email || !password) {
      return res.status(400).json({ error: 'name, roll_no, email, password are required' });
    }
    await pool.query(
      'INSERT INTO students (name, roll_no, email, password, class_id, first_login) VALUES (?,?,?,?,NULL,1)',
      [name, roll_no, email, password]
    );
    res.status(201).json({ success: true });
  } catch (e) {
    if (e?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email or Roll No already registered' });
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.get('/api/students/me', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'email is required' });
    const [[row]] = await pool.query(
      'SELECT id,name,email,class_id,first_login FROM students WHERE email=?',
      [email]
    );
    if (!row) return res.status(404).json({ error: 'Student not found' });
    res.json(row);
  } catch { res.status(500).json({ error: 'Failed to load student profile' }); }
});

/**
 * First-time class selection:
 * - lock capacity & set students.class_id, first_login=0
 * - auto-enroll the student into ALL subjects under that class (student_enrollments)
 */
app.post('/api/students/select-class', async (req, res) => {
  const { student_id, class_id } = req.body;
  if (!student_id || !class_id) return res.status(400).json({ error: 'student_id and class_id are required' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[cls]] = await conn.query('SELECT id,name,strength FROM classes WHERE id=? FOR UPDATE', [class_id]);
    if (!cls) { await conn.rollback(); conn.release(); return res.status(404).json({ error: 'Class not found' }); }

    const [[st]] = await conn.query('SELECT id,first_login,class_id FROM students WHERE id=? FOR UPDATE', [student_id]);
    if (!st) { await conn.rollback(); conn.release(); return res.status(404).json({ error: 'Student not found' }); }
    if (st.first_login === 0 || st.class_id) { await conn.rollback(); conn.release(); return res.status(400).json({ error: 'Class selection already completed' }); }

    const [[cnt]] = await conn.query('SELECT COUNT(*) AS enrolled FROM students WHERE class_id=?', [class_id]);
    if ((cnt.enrolled || 0) >= cls.strength) { await conn.rollback(); conn.release(); return res.status(409).json({ error: 'Class is full. Please select a different class.' }); }

    // set class for student
    await conn.query('UPDATE students SET class_id=?, first_login=0 WHERE id=?', [class_id, student_id]);

    // auto-enroll into ALL subjects for that class
    await conn.query(
      `INSERT IGNORE INTO student_enrollments (student_id, class_id, subject_id)
       SELECT ?, s.class_id, s.id
       FROM subjects s
       WHERE s.class_id = ?`,
      [student_id, class_id]
    );

    await conn.commit(); conn.release();

    // return subjects (enrolled list)
    const [subjects] = await pool.query(
      `SELECT s.id, s.name, t.name AS teacher_name
       FROM subjects s
       LEFT JOIN teachers t ON s.teacher_id=t.id
       WHERE s.class_id=?
       ORDER BY s.id ASC`,
      [class_id]
    );
    res.json({ success: true, class: { id: cls.id, name: cls.name, strength: cls.strength }, subjects });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    conn.release();
    res.status(500).json({ error: 'Failed to select class' });
  }
});

/**
 * Student subjects: return ONLY subjects the student is enrolled in
 */
app.get('/api/students/:id/subjects', async (req, res) => {
  try {
    const studentId = req.params.id;
    const [[st]] = await pool.query('SELECT class_id FROM students WHERE id=?', [studentId]);
    if (!st) return res.status(404).json({ error: 'Student not found' });
    if (!st.class_id) return res.json({ subjects: [] });

    const [subjects] = await pool.query(
      `SELECT s.id, s.name, t.name AS teacher_name
       FROM student_enrollments se
       JOIN subjects s ON s.id = se.subject_id
       LEFT JOIN teachers t ON t.id = s.teacher_id
       WHERE se.student_id = ?
       ORDER BY s.id ASC`,
      [studentId]
    );
    res.json({ subjects, class_id: st.class_id });
  } catch { res.status(500).json({ error: 'Failed to load subjects' }); }
});

/* ------------------------------------------------------------------
   CLASSES with stats (kept)
------------------------------------------------------------------- */
app.get('/classes/with-stats', async (_req, res) => {
  try {
    const [classes] = await pool.query('SELECT id,name,strength FROM classes ORDER BY id ASC');
    const [counts]  = await pool.query('SELECT class_id,COUNT(*) enrolled_count FROM students WHERE class_id IS NOT NULL GROUP BY class_id');
    const m = new Map(counts.map(r => [r.class_id, r.enrolled_count]));
    res.json(classes.map(c => ({ ...c, enrolled_count: m.get(c.id) || 0, seats_left: Math.max(0, c.strength - (m.get(c.id) || 0)) })));
  } catch { res.status(500).json({ error: 'Failed to load classes' }); }
});

/* ------------------------------------------------------------------
   FACE APIs (robust; allow re-register for same student)
------------------------------------------------------------------- */
app.post('/api/student-faces/save', async (req, res) => {
  try {
    const { student_id, embedding } = req.body;
    if (!student_id || !Array.isArray(embedding) || embedding.length !== 512)
      return res.status(400).json({ error: 'Invalid payload (need student_id and 512-length embedding array)' });

    const incoming = l2norm(toFloat32(embedding));

    // prevent collisions with *other* students
    const [others] = await pool.query('SELECT student_id, embedding FROM student_faces WHERE student_id <> ?', [student_id]);
    const THRESHOLD = 0.60;
    for (const row of others) {
      const stored = decodeRowEmbedding(row);
      if (!stored) continue;
      const sim = dot(incoming, l2norm(stored));
      if (sim >= THRESHOLD) return res.status(409).json({ error: 'This face is already registered to another student' });
    }

    const buf = encodeToBlob(incoming);
    await pool.query(
      `INSERT INTO student_faces (student_id, embedding, model)
       VALUES (?, ?, 'insightface_arcface')
       ON DUPLICATE KEY UPDATE embedding=VALUES(embedding), model=VALUES(model), updated_at=CURRENT_TIMESTAMP`,
      [student_id, buf]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to save embedding' }); }
});

app.get('/api/student-faces/has', async (req, res) => {
  const { student_id } = req.query;
  if (!student_id) return res.status(400).json({ error: 'student_id is required' });
  const [[row]] = await pool.query('SELECT 1 FROM student_faces WHERE student_id=? LIMIT 1', [student_id]);
  res.json({ has_face: !!row });
});

app.get('/api/student-faces/embedding', async (req, res) => {
  const { student_id } = req.query;
  if (!student_id) return res.status(400).json({ error: 'student_id required' });
  const [[row]] = await pool.query('SELECT embedding FROM student_faces WHERE student_id=?', [student_id]);
  if (!row) return res.json({ student_id, embedding: null });
  const floats = decodeRowEmbedding(row);
  res.json({ student_id, embedding: floats ? Array.from(floats) : null });
});

app.get('/api/student-faces/:student_id', async (req, res) => {
  const include = String(req.query.include || '').toLowerCase();
  const [[row]] = await pool.query('SELECT embedding, model, updated_at FROM student_faces WHERE student_id=?', [req.params.student_id]);
  if (!row) return res.json({ student_id: req.params.student_id, embedding: null, model: null, updated_at: null });
  const base = { student_id: req.params.student_id, model: row.model, updated_at: row.updated_at };
  if (include === 'embedding' || include === '1' || include === 'true') {
    const floats = decodeRowEmbedding(row);
    return res.json({ ...base, embedding: floats ? Array.from(floats) : null });
  }
  return res.json(base);
});

/* ------------------------------------------------------------------
   ATTENDANCE (driven by student_enrollments)
------------------------------------------------------------------- */
// Start a session for a given class+subject
app.post('/api/attendance/start', async (req, res) => {
  const { class_id, subject_id, teacher_email } = req.body;
  if (!class_id || !subject_id || !teacher_email) return res.status(400).json({ error: 'class_id, subject_id, teacher_email required' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[t]] = await conn.query('SELECT id FROM teachers WHERE email=?', [teacher_email]);
    if (!t) { await conn.rollback(); conn.release(); return res.status(404).json({ error: 'Teacher not found' }); }

    // only 1 active per class+subject
    await conn.query('UPDATE attendance_sessions SET active=0 WHERE class_id=? AND subject_id=? AND active=1', [class_id, subject_id]);
    const [ins] = await conn.query(
      'INSERT INTO attendance_sessions (class_id, subject_id, teacher_id, active) VALUES (?,?,?,1)',
      [class_id, subject_id, t.id]
    );
    const [[session]] = await conn.query('SELECT * FROM attendance_sessions WHERE id=?', [ins.insertId]);
    await conn.commit(); conn.release();
    res.json({ session });
  } catch {
    try { await conn.rollback(); } catch {}
    conn.release();
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// End/close a session
app.post('/api/attendance/close', async (req, res) => {
  const { session_id, teacher_email } = req.body;
  if (!session_id || !teacher_email) return res.status(400).json({ error: 'session_id and teacher_email required' });
  try {
    const [[t]] = await pool.query('SELECT id FROM teachers WHERE email=?', [teacher_email]);
    if (!t) return res.status(404).json({ error: 'Teacher not found' });
    const [r] = await pool.query('UPDATE attendance_sessions SET active=0 WHERE id=? AND teacher_id=? AND active=1', [session_id, t.id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Active session not found' });
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to close session' }); }
});

// Student: which active sessions can they see? (only if enrolled to subject)
app.get('/api/attendance/active-by-student', async (req, res) => {
  const { student_id } = req.query;
  if (!student_id) return res.status(400).json({ error: 'student_id required' });
  try {
    const [rows] = await pool.query(
      `SELECT s.*
         FROM student_enrollments se
         JOIN attendance_sessions s
           ON s.class_id = se.class_id
          AND s.subject_id = se.subject_id
        WHERE se.student_id = ?
          AND s.active = 1`,
      [student_id]
    );
    res.json({ sessions: rows });
  } catch { res.status(500).json({ error: 'Failed to load active sessions' }); }
});

// Mark attendance (only if enrolled to that class+subject)
app.post('/api/attendance/mark', async (req, res) => {
  const { student_id, subject_id, session_id } = req.body;
  if (!student_id || !subject_id || !session_id) return res.status(400).json({ error: 'student_id, subject_id, session_id required' });

  try {
    const [[session]] = await pool.query('SELECT id,class_id,subject_id,active,started_at FROM attendance_sessions WHERE id=?', [session_id]);
    if (!session || !session.active) return res.status(400).json({ error: 'Session not active' });

    // ensure the student is enrolled to THIS class+subject
    const [[en]] = await pool.query(
      'SELECT class_id FROM student_enrollments WHERE student_id=? AND subject_id=?',
      [student_id, subject_id]
    );
    if (!en || en.class_id !== session.class_id) return res.status(400).json({ error: 'Student not enrolled for this subject' });

    const date = new Date(session.started_at).toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO attendance_marks (session_id, student_id, subject_id, date, status)
       VALUES (?,?,?,?,'Present')
       ON DUPLICATE KEY UPDATE status=VALUES(status), marked_at=CURRENT_TIMESTAMP`,
      [session_id, student_id, subject_id, date]
    );

    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to mark attendance' }); }
});

// Student history (only for subjects they are enrolled in)
app.get('/api/attendance/student-history', async (req, res) => {
  const { student_id, subject_id } = req.query;
  if (!student_id || !subject_id) return res.status(400).json({ error: 'student_id, subject_id required' });

  try {
    // Use enrollment to find the class and restrict sessions
    const [[en]] = await pool.query(
      'SELECT class_id FROM student_enrollments WHERE student_id=? AND subject_id=?',
      [student_id, subject_id]
    );
    if (!en) return res.json({ rows: [] });

    const [rows] = await pool.query(
      `SELECT DATE(s.started_at) AS date,
              IF(am.id IS NULL,'Absent','Present') AS status
         FROM attendance_sessions s
    LEFT JOIN attendance_marks am
           ON am.session_id = s.id AND am.student_id = ?
        WHERE s.class_id = ?
          AND s.subject_id = ?
        ORDER BY s.started_at DESC
        LIMIT 60`,
      [student_id, en.class_id, subject_id]
    );
    res.json({ rows });
  } catch { res.status(500).json({ error: 'Failed to load history' }); }
});

// Teacher view: only students enrolled to THIS class+subject
app.get('/api/attendance/teacher-history', async (req, res) => {
  const { class_id, subject_id } = req.query;
  if (!class_id || !subject_id) return res.status(400).json({ error: 'class_id, subject_id required' });

  try {
    const [rows] = await pool.query(
      `SELECT st.id AS student_id,
              st.name AS student_name,
              DATE(s.started_at) AS date,
              IF(am.id IS NULL,'Absent','Present') AS status
         FROM attendance_sessions s
         JOIN student_enrollments se
           ON se.class_id = s.class_id
          AND se.subject_id = s.subject_id
         JOIN students st
           ON st.id = se.student_id
    LEFT JOIN attendance_marks am
           ON am.session_id = s.id AND am.student_id = st.id
        WHERE s.class_id = ?
          AND s.subject_id = ?
        ORDER BY s.started_at DESC, st.name ASC
        LIMIT 1000`,
      [class_id, subject_id]
    );
    res.json({ rows });
  } catch { res.status(500).json({ error: 'Failed to load teacher attendance view' }); }
});

/* ------------------------------------------------------------------
   START SERVER
------------------------------------------------------------------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
