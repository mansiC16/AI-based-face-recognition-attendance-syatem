// server.js – Enrollment-driven attendance backend (drop-in)
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');

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
   EMAIL VALIDATION using Hunter.io
------------------------------------------------------------------- */
async function validateEmailWithHunter(email) {
  try {
    const apiKey = process.env.HUNTER_API_KEY;
    if (!apiKey) {
      console.warn('Hunter API key not configured, skipping email validation');
      return { valid: true, message: 'Validation skipped' };
    }

    const response = await axios.get('https://api.hunter.io/v2/email-verifier', {
      params: {
        email: email,
        api_key: apiKey
      },
      timeout: 5000
    });

    const data = response.data?.data;
    
    if (!data) {
      return { valid: false, message: 'Unable to validate email' };
    }

    // Hunter.io status values: valid, invalid, accept_all, webmail, disposable, unknown
    const status = data.status;
    const score = data.score || 0;

    // Reject invalid, disposable, or very low score emails
    if (status === 'invalid') {
      return { valid: false, message: 'Email address is invalid' };
    }

    if (status === 'disposable') {
      return { valid: false, message: 'Disposable email addresses are not allowed' };
    }

    // Accept valid, accept_all, and webmail with reasonable scores
    if (status === 'valid' || status === 'accept_all' || status === 'webmail') {
      if (score >= 30) {
        return { valid: true, message: 'Email validated successfully' };
      } else {
        return { valid: false, message: 'Email has low deliverability score' };
      }
    }

    // For 'unknown' status, check score
    if (status === 'unknown') {
      if (score >= 50) {
        return { valid: true, message: 'Email validated with acceptable score' };
      } else {
        return { valid: false, message: 'Unable to verify email validity' };
      }
    }

    return { valid: false, message: 'Email verification inconclusive' };

  } catch (error) {
    console.error('Hunter.io validation error:', error.message);
    
    // If API fails, allow registration but log the error
    if (error.response?.status === 429) {
      return { valid: true, message: 'Validation rate limit reached, proceeding without validation' };
    }
    
    return { valid: true, message: 'Validation service unavailable, proceeding without validation' };
  }
}

