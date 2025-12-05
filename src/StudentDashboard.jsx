import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import './StudentDashboard.css';

const StudentDashboard = ({ user, onLogout }) => {
  const [profile, setProfile] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);

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

  // profile dropdown and edit profile
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');

  const studentName = useMemo(() => (user?.name || user?.email || 'Student'), [user]);

  useEffect(() => {
    const init = async () => {
      if (!user?.email) return;
      try {
        setLoading(true);
        const meRes = await axios.get('http://localhost:5000/api/students/me', { params: { email: user.email } });
        const me = meRes.data;
        setProfile(me);

        if (!me.class_id) {
          alert('No class assigned yet. Please contact your administrator.');
          setLoading(false);
          return;
        }

        // Load subjects
        const subjRes = await axios.get(`http://localhost:5000/api/students/${me.id}/subjects`);
        const subs = subjRes.data.subjects || [];
        setSubjects(subs);
        await Promise.all([refreshActiveSessions(me.id), refreshFaceStatus(me.id)]);
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

  const openEditProfile = () => {
    setEditName(profile?.name || '');
    setEditEmail(profile?.email || '');
    setShowEditProfile(true);
    setShowProfileMenu(false);
  };

  const handleSaveProfile = async () => {
    try {
      await axios.put(`http://localhost:5000/api/students/${profile.id}`, {
        name: editName,
        email: editEmail
      });
      setProfile(prev => ({ ...prev, name: editName, email: editEmail }));
      alert('Profile updated successfully!');
      setShowEditProfile(false);
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to update profile');
    }
  };

  const getInitials = (name) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
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
          
          <div className="profile-dropdown">
            <div className="profile-trigger" onClick={() => setShowProfileMenu(!showProfileMenu)}>
              <div className="profile-avatar">{getInitials(studentName)}</div>
              <div className="profile-info">
                <span className="user-name">{studentName}</span>
                <span className="user-role">Student</span>
              </div>
              <span className={`profile-dropdown-icon ${showProfileMenu ? 'open' : ''}`}>▾</span>
            </div>
            
            {showProfileMenu && (
              <div className="profile-dropdown-menu">
                <button className="profile-dropdown-item" onClick={openEditProfile}>
                  <span>👤</span> Edit Profile
                </button>
                <button className="profile-dropdown-item" onClick={() => setShowProfileMenu(false)}>
                  <span>⚙️</span> Settings
                </button>
                <div className="profile-dropdown-divider"></div>
                <button className="profile-dropdown-item danger" onClick={onLogout}>
                  <span>🚪</span> Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

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
           {profile?.class_id && subjects.length === 0 && (
          <div className="class-card"><div className="class-info">
            <h3 className="class-name">No subjects found</h3>
            <p className="class-teacher">
              {loading ? 'Loading subjects...' : 'No subjects are assigned to your class yet. Please contact your administrator.'}
            </p>
          </div></div>
        )}

        {!profile?.class_id && (
          <div className="class-card"><div className="class-info">
            <h3 className="class-name">No class assigned</h3>
            <p className="class-teacher">Please contact your administrator to assign you to a class.</p>
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
            <div className="camera-container">
              <video id="faceVideo" autoPlay muted playsInline className="camera-video" />
              <div className="camera-overlay"></div>
            </div>
            <p className="camera-hint">
              Position your face within the circle for best results
            </p>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={closeFaceModal}>Cancel</button>
              <button className="btn-primary" onClick={captureAndRegister} disabled={busy}>
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
            <h3>Face Verification</h3>
            <div className="camera-container">
              <video id="verifyVideo" autoPlay muted playsInline className="camera-video" />
              <div className="camera-overlay"></div>
            </div>
            <p className="camera-hint">
              Make sure your face is clearly visible and centered
            </p>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={closeVerifyModal}>Cancel</button>
              <button className="btn-primary" onClick={handleVerifyAndMark} disabled={verifyBusy}>
                {verifyBusy ? 'Verifying…' : 'Mark Attendance Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {showEditProfile && (
        <div className="overlay">
          <div className="overlay-card">
            <h3>Edit Profile</h3>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 8, color: '#374151' }}>Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: '1rem' }}
                placeholder="Enter your name"
              />
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 8, color: '#374151' }}>Email</label>
              <input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: '1rem' }}
                placeholder="Enter your email"
              />
            </div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowEditProfile(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleSaveProfile}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentDashboard;