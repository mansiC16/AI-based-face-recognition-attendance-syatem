import React, { useEffect, useState } from 'react';
import axios from 'axios';
import './TeacherDashboard.css';

const TeacherDashboard = ({ user, onLogout }) => {
  const [dashboardData, setDashboardData] = useState({ assignedClasses: [], totalStudents: 0 });
  const [loading, setLoading] = useState(true);
  const [teacherId, setTeacherId] = useState(null);

  const [starting, setStarting] = useState(false);
  const [activeMap, setActiveMap] = useState({});
  
  // Face registration modal
  const [showFaceModal, setShowFaceModal] = useState(false);
  const [videoStream, setVideoStream] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hasFace, setHasFace] = useState(null);

  // Face verification modal (before starting session)
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyStream, setVerifyStream] = useState(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [pendingAssignment, setPendingAssignment] = useState(null);
  
  // For session selection modal
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [availableSessions, setAvailableSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  
  // For attendance table
  const [showTableKey, setShowTableKey] = useState(null);
  const [tableRows, setTableRows] = useState([]);
  const [tableLoading, setTableLoading] = useState(false);
  const [selectedSessionInfo, setSelectedSessionInfo] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [deletingSession, setDeletingSession] = useState(null);

  useEffect(() => {
    const fetchTeacher = async () => {
      if (!user?.email) return;
      try {
        setLoading(true);
        const response = await axios.get(`http://localhost:5000/api/teacher-dashboard/${user.email}`);
        setDashboardData(response.data);

        // Get teacher ID
        const teacherRes = await axios.get('http://localhost:5000/teachers');
        const teacher = teacherRes.data.find(t => t.email === user.email);
        if (teacher) {
          setTeacherId(teacher.id);
          await refreshFaceStatus(teacher.id);
        }

        const act = await axios.get('http://localhost:5000/api/attendance/active-by-teacher', { params: { email: user.email } });
        const map = {};
        (act.data.sessions || []).forEach(s => {
          map[`${s.class_id}-${s.subject_id}`] = { session_id: s.id, started_at: s.started_at };
        });
        setActiveMap(map);
      } catch (err) { console.error(err); } finally { setLoading(false); }
    };
    fetchTeacher();
  }, [user]);

  const refreshFaceStatus = async (tId) => {
    try {
      const r = await axios.get('http://localhost:5000/api/teacher-faces/has', { params: { teacher_id: tId } });
      setHasFace(!!r.data.has_face);
    } catch { setHasFace(false); }
  };

  const keyOf = (clsId, subId) => `${clsId}-${subId}`;

  // Open face registration modal
  const openFaceModal = async () => {
    setShowFaceModal(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      setVideoStream(stream);
      const video = document.getElementById('teacherFaceVideo');
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
    if (!videoStream || !teacherId) return;
    setBusy(true);
    try {
      const video = document.getElementById('teacherFaceVideo');
      if (!video?.videoWidth) throw new Error('Camera not ready yet');

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth; 
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d'); 
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));

      const fd = new FormData();
      fd.append('student_id', String(teacherId));
      fd.append('selfie', blob, 'selfie.jpg');

      // FastAPI: extract embedding
      const py = await fetch('http://localhost:8000/enroll', { method: 'POST', body: fd });
      const data = await py.json();
      if (!py.ok) throw new Error(data?.detail || 'Face extraction failed');

      // Save to Node
      await axios.post('http://localhost:5000/api/teacher-faces/save', {
        teacher_id: teacherId, 
        embedding: data.embedding,
      });

      alert('Face registered successfully!');
      await refreshFaceStatus(teacherId);
      closeFaceModal();
    } catch (e) {
      console.error(e); 
      alert(e?.response?.data?.error || e.message || 'Face registration failed');
    } finally { setBusy(false); }
  };

  // Fetch stored embedding
  const fetchStoredEmbedding = async () => {
    try {
      const r = await axios.get('http://localhost:5000/api/teacher-faces/embedding', { 
        params: { teacher_id: teacherId } 
      });
      return r.data.embedding;
    } catch { return null; }
  };

  // Open verification modal before starting session
  const handleStartSession = async (assignment) => {
    if (hasFace === false) {
      alert('Please register your face first.');
      await openFaceModal();
      return;
    }
    
    setPendingAssignment(assignment);
    setShowVerifyModal(true);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      setVerifyStream(stream);
      const video = document.getElementById('teacherVerifyVideo');
      if (video) video.srcObject = stream;
    } catch {
      alert('Camera permission denied');
      setShowVerifyModal(false);
    }
  };

  const closeVerifyModal = () => {
    if (verifyStream) verifyStream.getTracks().forEach(t => t.stop());
    setVerifyStream(null);
    setPendingAssignment(null);
    setShowVerifyModal(false);
  };

  const handleVerifyAndStart = async () => {
    if (!pendingAssignment || !verifyStream) return;
    setVerifyBusy(true);
    
    try {
      // Capture frame
      const video = document.getElementById('teacherVerifyVideo');
      if (!video?.videoWidth) throw new Error('Camera not ready yet');
      
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth; 
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d'); 
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));

      // Get live embedding
      const fd = new FormData();
      fd.append('student_id', String(teacherId));
      fd.append('selfie', blob, 'verify.jpg');
      const py = await fetch('http://localhost:8000/enroll', { method: 'POST', body: fd });
      const data = await py.json();
      if (!py.ok) throw new Error(data?.detail || 'Face not detected');

      // Verify and start session in one call
      const res = await axios.post('http://localhost:5000/api/teacher-faces/verify-and-start', {
        teacher_email: user.email,
        embedding: data.embedding,
        class_id: pendingAssignment.classId,
        subject_id: pendingAssignment.subjectId,
      });

      const s = res.data.session;
      setActiveMap(prev => ({ 
        ...prev, 
        [keyOf(pendingAssignment.classId, pendingAssignment.subjectId)]: { 
          session_id: s.id, 
          started_at: s.started_at 
        } 
      }));
      
      alert('Face verified! Attendance session started successfully.');
      closeVerifyModal();
    } catch (e) {
      alert(e?.response?.data?.error || e.message || 'Verification failed');
    } finally { setVerifyBusy(false); }
  };

  const handleCloseSession = async (assignment) => {
    const { classId, subjectId } = assignment;
    const k = keyOf(classId, subjectId);
    const active = activeMap[k];
    if (!active) return;
    try {
      await axios.post('http://localhost:5000/api/attendance/close', {
        session_id: active.session_id,
        teacher_email: user.email,
      });
      setActiveMap(prev => { const n = { ...prev }; delete n[k]; return n; });
    } catch (e) { alert(e?.response?.data?.error || 'Failed to close session'); }
  };

  const handleShowAttendance = async (assignment) => {
    setSelectedAssignment(assignment);
    setShowSessionModal(true);
    setSessionsLoading(true);
    
    try {
      const resp = await axios.get('http://localhost:5000/api/attendance/sessions-by-class-subject', {
        params: { 
          class_id: assignment.classId, 
          subject_id: assignment.subjectId 
        },
      });
      setAvailableSessions(resp.data.sessions || []);
    } catch (e) {
      alert('Failed to load sessions');
      setShowSessionModal(false);
    } finally {
      setSessionsLoading(false);
    }
  };

  const handleDeleteSession = async (session, e) => {
    e.stopPropagation();
    
    const confirmDelete = window.confirm(
      `Are you sure you want to delete this session?\n\nDate: ${formatDateTime(session.started_at)}\n\nThis will permanently delete all attendance records for this session.`
    );
    
    if (!confirmDelete) return;

    setDeletingSession(session.id);
    try {
      await axios.delete(`http://localhost:5000/api/attendance/session/${session.id}`, {
        params: { teacher_email: user.email }
      });
      
      setAvailableSessions(prev => prev.filter(s => s.id !== session.id));
      
      if (selectedSessionInfo?.id === session.id) {
        setShowTableKey(null);
        setSelectedSessionInfo(null);
        setTableRows([]);
      }
      
      alert('Session deleted successfully!');
    } catch (e) {
      alert(e?.response?.data?.error || 'Failed to delete session');
    } finally {
      setDeletingSession(null);
    }
  };

  const handleSelectSession = async (session) => {
    setShowSessionModal(false);
    const k = keyOf(selectedAssignment.classId, selectedAssignment.subjectId);
    setShowTableKey(k);
    setSelectedSessionInfo(session);
    setTableLoading(true);
    setEditMode(false);
    
    try {
      const resp = await axios.get('http://localhost:5000/api/attendance/session-attendance', {
        params: { session_id: session.id },
      });
      setTableRows(resp.data.rows || []);
    } catch (e) {
      alert('Failed to load attendance for this session');
    } finally {
      setTableLoading(false);
    }
  };

  const toggleStudentAttendance = (studentId) => {
    setTableRows(prev => prev.map(row => {
      if (row.student_id === studentId) {
        return { ...row, status: row.status === 'Present' ? 'Absent' : 'Present' };
      }
      return row;
    }));
  };

  const handleSaveAttendance = async () => {
    if (!selectedSessionInfo) return;
    
    setSavingAttendance(true);
    try {
      await axios.post('http://localhost:5000/api/attendance/manual-mark', {
        session_id: selectedSessionInfo.id,
        attendance: tableRows.map(row => ({
          student_id: row.student_id,
          status: row.status
        }))
      });
      alert('Attendance saved successfully!');
      setEditMode(false);
    } catch (e) {
      alert(e?.response?.data?.error || 'Failed to save attendance');
    } finally {
      setSavingAttendance(false);
    }
  };

  const handleCancelEdit = async () => {
    if (!selectedSessionInfo) return;
    setTableLoading(true);
    try {
      const resp = await axios.get('http://localhost:5000/api/attendance/session-attendance', {
        params: { session_id: selectedSessionInfo.id },
      });
      setTableRows(resp.data.rows || []);
      setEditMode(false);
    } catch (e) {
      alert('Failed to reload attendance');
    } finally {
      setTableLoading(false);
    }
  };

  const formatDateTime = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleString('en-IN', { 
      dateStyle: 'medium', 
      timeStyle: 'short' 
    });
  };

  if (loading) return <div>Loading teacher dashboard...</div>;

  return (
    <div className="dashboard-wrapper">
      <header className="dashboard-header">
        <div className="header-left">
          <div className="logo">AI Attendance System</div>
        </div>
        <div className="header-right">
          {hasFace === false && (
            <button className="face-btn" onClick={openFaceModal}>
              Register Face
            </button>
          )}
          {hasFace === true && (
            <span className="face-pill ok">Face Registered</span>
          )}
          <div className="user-info">
            <span className="user-name">{user.name || user.email}</span>
            <span className="user-role">Teacher</span>
          </div>
          <button onClick={onLogout} className="logout-button">Logout</button>
        </div>
      </header>

      <div className="dashboard-content">
        <div className="welcome-section">
          <h1 className="dashboard-title">Teacher Dashboard</h1>
          <p className="welcome-text">Welcome back, {user.name || user.email}!</p>
        </div>

        <div className="stats-grid">
          <div className="stat-card blue">
            <div className="stat-number">{dashboardData.assignedClasses.length}</div>
            <div className="stat-label">Assigned Classes</div>
          </div>
          <div className="stat-card green">
            <div className="stat-number">{dashboardData.totalStudents}</div>
            <div className="stat-label">Total Students</div>
          </div>
        </div>

        <div className="classes-section">
          <h2 className="section-title">My Assignments</h2>

          {dashboardData.assignedClasses.length > 0 ? (
            dashboardData.assignedClasses.map((assignment, index) => {
              const k = keyOf(assignment.classId, assignment.subjectId);
              const active = activeMap[k];
              return (
                <div className="class-card" key={index}>
                  <div className="class-info">
                    <h3 className="class-name">
                      {assignment.className} — {assignment.subjectName}
                      {active && <span className="session-chip">Active</span>}
                    </h3>
                    <p className="class-details">Total Students: {assignment.strength}</p>
                  </div>
                  <div className="actions-col">
                    {!active && (
                      <button 
                        className="start-session-btn pro" 
                        disabled={starting} 
                        onClick={() => handleStartSession(assignment)}
                      >
                        {starting ? 'Starting…' : 'Start Attendance Session'}
                      </button>
                    )}
                    {active && (
                      <button className="danger-btn" onClick={() => handleCloseSession(assignment)}>
                        End Session
                      </button>
                    )}
                    <button className="secondary-btn" onClick={() => handleShowAttendance(assignment)}>
                      Show Attendance
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <p>You have not been assigned to any classes yet.</p>
          )}
        </div>

        {/* Face Registration Modal */}
        {showFaceModal && (
          <div className="overlay">
            <div className="overlay-card">
              <h3>Register Your Face</h3>
              <div className="camera-container">
                <video id="teacherFaceVideo" autoPlay muted playsInline className="camera-video" />
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

        {/* Verification Modal */}
        {showVerifyModal && (
          <div className="overlay">
            <div className="overlay-card">
              <h3>Face Verification Required</h3>
              <p style={{ margin: '0 0 16px', color: '#6b7280', fontSize: '14px' }}>
                Verify your identity to start the attendance session
              </p>
              <div className="camera-container">
                <video id="teacherVerifyVideo" autoPlay muted playsInline className="camera-video" />
                <div className="camera-overlay"></div>
              </div>
              <p className="camera-hint">
                Make sure your face is clearly visible and centered
              </p>
              <div className="modal-actions">
                <button className="btn-cancel" onClick={closeVerifyModal}>Cancel</button>
                <button className="btn-primary" onClick={handleVerifyAndStart} disabled={verifyBusy}>
                  {verifyBusy ? 'Verifying…' : 'Verify & Start Session'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Session Selection Modal */}
        {showSessionModal && (
          <div className="modal-overlay" onClick={() => setShowSessionModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Select Attendance Session</h2>
                <button className="modal-close" onClick={() => setShowSessionModal(false)}>×</button>
              </div>
              
              <div className="modal-body">
                {sessionsLoading ? (
                  <div style={{ padding: '20px', textAlign: 'center' }}>Loading sessions...</div>
                ) : availableSessions.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center' }}>No attendance sessions found for this class.</div>
                ) : (
                  <div className="sessions-list">
                    {availableSessions.map((session) => (
                      <div 
                        key={session.id} 
                        className="session-item"
                        onClick={() => handleSelectSession(session)}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                      >
                        <div className="session-info">
                          <div className="session-date">{formatDateTime(session.started_at)}</div>
                          <div className="session-status">
                            {session.active ? (
                              <span className="badge-active">Active Session</span>
                            ) : (
                              <span className="badge-closed">Closed Session</span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <button
                            className="danger-btn"
                            style={{ 
                              padding: '6px 12px', 
                              fontSize: '13px',
                              opacity: deletingSession === session.id ? 0.6 : 1
                            }}
                            onClick={(e) => handleDeleteSession(session, e)}
                            disabled={deletingSession === session.id}
                          >
                            {deletingSession === session.id ? 'Deleting...' : 'Delete'}
                          </button>
                          <div className="session-arrow">→</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Attendance Table */}
        {showTableKey && selectedSessionInfo && (
          <div className="table-card">
            <div className="table-header">
              <div>
                <h3>Attendance for {selectedAssignment.className} — {selectedAssignment.subjectName}</h3>
                <p className="session-date-info">Session: {formatDateTime(selectedSessionInfo.started_at)}</p>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                {!editMode ? (
                  <button className="secondary-btn" onClick={() => setEditMode(true)}>
                    Edit Attendance
                  </button>
                ) : (
                  <>
                    <button 
                      className="danger-btn" 
                      onClick={handleCancelEdit}
                      disabled={savingAttendance}
                    >
                      Cancel
                    </button>
                    <button 
                      className="start-session-btn pro" 
                      onClick={handleSaveAttendance}
                      disabled={savingAttendance}
                    >
                      {savingAttendance ? 'Saving…' : 'Save Changes'}
                    </button>
                  </>
                )}
              </div>
            </div>
            {tableLoading ? (
              <div style={{ padding: 16 }}>Loading attendance…</div>
            ) : (
              <table>
                <thead>
                  <tr><th>#</th><th>Student Name</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {tableRows.length === 0 ? (
                    <tr><td colSpan={3} style={{ padding: 16 }}>No students enrolled in this subject.</td></tr>
                  ) : tableRows.map((r, i) => (
                    <tr 
                      key={`${r.student_id}-${i}`}
                      onClick={() => editMode && toggleStudentAttendance(r.student_id)}
                      style={{ cursor: editMode ? 'pointer' : 'default' }}
                    >
                      <td>{i + 1}</td>
                      <td>{r.student_name}</td>
                      <td>
                        {r.status === 'Present'
                          ? <span className="badge-present">Present</span>
                          : <span className="badge-absent">Absent</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {editMode && tableRows.length > 0 && (
              <div style={{ padding: '16px', backgroundColor: '#f0f9ff', borderTop: '1px solid #e0e0e0' }}>
                <p style={{ margin: 0, fontSize: '14px', color: '#555' }}>
                  💡 Click on any student row to toggle their attendance status
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TeacherDashboard;