/* ------------------------------------------------------------------
   SCHEMA (non-destructive): attendance, faces, and NEW enrollments
------------------------------------------------------------------- */
async function ensureSchema() {

   await pool.query(`
    CREATE TABLE IF NOT EXISTS teacher_faces (
      teacher_id INT PRIMARY KEY,
      embedding LONGBLOB NOT NULL,
      model VARCHAR(64) DEFAULT 'insightface_arcface',
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    
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

/* ------------------------------------------------------------------
   ADMIN: Create student with class assignment + EMAIL VALIDATION
------------------------------------------------------------------- */
app.post('/api/students/admin-register', async (req, res) => {
  const { name, roll_no, email, password, class_id } = req.body;
  
  console.log('Received registration request:', { name, roll_no, email, class_id });
  
  // Validate all fields
  if (!name || !roll_no || !email || !password || !class_id) {
    console.error('Missing required fields');
    return res.status(400).json({ error: 'All fields are required' });
  }

  // Prevent using admin email for students
  if (email.toLowerCase() === 'admin@school.edu') {
    return res.status(400).json({ error: 'Cannot use admin email for student registration' });
  }

  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // Validate email with Hunter.io
  console.log('Validating email with Hunter.io:', email);
  const emailValidation = await validateEmailWithHunter(email);
  
  if (!emailValidation.valid) {
    console.error('Email validation failed:', emailValidation.message);
    return res.status(400).json({ error: emailValidation.message });
  }
  
  console.log('Email validation passed:', emailValidation.message);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Check if class exists and get its capacity
    const [[cls]] = await conn.query('SELECT id, strength FROM classes WHERE id=? FOR UPDATE', [class_id]);
    if (!cls) {
      console.error('Class not found:', class_id);
      await conn.rollback();
      conn.release();
      return res.status(404).json({ error: 'Class not found' });
    }

    // Check class capacity
    const [[cnt]] = await conn.query('SELECT COUNT(*) AS enrolled FROM students WHERE class_id=?', [class_id]);
    console.log('Class capacity check:', { enrolled: cnt.enrolled, strength: cls.strength });
    
    if ((cnt.enrolled || 0) >= cls.strength) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({ error: 'Class is full' });
    }

    // Insert student with class assigned
    console.log('Inserting student...');
    const [result] = await conn.query(
      'INSERT INTO students (name, roll_no, email, password, class_id, first_login) VALUES (?,?,?,?,?,0)',
      [name, roll_no, email, password, class_id]
    );

    const student_id = result.insertId;
    console.log('Student inserted with ID:', student_id);

    // Get all subjects for this class
    const [subjects] = await conn.query('SELECT id FROM subjects WHERE class_id = ?', [class_id]);
    console.log('Found subjects for class:', subjects.length);

    if (subjects.length > 0) {
      // Auto-enroll into all subjects of that class
      await conn.query(
        `INSERT IGNORE INTO student_enrollments (student_id, class_id, subject_id)
         SELECT ?, ?, id
         FROM subjects
         WHERE class_id = ?`,
        [student_id, class_id, class_id]
      );
      console.log('Student enrolled in subjects');
    } else {
      console.warn('No subjects found for class:', class_id);
    }

    await conn.commit();
    conn.release();
    
    console.log('Student registration successful:', student_id);
    res.status(201).json({ success: true, student_id, message: 'Student added successfully' });
    
  } catch (e) {
    try { await conn.rollback(); } catch {}
    conn.release();
    
    console.error('Admin register error details:', {
      code: e.code,
      message: e.message,
      sqlMessage: e.sqlMessage,
      sql: e.sql
    });
    
    if (e?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Email or Roll No already exists' });
    }
    
    res.status(500).json({ 
      error: 'Registration failed: ' + (e.sqlMessage || e.message || 'Unknown error')
    });
  }
});

/* ------------------------------------------------------------------
   Get all students (for admin dashboard)
------------------------------------------------------------------- */
app.get('/api/students/all', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.roll_no, s.name, s.email, s.class_id, c.name AS class_name
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       ORDER BY s.roll_no ASC`
    );
    res.json(rows);
  } catch (e) {
    console.error('Error fetching students:', e);
    res.status(500).json({ error: 'Failed to load students' });
  }
});

