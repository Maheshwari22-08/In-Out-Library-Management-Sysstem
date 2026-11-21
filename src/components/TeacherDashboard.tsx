import React, { useEffect, useState } from 'react';
import {
  QrCode,
  LogOut,
  Clock,
  BookOpen,
  CheckCircle2,
  Briefcase,
  Calendar,
  Download,
} from 'lucide-react';
import { QrScannerPanel } from './QrScannerPanel';
import { AuthenticatedSession } from './AuthPortal';
import { syncTeacherToFirestore } from '../firebase';
import {
  DEGREE_DEPARTMENTS,
  DIPLOMA_DEPARTMENTS,
  TEACHER_DESIGNATIONS,
} from '../constants/departments';

interface TeacherProfile {
  id: string;
  employeeId: string;
  fullName: string;
  email: string;
  program: 'Degree' | 'Diploma';
  department: string;
  designation: string;
  phone: string | null;
  qrToken: string;
  qrDataUrl: string;
  visitCount: number;
  totalMinutes: number;
  currentlyInside: boolean;
  lastEntryAt: string | null;
}

interface TeacherLog {
  id: string;
  status: 'INSIDE' | 'COMPLETED';
  entry_time: string;
  exit_time: string | null;
  duration_minutes: number;
  scan_method: string;
  academic_session: string;
}

interface TeacherDashboardProps {
  session: AuthenticatedSession;
  gateQrDataUrl?: string;
  onSignOut: () => void;
}

export const TeacherDashboard: React.FC<TeacherDashboardProps> = ({
  session,
  gateQrDataUrl = '',
  onSignOut,
}) => {
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [logs, setLogs] = useState<TeacherLog[]>([]);
  const [sharedGateQr, setSharedGateQr] = useState<string>(gateQrDataUrl);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'scanner' | 'history'>('overview');

  // Academic wing & designation update state
  const [editProgram, setEditProgram] = useState<'Degree' | 'Diploma'>('Degree');
  const [editDept, setEditDept] = useState('');
  const [editDesignation, setEditDesignation] = useState(TEACHER_DESIGNATIONS[2]);
  const [savingProgram, setSavingProgram] = useState(false);
  const [programMsg, setProgramMsg] = useState<string | null>(null);
  const [quickScanLoading, setQuickScanLoading] = useState(false);
  const [quickScanFeedback, setQuickScanFeedback] = useState<string | null>(null);

  const loadTeacherData = async () => {
    try {
      const res = await fetch('/api/teacher/me', {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (!res.ok) throw new Error('Failed to load faculty profile');
      const data = await res.json();
      setProfile(data.profile);
      setLogs(data.logs);
      if (data.gateQrDataUrl) setSharedGateQr(data.gateQrDataUrl);
      setEditProgram(data.profile.program);
      setEditDept(data.profile.department);
      setEditDesignation(data.profile.designation);

      syncTeacherToFirestore({
        employeeId: data.profile.employeeId,
        fullName: data.profile.fullName,
        email: data.profile.email,
        program: data.profile.program,
        department: data.profile.department,
        designation: data.profile.designation,
        phone: data.profile.phone || undefined,
        visitCount: data.profile.visitCount,
        totalMinutes: data.profile.totalMinutes,
        currentlyInside: data.profile.currentlyInside,
      }).catch(() => {
        // Firestore sync applies when Firebase Auth session is present
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTeacherData();
  }, [session.token]);

  const handleSaveProgram = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProgram(true);
    setProgramMsg(null);
    try {
      const res = await fetch('/api/teacher/program', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          program: editProgram,
          department: editDept,
          designation: editDesignation,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Update failed');
      }
      await loadTeacherData();
      setProgramMsg('Faculty department and wing updated successfully.');
    } catch (err) {
      setProgramMsg(err instanceof Error ? err.message : 'Unable to update faculty wing.');
    } finally {
      setSavingProgram(false);
    }
  };

  const handleSelfScan = async (payload: string) => {
    const res = await fetch('/api/teacher/self-scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ qrPayload: payload }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Scan failed');
    await loadTeacherData();
    return {
      action: data.action as 'IN' | 'OUT',
      message:
        data.action === 'IN'
          ? `Checked IN at ${new Date(data.log.entry_time).toLocaleTimeString('en-IN')}. Total visits: ${data.teacher.visit_count}.`
          : `Checked OUT after ${data.log.duration_minutes} minutes.`,
    };
  };

  const handleQuickInOut = async () => {
    setQuickScanLoading(true);
    setQuickScanFeedback(null);
    try {
      const res = await handleSelfScan('DIET-GATE:CENTRAL-LIBRARY-SATARA');
      setQuickScanFeedback(res.message);
    } catch (err) {
      setQuickScanFeedback(err instanceof Error ? err.message : 'Unable to mark entry.');
    } finally {
      setQuickScanLoading(false);
    }
  };

  const handleDownloadIdQr = () => {
    if (!profile?.qrDataUrl) return;
    const a = document.createElement('a');
    a.href = profile.qrDataUrl;
    a.download = `DIET_Faculty_Library_ID_${profile.employeeId}.png`;
    a.click();
  };

  if (loading || !profile) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm text-slate-600">Loading Faculty Library Portal...</div>
      </div>
    );
  }

  const totalHours = Math.round((profile.totalMinutes / 60) * 10) / 10;
  const baseDepts = editProgram === 'Degree' ? [...DEGREE_DEPARTMENTS] : [...DIPLOMA_DEPARTMENTS];
  const deptChoices =
    editDept && !baseDepts.includes(editDept) ? [editDept, ...baseDepts] : baseDepts;
  const designationChoices =
    editDesignation && !TEACHER_DESIGNATIONS.includes(editDesignation)
      ? [editDesignation, ...TEACHER_DESIGNATIONS]
      : TEACHER_DESIGNATIONS;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="w-full lg:w-64 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 p-5 flex flex-col justify-between shrink-0">
        <div>
          <div className="pb-5 border-b border-slate-200">
            <img
              src="/src/assets/images/diet_official_logo.png"
              alt="Dnyanshree Institute of Engineering and Technology"
              referrerPolicy="no-referrer"
              className="h-9 w-auto object-contain mb-2.5"
            />
            <p className="text-sm font-bold text-slate-900 truncate">Central Library</p>
            <p className="text-xs text-slate-500 truncate">Faculty / Teacher Portal</p>
          </div>

          <nav className="mt-5 space-y-1">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeTab === 'overview'
                  ? 'bg-[#0F2942] text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <QrCode className="w-4 h-4 shrink-0" />
              Digital ID & Profile
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('scanner')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeTab === 'scanner'
                  ? 'bg-[#0F2942] text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <BookOpen className="w-4 h-4 shrink-0" />
              Scan Gate QR
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeTab === 'history'
                  ? 'bg-[#0F2942] text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Calendar className="w-4 h-4 shrink-0" />
              Visit History
            </button>
          </nav>
        </div>

        <div className="pt-5 mt-6 border-t border-slate-200">
          <p className="text-xs font-medium text-slate-900 truncate">{profile.fullName}</p>
          <p className="text-xs text-slate-500 mt-0.5 truncate">
            {profile.employeeId} · {profile.designation}
          </p>
          <button
            type="button"
            onClick={onSignOut}
            className="mt-4 w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-6">
          <div className="text-sm text-slate-600 truncate">
            <span>Dnyanshree Central Library</span>
            <span className="mx-2 text-slate-300">/</span>
            <span className="font-medium text-slate-900">
              {activeTab === 'overview'
                ? 'Faculty Digital Library Card'
                : activeTab === 'scanner'
                ? 'Gate QR Scanner'
                : 'Faculty Attendance Logs'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('scanner')}
            className="px-4 py-2 bg-[#0F2942] text-white text-xs font-medium rounded-lg hover:bg-[#163A5C] transition-colors whitespace-nowrap shrink-0"
          >
            {profile.currentlyInside ? 'Scan to Check Out' : 'Scan to Check In'}
          </button>
        </header>

        <main className="p-6 max-w-6xl w-full mx-auto space-y-6">
          {/* Metrics Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500">Current Library Status</p>
                <p
                  className={`text-xl font-bold mt-1.5 flex items-center gap-2 ${
                    profile.currentlyInside ? 'text-emerald-700' : 'text-slate-900'
                  }`}
                >
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                  {profile.currentlyInside ? 'Inside Reading Hall' : 'Checked Out'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {profile.program} Wing · {profile.department}
                </p>
              </div>
              <div className="pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={quickScanLoading}
                  onClick={handleQuickInOut}
                  className="w-full px-3 py-2 bg-[#0F2942] text-white text-xs font-medium rounded-lg hover:bg-[#163A5C] disabled:opacity-50 transition-colors"
                >
                  {quickScanLoading
                    ? 'Recording...'
                    : profile.currentlyInside
                    ? 'Mark Library Exit (OUT)'
                    : 'Mark Library Entry (IN)'}
                </button>
                {quickScanFeedback && (
                  <p className="text-[11px] text-emerald-700 mt-1.5 leading-snug">
                    {quickScanFeedback}
                  </p>
                )}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500">Total Library Visits</p>
              <p className="text-2xl font-bold font-mono-tabular text-slate-900 mt-1.5">
                {profile.visitCount}
              </p>
              <p className="text-xs text-slate-500 mt-1">Recorded faculty sessions this term</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500">Cumulative Research & Study Time</p>
              <p className="text-2xl font-bold font-mono-tabular text-slate-900 mt-1.5">
                {totalHours} hrs
              </p>
              <p className="text-xs text-slate-500 mt-1 font-mono-tabular">
                {profile.totalMinutes} minutes logged
              </p>
            </div>
          </div>

          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Faculty Digital Library QR ID Card */}
              <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                    <div>
                      <p className="text-xs font-medium text-slate-500">
                        Dnyanshree Institute, Satara
                      </p>
                      <h2 className="text-lg font-bold text-slate-900 mt-0.5">
                        Faculty Digital Library Pass
                      </h2>
                    </div>
                    <Briefcase className="w-5 h-5 text-[#0F2942]" />
                  </div>

                  <div className="py-6 flex flex-col items-center">
                    <img
                      src={profile.qrDataUrl}
                      alt={`QR ID for ${profile.employeeId}`}
                      className="w-52 h-52 border border-slate-200 rounded-lg p-2 bg-white"
                    />
                    <p className="text-xs font-mono-tabular text-slate-700 mt-3">
                      {profile.qrToken}
                    </p>
                  </div>

                  <div className="space-y-2 pt-4 border-t border-slate-200 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-slate-500">Faculty Name</span>
                      <span className="font-medium text-slate-900 text-right">{profile.fullName}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-slate-500">Employee ID</span>
                      <span className="font-mono-tabular font-medium text-slate-900">
                        {profile.employeeId}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-slate-500">Designation</span>
                      <span className="font-medium text-[#0F2942]">{profile.designation}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-slate-500">Academic Wing</span>
                      <span className="font-medium text-slate-900">
                        {profile.program} · {profile.department}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleDownloadIdQr}
                  className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium rounded-lg transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Download QR Pass Image
                </button>
              </div>

              {/* Wing / Department / Designation Selection & Recent Activity */}
              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
                <h3 className="text-base font-semibold text-slate-900">
                  Faculty Wing, Department & Designation
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Select your assigned Degree (B.E./B.Tech) or Diploma (Polytechnic) teaching wing and department at Dnyanshree Institute, Satara.
                </p>

                <form onSubmit={handleSaveProgram} className="mt-5 space-y-4">
                  <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setEditProgram('Degree');
                        setEditDept(DEGREE_DEPARTMENTS[0]);
                      }}
                      className={`py-2 px-3 text-sm font-medium rounded-md transition-colors ${
                        editProgram === 'Degree'
                          ? 'bg-[#0F2942] text-white'
                          : 'text-slate-700 hover:text-slate-900'
                      }`}
                    >
                      Degree Faculty
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditProgram('Diploma');
                        setEditDept(DIPLOMA_DEPARTMENTS[0]);
                      }}
                      className={`py-2 px-3 text-sm font-medium rounded-md transition-colors ${
                        editProgram === 'Diploma'
                          ? 'bg-[#0F2942] text-white'
                          : 'text-slate-700 hover:text-slate-900'
                      }`}
                    >
                      Diploma Faculty
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Department
                      </label>
                      <select
                        value={editDept}
                        onChange={(e) => setEditDept(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                      >
                        {deptChoices.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Designation
                      </label>
                      <select
                        value={editDesignation}
                        onChange={(e) => setEditDesignation(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                      >
                        {designationChoices.map((desig) => (
                          <option key={desig} value={desig}>
                            {desig}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {programMsg && (
                    <p className="text-xs font-medium text-emerald-700">{programMsg}</p>
                  )}

                  <button
                    type="submit"
                    disabled={savingProgram}
                    className="px-4 py-2 bg-[#0F2942] text-white text-xs font-medium rounded-lg hover:bg-[#163A5C] disabled:opacity-50 transition-colors"
                  >
                    {savingProgram ? 'Updating...' : 'Save Faculty Details'}
                  </button>
                </form>

                <div className="mt-8 pt-6 border-t border-slate-200">
                  <h4 className="text-sm font-semibold text-slate-900 mb-3">
                    Recent Check-In / Out Activity
                  </h4>
                  {logs.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No library visits logged yet. Scan the Gate QR at the entrance to record your first entry.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {logs.slice(0, 4).map((l) => (
                        <div key={l.id} className="py-2.5 flex items-center justify-between text-xs">
                          <div>
                            <span className="font-medium text-slate-900">
                              {new Date(l.entry_time).toLocaleDateString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </span>
                            <span className="text-slate-400 mx-1.5">·</span>
                            <span className="font-mono-tabular text-slate-600">
                              {new Date(l.entry_time).toLocaleTimeString('en-IN', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <span className="font-mono-tabular text-slate-700">
                            {l.status === 'INSIDE'
                              ? 'Currently Inside'
                              : `${l.duration_minutes} min`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'scanner' && (
            <div className="space-y-6">
              {(sharedGateQr || gateQrDataUrl) && (
                <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row items-center gap-6">
                  <img
                    src={sharedGateQr || gateQrDataUrl}
                    alt="One Universal Gate QR for All Students and Teachers"
                    className="w-36 h-36 border border-slate-200 rounded-lg p-2 bg-white shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-500">
                      One Universal QR · All Students &amp; Teachers
                    </p>
                    <h3 className="text-base font-bold text-slate-900 mt-1">
                      Central Library Gate QR Standee
                    </h3>
                    <p className="text-xs text-slate-600 mt-1.5 leading-relaxed max-w-2xl">
                      This single shared entrance QR code works for all Teachers/Faculty and all
                      Degree &amp; Diploma students. Scan it below to toggle your IN or OUT session
                      automatically.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <code className="text-xs font-mono-tabular text-slate-700 bg-slate-100 px-2.5 py-1 rounded">
                        DIET-GATE:CENTRAL-LIBRARY-SATARA
                      </code>
                      <a
                        href={sharedGateQr || gateQrDataUrl}
                        download="DIET_Universal_Gate_QR.png"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium rounded-lg transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download Universal QR
                      </a>
                    </div>
                  </div>
                </div>
              )}

              <QrScannerPanel
                mode="student"
                onScanPayload={handleSelfScan}
                sampleCodes={[
                  {
                    label: 'Scan Universal Gate QR (IN / OUT)',
                    payload: 'DIET-GATE:CENTRAL-LIBRARY-SATARA',
                  },
                ]}
              />
            </div>
          )}

          {activeTab === 'history' && (
            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Complete Faculty Library Entry & Exit History
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Chronological record for {profile.employeeId} · {profile.designation} · {profile.program}
                  </p>
                </div>
                <Clock className="w-4 h-4 text-slate-400" />
              </div>

              {logs.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-slate-600">No attendance logs recorded yet.</p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('scanner')}
                    className="mt-3 px-4 py-2 bg-[#0F2942] text-white text-xs font-medium rounded-lg"
                  >
                    Scan Gate QR for First Entry
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto mt-4">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2.5 pr-4 font-medium">Date</th>
                        <th className="py-2.5 pr-4 font-medium">Check-In</th>
                        <th className="py-2.5 pr-4 font-medium">Check-Out</th>
                        <th className="py-2.5 pr-4 font-medium text-right">Duration</th>
                        <th className="py-2.5 pr-4 font-medium">Method</th>
                        <th className="py-2.5 font-medium">Session</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {logs.map((l) => (
                        <tr key={l.id} className="hover:bg-slate-50">
                          <td className="py-3 pr-4 font-mono-tabular text-slate-900">
                            {new Date(l.entry_time).toLocaleDateString('en-IN')}
                          </td>
                          <td className="py-3 pr-4 font-mono-tabular text-slate-700">
                            {new Date(l.entry_time).toLocaleTimeString('en-IN')}
                          </td>
                          <td className="py-3 pr-4 font-mono-tabular text-slate-700">
                            {l.exit_time
                              ? new Date(l.exit_time).toLocaleTimeString('en-IN')
                              : 'Active Session'}
                          </td>
                          <td className="py-3 pr-4 font-mono-tabular text-right font-medium text-slate-900">
                            {l.status === 'INSIDE' ? '—' : `${l.duration_minutes} min`}
                          </td>
                          <td className="py-3 pr-4 text-slate-600">{l.scan_method}</td>
                          <td className="py-3 font-mono-tabular text-slate-500">
                            {l.academic_session}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
