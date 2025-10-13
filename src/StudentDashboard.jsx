import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import './StudentDashboard.css';

const StudentDashboard = ({ user, onLogout }) => {
  const [profile, setProfile] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);

  // first-login class selection
  const [showClassPicker, setShowClassPicker] = useState(false);
  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');

  // face registration modal
  const [showFaceModal, setShowFaceModal] = useState(false);
  const [videoStream, setVideoStream] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hasFace, setHasFace] = useState(null);

  // attendance + history
  const [activeBySubject, setActiveBySubject] = useState({}); // subject_id -> { session_id, started_at }
  const [openDropFor, setOpenDropFor] = useState(null);
  const [historyMap, setHistoryMap] = useState({}); // subject_id -> [{date, status}]

  // verification modal (camera shows first, then mark)
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyStream, setVerifyStream] = useState(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifySubject, setVerifySubject] = useState(null);

  const studentName = useMemo(() => (user?.name || user?.email || 'Student'), [user]);

  useEffect(() => {
    const init = async () => {
      if (!user?.email) return;
      try {
        setLoading(true);
        const meRes = await axios.get('http://localhost:5000/api/students/me', { params: { email: user.email } });
        const me = meRes.data;
        setProfile(me);

        // KEY CHANGE: show picker if first_login === 1 (or class_id is null)
        if (me.first_login === 1 || !me.class_id) {
          setShowClassPicker(true);
          const classRes = await axios.get('http://localhost:5000/classes/with-stats');
          setClasses(classRes.data);
        } else {
          // normal dashboard flow
          const subjRes = await axios.get(`http://localhost:5000/api/students/${me.id}/subjects`);
          const subs = subjRes.data.subjects || [];
          setSubjects(subs);
          await Promise.all([refreshActiveSessions(me.id), refreshFaceStatus(me.id)]);
        }
      } catch (err) {
        console.error(err);
        alert('Failed to load student dashboard');
      } finally { setLoading(false); }
    };
    init();
  }, [user]);

  // poll for active sessions so UI reacts when teacher ends session
  useEffect(() => {
    if (!profile?.id) return;
    const t = setInterval(() => refreshActiveSessions(profile.id), 8000);
    return () => clearInterval(t);
  }, [profile]);

  const refreshActiveSessions = async (studentId) => {
    try {
      // server filters sessions by enrollment; only enrolled subjects are returned
      const act = await axios.get('http://localhost:5000/api/attendance/active-by-student', { params: { student_id: studentId } });
      const map = {};
      (act.data.sessions || []).forEach(s => { map[s.subject_id] = { session_id: s.id, started_at: s.started_at }; });
      setActiveBySubject(map);
    } catch { /* silent */ }
  };

  const refreshFaceStatus = async (studentId) => {
    try {
      const r = await axios.get('http://localhost:5000/api/student-faces/has', { params: { student_id: studentId } });
      setHasFace(!!r.data.has_face);
    } catch { setHasFace(false); }
  };

  // ----- class selection -----
  const handleConfirmClass = async () => {
    if (!selectedClassId) return alert('Please select a class');
    try {
      setLoading(true);
      const res = await axios.post('http://localhost:5000/api/students/select-class', {
        student_id: profile.id, class_id: parseInt(selectedClassId, 10),
      });
      // After selection, server sets first_login=0 and auto-enrolls to all subjects of the class
      setProfile(prev => ({ ...prev, class_id: res.data.class.id, first_login: 0 }));
      setSubjects(res.data.subjects || []);
      setShowClassPicker(false);
      await Promise.all([refreshActiveSessions(profile.id), refreshFaceStatus(profile.id)]);
    } catch (err) {
      console.error(err);
      alert(err?.response?.data?.error || 'Class selection failed');
      try { const classRes = await axios.get('http://localhost:5000/classes/with-stats'); setClasses(classRes.data); } catch {}
    } finally { setLoading(false); }
  };

  // ----- face register modal -----
  const openFaceModal = async () => {
    setShowFaceModal(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      setVideoStream(stream);
      const video = document.getElementById('faceVideo');
      if (video) { video.srcObject = stream; }
    } catch {
      alert('Camera permission denied');
      setShowFaceModal(false);
    }
  };
  const closeFaceModal = () => {
    if (videoStream) videoStream.getTracks().forEach(t => t.stop());
    setVideoStream(null);
    setShowFaceModal(false);
  };
  const captureAndRegister = async () => {
    if (!videoStream || !profile?.id) return;
    setBusy(true);
    try {
      const video = document.getElementById('faceVideo');
      if (!video?.videoWidth) throw new Error('Camera not ready yet');

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));

      const fd = new FormData();
      fd.append('student_id', String(profile.id));
      fd.append('selfie', blob, 'selfie.jpg');

      // FastAPI: extract embedding
      const py = await fetch('http://localhost:8000/enroll', { method: 'POST', body: fd });
      const data = await py.json();
      if (!py.ok) throw new Error(data?.detail || 'Face extraction failed');

      // Save to Node
      await axios.post('http://localhost:5000/api/student-faces/save', {
        student_id: profile.id, embedding: data.embedding,
      });

      alert('Face registered successfully!');
      await refreshFaceStatus(profile.id);
      closeFaceModal();
    } catch (e) {
      console.error(e); alert(e?.response?.data?.error || e.message || 'Face registration failed');
    } finally { setBusy(false); }
  };

  // ----- embedding helpers -----
  const fetchStoredEmbedding = async () => {
    try {
      const r = await axios.get('http://localhost:5000/api/student-faces/embedding', { params: { student_id: profile.id } });
      return r.data.embedding; // array or null
    } catch { return null; }
  };

  // ----- verify modal (open first, then mark) -----
  const openVerifyModal = async (subject) => {
    if (hasFace === false) {
      alert('Please register your face first.');
      await openFaceModal();
      return;
    }
    setVerifySubject(subject);
    setShowVerifyModal(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      setVerifyStream(stream);
      const video = document.getElementById('verifyVideo');
      if (video) video.srcObject = stream;
    } catch {
      alert('Camera permission denied');
      setShowVerifyModal(false);
    }
  };
  const closeVerifyModal = () => {
    if (verifyStream) verifyStream.getTracks().forEach(t => t.stop());
    setVerifyStream(null);
    setVerifySubject(null);
    setShowVerifyModal(false);
  };
  const handleVerifyAndMark = async () => {
    if (!verifySubject || !verifyStream) return;
    setVerifyBusy(true);
    try {
      // 1) stored embedding
      const stored = await fetchStoredEmbedding();
      if (!stored) {
        alert('Face data not found. Please (re)register.');
        closeVerifyModal();
        await openFaceModal();
        return;
      }

      // 2) capture a frame
      const video = document.getElementById('verifyVideo');
      if (!video?.videoWidth) throw new Error('Camera not ready yet');
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));

      // 3) compute live embedding
      const fd = new FormData();
      fd.append('student_id', String(profile.id));
      fd.append('selfie', blob, 'verify.jpg');
      const py = await fetch('http://localhost:8000/enroll', { method: 'POST', body: fd });
      const data = await py.json();
      if (!py.ok) throw new Error(data?.detail || 'Face not detected');

      // 4) verify via FastAPI
      const ver = await fetch('http://localhost:8000/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeddingA: stored, embeddingB: data.embedding, threshold: 0.55 })
      });
      const verdict = await ver.json();
      if (!ver.ok || !verdict.is_match) throw new Error('Face did not match');

      // 5) mark attendance (server checks enrollment + session)
      const active = activeBySubject[verifySubject.id];
      if (!active) throw new Error('Attendance session is not active now.');
      await axios.post('http://localhost:5000/api/attendance/mark', {
        student_id: profile.id, subject_id: verifySubject.id, session_id: active.session_id
      });

      alert('Your attendance has been marked successfully!');
      closeVerifyModal();
      await Promise.all([loadStudentHistory(verifySubject.id), refreshActiveSessions(profile.id)]);
    } catch (e) {
      alert(e?.message || 'Could not mark attendance');
    } finally { setVerifyBusy(false); }
  };

  const loadStudentHistory = async (subjectId) => {
    try {
      const resp = await axios.get('http://localhost:5000/api/attendance/student-history', {
        params: { student_id: profile.id, subject_id: subjectId }
      });
      setHistoryMap(prev => ({ ...prev, [subjectId]: resp.data.rows || [] }));
    } catch { alert('Failed to load attendance history'); }
  };

  if (loading && !profile) return <div style={{ padding: 24 }}>Loading student dashboard…</div>;

  return (
    <div className="dashboard-wrapper">
      {/* Header */}
      <div className="dashboard-header">
        <div className="header-left">
          <div className="logo">AI Attendance System</div>
          <div className="nav-item active">Dashboard</div>
        </div>
        <div className="header-right">
          {hasFace === false && <button className="face-btn" onClick={openFaceModal}>Register Face</button>}
          {hasFace === true && <span className="face-pill ok">Face Registered</span>}
          <div className="user-info">
            <span className="user-name">{studentName}</span>
            <span className="user-role">Student</span>
          </div>
          <button onClick={onLogout} className="logout-button">Logout</button>
        </div>
      </div>

      {/* First-login Class Selection */}
      {showClassPicker && (
        <div className="overlay">
          <div className="overlay-card">
            <h3 style={{ marginTop: 0 }}>Select Your Class</h3>
            <p style={{ margin: '6px 0 12px', color: '#555' }}>Choose one class to enroll.</p>

            <div className="card">
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>Available Classes</label>
              <select value={selectedClassId} onChange={(e) => setSelectedClassId(e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                <option value="">-- Select a class --</option>
                {classes.map(c => (
                  <option key={c.id} value={c.id} disabled={c.seats_left <= 0}>
                    {c.name} — Strength: {c.strength} | Enrolled: {c.enrolled_count} | Seats left: {c.seats_left}{c.seats_left <= 0 ? ' (Full)' : ''}
                  </option>
                ))}
              </select>

              <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
                <button className="logout-button" onClick={() => onLogout()}>Cancel</button>
                <button onClick={handleConfirmClass}
                        style={{ background: '#16a34a', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: 6, cursor: 'pointer' }}>
                  Confirm
                </button>
              </div>
            </div>
            <p style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>* This appears only once.</p>
          </div>
        </div>
      )}

      {/* Main */}
      <div className="dashboard-content">
        <div className="welcome-section">
          <h1 className="dashboard-title">Student Dashboard</h1>
          <p className="welcome-text">Welcome back, {studentName}!</p>
        </div>

        {/* Stats */}
        <div className="stats-grid">
          <div className="stat-card blue">
            <div className="stat-number">{profile?.class_id ? 1 : 0}</div>
            <div className="stat-label">Enrolled Classes</div>
          </div>
          <div className="stat-card green">
            <div className="stat-number">{subjects.length}</div>
            <div className="stat-label">Enrolled Subjects</div>
          </div>
          <div className="stat-card purple">
            <div className="stat-number">{Object.keys(activeBySubject).length}</div>
            <div className="stat-label">Active Sessions</div>
          </div>
        </div>

        {/* Subjects */}
        <div className="classes-section">
          <h2 className="section-title">My Subjects</h2>

          {profile?.class_id && subjects.length === 0 && !showClassPicker && (
            <div className="class-card"><div className="class-info">
              <h3 className="class-name">Subjects not assigned yet</h3>
              <p className="class-teacher">Please check later.</p>
            </div></div>
          )}

          {subjects.map(sub => {
            const isActive = !!activeBySubject[sub.id];
            return (
              <div className={`class-card ${isActive ? 'active-session' : ''}`} key={sub.id}>
                <div className="class-info">
                  <h3 className="class-name">
                    {sub.name} <span style={{ fontWeight: 500, color:'#6b7280' }}>— {sub.teacher_name || 'Teacher'}</span>
                    {isActive && <span className="attn-chip">Attendance started</span>}
                  </h3>
                  <p className="class-teacher">Get ready to mark your attendance when active.</p>
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  {isActive && (
                    <button className="mark-btn" onClick={() => openVerifyModal(sub)}>
                      Mark Attendance
                    </button>
                  )}

                  {/* Show Attendance dropdown */}
                  <div className="dropdown">
                    <button className="dropdown-btn" onClick={async () => {
                      setOpenDropFor(openDropFor === sub.id ? null : sub.id);
                      if (!historyMap[sub.id]) await loadStudentHistory(sub.id);
                    }}>
                      Show Attendance ▾
                    </button>
                    {openDropFor === sub.id && (
                      <div className="dropdown-list">
                        {(historyMap[sub.id] || []).length === 0 ? (
                          <div className="dropdown-item"><span>No records</span></div>
                        ) : (historyMap[sub.id]).map((r, i) => (
                          <div className="dropdown-item" key={`${r.date}-${i}`}>
                            <span>{r.date}</span>
                            <strong style={{ color: r.status === 'Present' ? '#065f46' : '#991b1b' }}>
                              {r.status}
                            </strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Contextual register button if session active but face missing */}
                  {isActive && hasFace === false && (
                    <button className="face-btn subtle" onClick={openFaceModal}>Register Face</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Face registration modal */}
      {showFaceModal && (
        <div className="overlay">
          <div className="overlay-card">
            <h3>Register Your Face</h3>
            <video id="faceVideo" autoPlay muted playsInline style={{ width: '100%', borderRadius: 12 }} />
            <div style={{ display:'flex', gap:10, marginTop:12, justifyContent:'flex-end' }}>
              <button className="logout-button" onClick={closeFaceModal}>Cancel</button>
              <button onClick={captureAndRegister} disabled={busy}
                      style={{ background:'#2563EB', color:'#fff', border:'none', padding:'8px 12px', borderRadius: 6 }}>
                {busy ? 'Saving…' : 'Capture & Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Verification modal */}
      {showVerifyModal && (
        <div className="overlay">
          <div className="overlay-card">
            <h3>Face Verification to Mark Attendance</h3>
            <video id="verifyVideo" autoPlay muted playsInline style={{ width: '100%', borderRadius: 12 }} />
            <p style={{ marginTop: 8, color: '#6b7280', fontSize: 13 }}>
              Make sure your face is clearly visible. Click “Mark Attendance Now” to verify.
            </p>
            <div style={{ display:'flex', gap:10, marginTop:12, justifyContent:'flex-end' }}>
              <button className="logout-button" onClick={closeVerifyModal}>Cancel</button>
              <button className="mark-btn" onClick={handleVerifyAndMark} disabled={verifyBusy}>
                {verifyBusy ? 'Verifying…' : 'Mark Attendance Now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentDashboard;