/* ------------------------------------------------------------------
   Delete student
------------------------------------------------------------------- */
app.delete('/api/students/:id', async (req, res) => {
  const studentId = req.params.id;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    
    // Delete related records first
    await conn.query('DELETE FROM student_enrollments WHERE student_id=?', [studentId]);
    await conn.query('DELETE FROM attendance_marks WHERE student_id=?', [studentId]);
    await conn.query('DELETE FROM student_faces WHERE student_id=?', [studentId]);
    await conn.query('DELETE FROM students WHERE id=?', [studentId]);
    
    await conn.commit();
    conn.release();
    res.json({ success: true });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    conn.release();
    console.error('Error deleting student:', e);
    res.status(500).json({ error: 'Failed to delete student' });
  }
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

/* ------------------------------------------------------------------
   CREATE TEACHER + EMAIL VALIDATION
------------------------------------------------------------------- */
app.post('/teachers', async (req, res) => {
  const { name, email } = req.body;
  
  // Validate required fields
  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // Prevent using admin email for teachers
  if (email.toLowerCase() === 'admin@school.edu') {
    return res.status(400).json({ error: 'Cannot use admin email for teacher registration' });
  }

  // Validate email with Hunter.io
  console.log('Validating teacher email with Hunter.io:', email);
  const emailValidation = await validateEmailWithHunter(email);
  
  if (!emailValidation.valid) {
    console.error('Teacher email validation failed:', emailValidation.message);
    return res.status(400).json({ error: emailValidation.message });
  }
  
  console.log('Teacher email validation passed:', emailValidation.message);

  try {
    const [r] = await pool.query('INSERT INTO teachers (name,email) VALUES (?,?)', [name, email]);
    const [[row]] = await pool.query('SELECT * FROM teachers WHERE id=?', [r.insertId]);
    res.status(201).json(row);
  } catch (e) {
    if (e?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------
   DELETE TEACHER - Updated to handle subject reassignment
------------------------------------------------------------------- */
app.delete('/teachers/:id', async (req, res) => {
  const teacherId = req.params.id;
  
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    
    // Check if teacher exists
    const [[teacher]] = await conn.query('SELECT id, name FROM teachers WHERE id = ?', [teacherId]);
    
    if (!teacher) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ error: 'Teacher not found' });
    }
    
    // Count assigned subjects and sessions
    const [[subjectCount]] = await conn.query(
      'SELECT COUNT(*) as count FROM subjects WHERE teacher_id = ?', 
      [teacherId]
    );
    
    const [[sessionCount]] = await conn.query(
      'SELECT COUNT(*) as count FROM attendance_sessions WHERE teacher_id = ?',
      [teacherId]
    );
    
    // Unassign all subjects (set teacher_id to NULL to preserve subject structure)
    await conn.query('UPDATE subjects SET teacher_id = NULL WHERE teacher_id = ?', [teacherId]);
    
    // Delete teacher's face data (no longer needed)
    await conn.query('DELETE FROM teacher_faces WHERE teacher_id = ?', [teacherId]);
    
    // Preserve attendance history by setting teacher_id to NULL
    await conn.query('UPDATE attendance_sessions SET teacher_id = NULL WHERE teacher_id = ?', [teacherId]);
    
    // Finally, delete the teacher record
    await conn.query('DELETE FROM teachers WHERE id = ?', [teacherId]);
    
    await conn.commit();
    conn.release();
    
    // Build detailed success message
    let message = `Teacher ${teacher.name} deleted successfully.`;
    if (subjectCount.count > 0) {
      message += ` ${subjectCount.count} subject(s) unassigned.`;
    }
    if (sessionCount.count > 0) {
      message += ` ${sessionCount.count} attendance session(s) preserved.`;
    }
    
    res.json({ 
      success: true, 
      message: message,
      preserved_sessions: sessionCount.count,
      unassigned_subjects: subjectCount.count
    });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    conn.release();
    console.error('Error deleting teacher:', e);
    
    // Check if it's the NOT NULL constraint error
    if (e.code === 'ER_BAD_NULL_ERROR' || e.sqlMessage?.includes('cannot be null')) {
      return res.status(500).json({ 
        error: 'Database schema needs update. Please run: ALTER TABLE attendance_sessions MODIFY COLUMN teacher_id INT NULL;',
        technical_details: e.sqlMessage
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to delete teacher: ' + (e.message || 'Unknown error'),
      details: e.sqlMessage || ''
    });
  }
});

/* ------------------------------------------------------------------
   STUDENTS (register, finish first login, subjects)
------------------------------------------------------------------- */
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
 * First-time class selection: FIXED
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
    
    if (st.class_id) { 
      await conn.rollback(); 
      conn.release(); 
      return res.status(400).json({ error: 'Class selection already completed' }); 
    }

    const [[cnt]] = await conn.query('SELECT COUNT(*) AS enrolled FROM students WHERE class_id=?', [class_id]);
    if ((cnt.enrolled || 0) >= cls.strength) { await conn.rollback(); conn.release(); return res.status(409).json({ error: 'Class is full. Please select a different class.' }); }

    await conn.query('UPDATE students SET class_id=?, first_login=0 WHERE id=?', [class_id, student_id]);

    // FIXED: auto-enroll into ALL subjects for that class
    await conn.query(
      `INSERT IGNORE INTO student_enrollments (student_id, class_id, subject_id)
       SELECT ?, ?, id
       FROM subjects
       WHERE class_id = ?`,
      [student_id, class_id, class_id]
    );

    await conn.commit(); conn.release();

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
    console.error('Class selection error:', e);
    res.status(500).json({ error: 'Failed to select class' });
  }
});

/**
 * Student subjects: return ONLY subjects the student is enrolled in
 */
app.get('/api/students/:id/subjects', async (req, res) => {
  try {
    const studentId = req.params.id;
    
    // Get student info
    const [[st]] = await pool.query('SELECT id, class_id FROM students WHERE id=?', [studentId]);
    if (!st) return res.status(404).json({ error: 'Student not found' });
    if (!st.class_id) return res.json({ subjects: [], class_id: null });

    // Check if enrollments exist for this student
    const [[enrollmentCheck]] = await pool.query(
      'SELECT COUNT(*) as count FROM student_enrollments WHERE student_id = ?',
      [studentId]
    );

    // If no enrollments exist, auto-enroll the student NOW
    if (enrollmentCheck.count === 0) {
      console.log(`Auto-enrolling student ${studentId} into class ${st.class_id} subjects`);
      await pool.query(
        `INSERT IGNORE INTO student_enrollments (student_id, class_id, subject_id)
         SELECT ?, ?, id
         FROM subjects
         WHERE class_id = ?`,
        [studentId, st.class_id, st.class_id]
      );
    }

    // Fetch enrolled subjects
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
  } catch (e) { 
    console.error('Error loading student subjects:', e);
    res.status(500).json({ error: 'Failed to load subjects' }); 
  }
});

/* ------------------------------------------------------------------
   Force re-enrollment: useful for admin to fix student enrollments
------------------------------------------------------------------- */
app.post('/api/students/:id/force-enroll', async (req, res) => {
  const studentId = req.params.id;
  
  try {
    const [[st]] = await pool.query('SELECT id, class_id FROM students WHERE id=?', [studentId]);
    if (!st) return res.status(404).json({ error: 'Student not found' });
    if (!st.class_id) return res.status(400).json({ error: 'Student has no class assigned' });

    // Delete existing enrollments
    await pool.query('DELETE FROM student_enrollments WHERE student_id = ?', [studentId]);

    // Re-enroll in all class subjects
    await pool.query(
      `INSERT INTO student_enrollments (student_id, class_id, subject_id)
       SELECT ?, ?, id
       FROM subjects
       WHERE class_id = ?`,
      [studentId, st.class_id, st.class_id]
    );

    const [subjects] = await pool.query(
      `SELECT s.id, s.name, t.name AS teacher_name
       FROM student_enrollments se
       JOIN subjects s ON s.id = se.subject_id
       LEFT JOIN teachers t ON t.id = s.teacher_id
       WHERE se.student_id = ?`,
      [studentId]
    );

    res.json({ success: true, enrolled_count: subjects.length, subjects });
  } catch (e) {
    console.error('Force enroll error:', e);
    res.status(500).json({ error: 'Failed to re-enroll student' });
  }
});

/* ------------------------------------------------------------------
   TEACHER FACE APIs (similar to student faces)
------------------------------------------------------------------- */
app.post('/api/teacher-faces/save', async (req, res) => {
  try {
    const { teacher_id, embedding } = req.body;
    if (!teacher_id || !Array.isArray(embedding) || embedding.length !== 512)
      return res.status(400).json({ error: 'Invalid payload (need teacher_id and 512-length embedding array)' });

    const incoming = l2norm(toFloat32(embedding));

    const [others] = await pool.query('SELECT teacher_id, embedding FROM teacher_faces WHERE teacher_id <> ?', [teacher_id]);
    const THRESHOLD = 0.60;
    for (const row of others) {
      const stored = decodeRowEmbedding(row);
      if (!stored) continue;
      const sim = dot(incoming, l2norm(stored));
      if (sim >= THRESHOLD) return res.status(409).json({ error: 'This face is already registered to another teacher' });
    }

    const buf = encodeToBlob(incoming);
    await pool.query(
      `INSERT INTO teacher_faces (teacher_id, embedding, model)
       VALUES (?, ?, 'insightface_arcface')
       ON DUPLICATE KEY UPDATE embedding=VALUES(embedding), model=VALUES(model), updated_at=CURRENT_TIMESTAMP`,
      [teacher_id, buf]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to save teacher embedding' }); }
});

app.get('/api/teacher-faces/has', async (req, res) => {
  const { teacher_id } = req.query;
  if (!teacher_id) return res.status(400).json({ error: 'teacher_id is required' });
  const [[row]] = await pool.query('SELECT 1 FROM teacher_faces WHERE teacher_id=? LIMIT 1', [teacher_id]);
  res.json({ has_face: !!row });
});

app.get('/api/teacher-faces/embedding', async (req, res) => {
  const { teacher_id } = req.query;
  if (!teacher_id) return res.status(400).json({ error: 'teacher_id required' });
  const [[row]] = await pool.query('SELECT embedding FROM teacher_faces WHERE teacher_id=?', [teacher_id]);
  if (!row) return res.json({ teacher_id, embedding: null });
  const floats = decodeRowEmbedding(row);
  res.json({ teacher_id, embedding: floats ? Array.from(floats) : null });
});

/* ------------------------------------------------------------------
   TEACHER FACE VERIFICATION before starting session
------------------------------------------------------------------- */
app.post('/api/teacher-faces/verify-and-start', async (req, res) => {
  const { teacher_email, embedding, class_id, subject_id } = req.body;
  
  if (!teacher_email || !Array.isArray(embedding) || embedding.length !== 512 || !class_id || !subject_id) {
    return res.status(400).json({ error: 'teacher_email, embedding (512-length), class_id, and subject_id required' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    
    // Check timetable slot
    const now = new Date();
    const dayOfWeek = now.getDay();
    const currentTime = now.toTimeString().slice(0, 8);
    
    const [[slot]] = await conn.query(
      `SELECT * FROM timetable 
       WHERE class_id=? AND subject_id=? AND day_of_week=? 
       AND start_time <= ? AND end_time >= ?`,
      [class_id, subject_id, dayOfWeek, currentTime, currentTime]
    );
    
    if (!slot) {
      await conn.rollback();
      conn.release();
      return res.status(403).json({ error: 'Not allowed to start session outside timetable slot' });
    }
    
    const [[teacher]] = await conn.query('SELECT id FROM teachers WHERE email=?', [teacher_email]);
    if (!teacher) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ error: 'Teacher not found' });
    }

    const [[faceRow]] = await conn.query('SELECT embedding FROM teacher_faces WHERE teacher_id=?', [teacher.id]);
    if (!faceRow) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ error: 'Face not registered. Please register your face first.' });
    }

    const storedEmbedding = decodeRowEmbedding(faceRow);
    if (!storedEmbedding) {
      await conn.rollback();
      conn.release();
      return res.status(500).json({ error: 'Failed to decode stored face data' });
    }

    const liveEmbedding = l2norm(toFloat32(embedding));
    const similarity = dot(liveEmbedding, l2norm(storedEmbedding));
    const THRESHOLD = 0.55;

    if (similarity < THRESHOLD) {
      await conn.rollback();
      conn.release();
      return res.status(401).json({ error: 'Face verification failed. Please try again.' });
    }

    await conn.query(
      'UPDATE attendance_sessions SET active=0 WHERE class_id=? AND subject_id=? AND active=1',
      [class_id, subject_id]
    );

    const [ins] = await conn.query(
      'INSERT INTO attendance_sessions (class_id, subject_id, teacher_id, active) VALUES (?,?,?,1)',
      [class_id, subject_id, teacher.id]
    );

    const [[session]] = await conn.query('SELECT * FROM attendance_sessions WHERE id=?', [ins.insertId]);
    
    await conn.commit();
    conn.release();
    
    res.json({ 
      success: true, 
      verified: true,
      similarity: similarity.toFixed(3),
      session 
    });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    conn.release();
    console.error('Teacher verification error:', e);
    res.status(500).json({ error: 'Failed to verify and start session' });
  }
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
app.post('/api/attendance/start', async (req, res) => {
  const { class_id, subject_id, teacher_email } = req.body;
  if (!class_id || !subject_id || !teacher_email) return res.status(400).json({ error: 'class_id, subject_id, teacher_email required' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[t]] = await conn.query('SELECT id FROM teachers WHERE email=?', [teacher_email]);
    if (!t) { await conn.rollback(); conn.release(); return res.status(404).json({ error: 'Teacher not found' }); }

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

app.post('/api/attendance/mark', async (req, res) => {
  const { student_id, subject_id, session_id } = req.body;
  if (!student_id || !subject_id || !session_id) return res.status(400).json({ error: 'student_id, subject_id, session_id required' });

  try {
    const [[session]] = await pool.query('SELECT id,class_id,subject_id,active,started_at FROM attendance_sessions WHERE id=?', [session_id]);
    if (!session || !session.active) return res.status(400).json({ error: 'Session not active' });

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

app.get('/api/attendance/student-history', async (req, res) => {
  const { student_id, subject_id } = req.query;
  if (!student_id || !subject_id) return res.status(400).json({ error: 'student_id, subject_id required' });

  try {
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
   TIMETABLE MANAGEMENT
------------------------------------------------------------------- */
app.get('/api/timetable/:class_id/:subject_id', async (req, res) => {
  try {
    const [slots] = await pool.query(
      'SELECT * FROM timetable WHERE class_id=? AND subject_id=? ORDER BY day_of_week, start_time',
      [req.params.class_id, req.params.subject_id]
    );
    res.json({ slots });
  } catch (e) { res.status(500).json({ error: 'Failed to load timetable' }); }
});

app.post('/api/timetable', async (req, res) => {
  const { class_id, subject_id, day_of_week, start_time, end_time } = req.body;
  try {
    await pool.query(
      'INSERT INTO timetable (class_id, subject_id, day_of_week, start_time, end_time) VALUES (?,?,?,?,?)',
      [class_id, subject_id, day_of_week, start_time, end_time]
    );
    res.json({ success: true });
  } catch (e) { 
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Slot already exists' });
    res.status(500).json({ error: 'Failed to add slot' }); 
  }
});

app.delete('/api/timetable/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM timetable WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete slot' }); }
});

// Check if current time is within allowed slot
app.get('/api/timetable/check-slot', async (req, res) => {
  const { class_id, subject_id } = req.query;
  try {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const currentTime = now.toTimeString().slice(0, 8);
    
    const [[slot]] = await pool.query(
      `SELECT * FROM timetable 
       WHERE class_id=? AND subject_id=? AND day_of_week=? 
       AND start_time <= ? AND end_time >= ?`,
      [class_id, subject_id, dayOfWeek, currentTime, currentTime]
    );
    
    res.json({ allowed: !!slot, slot: slot || null });
  } catch (e) { res.status(500).json({ error: 'Failed to check slot' }); }
});

/* ------------------------------------------------------------------
   Session-based attendance viewing
------------------------------------------------------------------- */
app.get('/api/attendance/sessions-by-class-subject', async (req, res) => {
  const { class_id, subject_id } = req.query;
  if (!class_id || !subject_id) {
    return res.status(400).json({ error: 'class_id and subject_id required' });
  }

  try {
    const [sessions] = await pool.query(
      `SELECT id, class_id, subject_id, teacher_id, started_at, active
       FROM attendance_sessions
       WHERE class_id = ? AND subject_id = ?
       ORDER BY started_at DESC`,
      [class_id, subject_id]
    );
    res.json({ sessions });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load sessions' });
  }
});

app.get('/api/attendance/session-attendance', async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) {
    return res.status(400).json({ error: 'session_id required' });
  }

  try {
    const [[session]] = await pool.query(
      `SELECT id, class_id, subject_id, started_at
       FROM attendance_sessions
       WHERE id = ?`,
      [session_id]
    );

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const [rows] = await pool.query(
      `SELECT 
         st.id AS student_id,
         st.name AS student_name,
         COALESCE(am.status, 'Absent') AS status
       FROM student_enrollments se
       JOIN students st ON st.id = se.student_id
       LEFT JOIN attendance_marks am 
         ON am.session_id = ? AND am.student_id = st.id
       WHERE se.class_id = ? AND se.subject_id = ?
       ORDER BY st.name ASC`,
      [session_id, session.class_id, session.subject_id]
    );

    res.json({ rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load session attendance' });
  }
});

app.get('/api/attendance/active-by-teacher', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'email required' });
  
  try {
    const [[teacher]] = await pool.query('SELECT id FROM teachers WHERE email = ?', [email]);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

    const [sessions] = await pool.query(
      `SELECT id, class_id, subject_id, started_at, active
       FROM attendance_sessions
       WHERE teacher_id = ? AND active = 1`,
      [teacher.id]
    );
    res.json({ sessions });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load active sessions' });
  }
});

/* ------------------------------------------------------------------
   Manual attendance marking
------------------------------------------------------------------- */
app.post('/api/attendance/manual-mark', async (req, res) => {
  const { session_id, attendance } = req.body;
  
  if (!session_id || !Array.isArray(attendance)) {
    return res.status(400).json({ error: 'session_id and attendance array required' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[session]] = await conn.query(
      'SELECT id, class_id, subject_id, started_at FROM attendance_sessions WHERE id=?',
      [session_id]
    );

    if (!session) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ error: 'Session not found' });
    }

    const date = new Date(session.started_at).toISOString().slice(0, 10);

    for (const record of attendance) {
      const { student_id, status } = record;
      
      if (!student_id || !status || !['Present', 'Absent'].includes(status)) {
        continue;
      }

      const [[enrollment]] = await conn.query(
        'SELECT class_id FROM student_enrollments WHERE student_id=? AND subject_id=?',
        [student_id, session.subject_id]
      );

      if (!enrollment || enrollment.class_id !== session.class_id) {
        continue;
      }

      if (status === 'Present') {
        await conn.query(
          `INSERT INTO attendance_marks (session_id, student_id, subject_id, date, status)
           VALUES (?, ?, ?, ?, 'Present')
           ON DUPLICATE KEY UPDATE status='Present', marked_at=CURRENT_TIMESTAMP`,
          [session_id, student_id, session.subject_id, date]
        );
      } else {
        await conn.query(
          `INSERT INTO attendance_marks (session_id, student_id, subject_id, date, status)
           VALUES (?, ?, ?, ?, 'Absent')
           ON DUPLICATE KEY UPDATE status='Absent', marked_at=CURRENT_TIMESTAMP`,
          [session_id, student_id, session.subject_id, date]
        );
      }
    }

    await conn.commit();
    conn.release();
    res.json({ success: true, message: 'Attendance updated successfully' });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    conn.release();
    console.error('Manual attendance marking error:', e);
    res.status(500).json({ error: 'Failed to update attendance' });
  }
});

app.delete('/api/attendance/session/:session_id', async (req, res) => {
  const { session_id } = req.params;
  const { teacher_email } = req.query;

  if (!session_id || !teacher_email) {
    return res.status(400).json({ error: 'session_id and teacher_email required' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[teacher]] = await conn.query('SELECT id FROM teachers WHERE email=?', [teacher_email]);
    if (!teacher) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ error: 'Teacher not found' });
    }

    const [[session]] = await conn.query(
      'SELECT id, teacher_id FROM attendance_sessions WHERE id=?',
      [session_id]
    );

    if (!session) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.teacher_id !== teacher.id) {
      await conn.rollback();
      conn.release();
      return res.status(403).json({ error: 'You do not have permission to delete this session' });
    }

    await conn.query('DELETE FROM attendance_marks WHERE session_id=?', [session_id]);
    await conn.query('DELETE FROM attendance_sessions WHERE id=?', [session_id]);

    await conn.commit();
    conn.release();
    res.json({ success: true, message: 'Session deleted successfully' });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    conn.release();
    console.error('Session deletion error:', e);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});


/* ------------------------------------------------------------------
   START SERVER
------------------------------------------------------------------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));