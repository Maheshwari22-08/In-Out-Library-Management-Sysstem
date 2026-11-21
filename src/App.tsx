import React, { useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  GraduationCap,
  ArrowRight,
  BookOpen,
  Briefcase,
  Download,
  Building2,
  MapPin,
  Phone,
  Mail,
  ExternalLink,
  Search,
  X,
} from 'lucide-react';
import { auth, signOutFirebase } from './firebase';
import { AuthPortal, AuthPortalMode, AuthenticatedSession } from './components/AuthPortal';
import { StudentDashboard } from './components/StudentDashboard';
import { TeacherDashboard } from './components/TeacherDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { QrScannerPanel } from './components/QrScannerPanel';
import { DEGREE_DEPARTMENTS, DIPLOMA_DEPARTMENTS } from './constants/departments';

const DEGREE_INTAKES: Record<string, string> = {
  'Computer Science & Engineering': 'Intake 120',
  'AI & DS Engineering': 'Intake 60',
  'Civil & Environmental Engineering': 'Degree Wing',
  'Electrical & Computer Engineering': 'Intake 60',
  'Electronics & Telecommunication Engineering': 'Intake 60',
  'Mechanical & Mechatronics Engineering': 'Intake 60',
  'Applied Sciences & Engineering': '1st Year Wing',
};

const DIPLOMA_INTAKES: Record<string, string> = {
  'Computer Science & Engineering': 'Intake 60',
  'Electronics & Telecommunication Engineering': 'Intake 60',
  'Mechanical Engineering': 'Intake 60',
  'Applied Sciences & Engineering': '1st Year Wing',
};

interface PublicOverview {
  institution: string;
  summary: {
    totalStudents: number;
    degreeStudents: number;
    diplomaStudents: number;
    totalTeachers: number;
    teachersInside: number;
    studentsInside: number;
    currentlyInside: number;
    degreeInside: number;
    diplomaInside: number;
    totalVisits: number;
    totalHours: number;
    todayEntries: number;
    seatCapacity: number;
  };
  gateQrDataUrl: string;
}

interface RecentEntryItem {
  id: string;
  code: string;
  full_name: string;
  member_type: 'Student' | 'Faculty';
  program: 'Degree' | 'Diploma';
  department: string;
  status: 'INSIDE' | 'COMPLETED';
  entry_time: string;
  exit_time: string | null;
  duration_minutes: number;
  scan_method: string;
}

export default function App() {
  const [session, setSession] = useState<AuthenticatedSession | null>(null);
  const [authView, setAuthView] = useState<null | AuthPortalMode>(null);
  const [overview, setOverview] = useState<PublicOverview | null>(null);
  const [recentEntries, setRecentEntries] = useState<RecentEntryItem[]>([]);
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  const filteredRecentEntries = useMemo(() => {
    const q = ledgerSearch.trim().toLowerCase();
    if (!q) return recentEntries;
    return recentEntries.filter(
      (entry) =>
        entry.full_name.toLowerCase().includes(q) ||
        entry.code.toLowerCase().includes(q) ||
        entry.department.toLowerCase().includes(q)
    );
  }, [recentEntries, ledgerSearch]);

  const loadOverview = () => {
    fetch('/api/public/overview')
      .then((r) => r.json())
      .then((d) => setOverview(d))
      .catch(() => {});
    fetch('/api/public/recent-entries')
      .then((r) => r.json())
      .then((d) => setRecentEntries(d.entries || []))
      .catch(() => {});
  };

  useEffect(() => {
    loadOverview();
  }, []);

  const handleGateInOutScan = async (payload: string) => {
    const res = await fetch('/api/public/in-out-entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qrPayload: payload }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'IN/OUT entry failed');
    loadOverview();
    const roleLabel = data.memberType === 'teacher' ? 'Faculty' : 'Student';
    const timeLabel = new Date(
      data.action === 'IN' ? data.log.entry_time : data.log.exit_time
    ).toLocaleTimeString('en-IN');
    return {
      action: data.action as 'IN' | 'OUT',
      message:
        data.action === 'IN'
          ? `${data.member.full_name} (${data.member.code} · ${roleLabel} · ${data.member.program}) checked IN at ${timeLabel}. Visit #${data.member.visit_count}.`
          : `${data.member.full_name} (${data.member.code} · ${roleLabel} · ${data.member.program}) checked OUT at ${timeLabel} after ${data.log.duration_minutes} minutes.`,
    };
  };

  const handleGoogleAuthenticated = async (
    roleHint: 'student' | 'teacher' | 'admin',
    programChoice?: 'Degree' | 'Diploma'
  ) => {
    const user = auth.currentUser;
    if (!user) throw new Error('Google sign-in session unavailable.');
    const idToken = await user.getIdToken();
    const res = await fetch('/api/auth/firebase-exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, roleHint, programChoice }),
    });
    const data = await res.json();
    if (!res.ok) {
      await signOutFirebase().catch(() => {});
      throw new Error(data.error || 'Google authentication rejected.');
    }
    setSession(data);
    setAuthView(null);
  };

  const handleSignOut = async () => {
    setSession(null);
    await signOutFirebase().catch(() => {});
    loadOverview();
  };

  if (session?.user.role === 'student') {
    return (
      <StudentDashboard
        session={session}
        gateQrDataUrl={overview?.gateQrDataUrl || ''}
        onSignOut={handleSignOut}
      />
    );
  }

  if (session?.user.role === 'teacher') {
    return (
      <TeacherDashboard
        session={session}
        gateQrDataUrl={overview?.gateQrDataUrl || ''}
        onSignOut={handleSignOut}
      />
    );
  }

  if (session?.user.role === 'admin') {
    return (
      <AdminDashboard
        session={session}
        gateQrDataUrl={overview?.gateQrDataUrl || ''}
        onSignOut={handleSignOut}
      />
    );
  }

  if (authView) {
    return (
      <AuthPortal
        initialMode={authView}
        onAuthenticated={(s) => {
          setSession(s);
          setAuthView(null);
        }}
        onGoogleAuthenticated={handleGoogleAuthenticated}
        onCancel={() => setAuthView(null)}
      />
    );
  }

  return (
    <div className="min-h-screen relative text-slate-900">
      {/* Full Home Page Background Campus Photo */}
      <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden bg-slate-100">
        {!heroImgFailed && (
          <img
            src="/src/assets/images/diet_campus_building.png"
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            onError={() => setHeroImgFailed(true)}
            className="w-full h-full object-cover object-center"
          />
        )}
        <div className="absolute inset-0 bg-slate-100/80 backdrop-blur-[2px]" />
      </div>

      {/* Top Bar Contract: 3 clean zones separated by gap-8 */}
      <header className="bg-white/95 backdrop-blur border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-8">
          <a
            href="#overview"
            className="text-lg font-bold tracking-tight text-[#0F2942] whitespace-nowrap shrink-0 font-display"
          >
            Dnyanshree Central Library
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a
              href="#overview"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Overview
            </a>
            <a
              href="#college-info"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              College Info
            </a>
            <a
              href="#central-library"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Central Library
            </a>
            <a
              href="#gate-scanner"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              IN / OUT Entry
            </a>
            <a
              href="#portals"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Portals
            </a>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => setAuthView('student-login')}
              className="px-4 py-2 bg-[#0F2942] text-white text-xs font-medium rounded-lg hover:bg-[#163A5C] transition-colors whitespace-nowrap shrink-0"
            >
              Sign In
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10 space-y-12">
        {/* Hero with Official College Campus Photo Background */}
        <section
          id="overview"
          className="relative rounded-xl overflow-hidden border border-slate-200 min-h-[420px] flex items-center bg-[#0F2942]"
        >
          {!heroImgFailed ? (
            <img
              src="/src/assets/images/diet_campus_building.png"
              alt="Dnyanshree Institute of Engineering and Technology, Satara Campus Building"
              referrerPolicy="no-referrer"
              onError={() => setHeroImgFailed(true)}
              className="absolute inset-0 w-full h-full object-cover object-center"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-[#0F2942] via-[#163A5C] to-slate-900 flex items-center justify-end p-12 opacity-40">
              <BookOpen className="w-32 h-32 text-white" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-[#0F2942]/92 via-[#0F2942]/80 to-[#0F2942]/40" />

          <div className="relative z-10 p-8 sm:p-12 max-w-3xl">
            <div className="inline-block bg-white/95 rounded-lg px-3.5 py-2 mb-5">
              <img
                src="/src/assets/images/diet_official_logo.png"
                alt="Dnyanshree Institute of Engineering and Technology, Satara"
                referrerPolicy="no-referrer"
                className="h-9 sm:h-10 w-auto object-contain"
              />
            </div>
            <p className="text-xs font-medium text-slate-200">
              Raosaheb Wangde Master Charitable Trust · Est. 2012 · NAAC B+ Grade · AICTE, DBATU &amp; MSBTE
            </p>
            <h1
              className="text-3xl sm:text-5xl font-bold text-white tracking-tight mt-2.5 leading-tight"
              style={{ textWrap: 'balance' }}
            >
              Dnyanshree Central Library &amp; QR Attendance Portal
            </h1>
            <p className="text-base text-slate-100 mt-4 leading-relaxed max-w-2xl">
              Official digital IN/OUT attendance portal for कै. लक्ष्मण स्मृती ग्रंथालय (Central
              Library) at Dnyanshree Institute of Engineering &amp; Technology, Satara — serving
              Degree &amp; Diploma students and Faculty with a unified Gate QR pass.
            </p>

            <div className="pt-7 mt-7 border-t border-white/20 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => setAuthView('student-register')}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-[#0F2942] text-sm font-semibold rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap"
              >
                Register Student QR Pass
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setAuthView('admin-login')}
                className="px-4 py-2.5 text-sm font-medium text-white bg-[#0F2942]/75 border border-white/30 rounded-lg hover:bg-[#0F2942] transition-colors whitespace-nowrap"
              >
                Librarian Admin Console
              </button>
            </div>
          </div>
        </section>

        {/* Official Institute & Central Library Key Figures (from dnyanshree.edu.in) */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <p className="text-xs font-medium text-slate-500">Central Library Reading Hall</p>
            <p className="text-3xl font-bold font-mono-tabular text-slate-900 mt-1.5">
              150
              <span className="text-sm font-normal text-slate-500"> seats</span>
            </p>
            <p className="text-xs text-slate-500 mt-2 font-mono-tabular">
              409.5 sq. m · 13 digital library PCs
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <p className="text-xs font-medium text-slate-500">Degree Wing (B.Tech / B.E.)</p>
            <p className="text-3xl font-bold font-mono-tabular text-[#0F2942] mt-1.5">
              360
              <span className="text-sm font-normal text-slate-500"> annual intake</span>
            </p>
            <p className="text-xs text-slate-500 mt-2">
              5 DBATU branches · 1st Year–4th Year
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <p className="text-xs font-medium text-slate-500">Diploma Wing (Polytechnic)</p>
            <p className="text-3xl font-bold font-mono-tabular text-amber-700 mt-1.5">
              180
              <span className="text-sm font-normal text-slate-500"> annual intake</span>
            </p>
            <p className="text-xs text-slate-500 mt-2">
              3 MSBTE branches · 1st Year–3rd Year
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <p className="text-xs font-medium text-slate-500">Central Library Collection</p>
            <p className="text-3xl font-bold font-mono-tabular text-slate-900 mt-1.5">
              19,019
              <span className="text-sm font-normal text-slate-500"> books</span>
            </p>
            <p className="text-xs text-slate-500 mt-2 font-mono-tabular">
              8,798 e-books · 10,104 e-journals
            </p>
          </div>
        </section>

        {/* Official Central Library Photographs from dnyanshree.edu.in */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <img
              src="/src/assets/images/diet_official_library_1.jpg"
              alt="Dnyanshree Central Library Book Stacks and Reference Wing"
              referrerPolicy="no-referrer"
              className="w-full aspect-[16/10] object-cover"
            />
            <div className="px-5 py-3.5 border-t border-slate-200">
              <p className="text-sm font-semibold text-slate-900">
                Central Library Book Stacks &amp; Reference Section
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Degree &amp; Diploma textbook collection · DIET Satara
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <img
              src="/src/assets/images/diet_official_library_2.jpg"
              alt="Dnyanshree Central Library Reading Hall"
              referrerPolicy="no-referrer"
              className="w-full aspect-[16/10] object-cover"
            />
            <div className="px-5 py-3.5 border-t border-slate-200">
              <p className="text-sm font-semibold text-slate-900">
                Central Library Reading Hall (150 Seats · 409.5 sq. m)
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                कै. लक्ष्मण स्मृती ग्रंथालय · Knowledge Resource Center · DIET Satara
              </p>
            </div>
          </div>
        </section>

        {/* Gate IN / OUT Entry Kiosk, Live Ledger & Universal Gate QR */}
        <section id="gate-scanner" className="scroll-mt-20 space-y-6">
          <QrScannerPanel
            mode="kiosk"
            onScanPayload={handleGateInOutScan}
            sampleCodes={[
              { label: 'Aarav (DEG-CS-2401)', payload: 'DEG-CS-2401' },
              { label: 'Omkar (DIP-CO-2503)', payload: 'DIP-CO-2503' },
              { label: 'Dr. Kulkarni (TCH-CS-101)', payload: 'TCH-CS-101' },
            ]}
          />

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Recent Library IN / OUT Entry Ledger
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Automatically updated on every QR scan or PRN / Employee ID check-in &amp; check-out
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-72">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    aria-label="Filter recent library entries by name, ID, or department"
                    value={ledgerSearch}
                    onChange={(e) => setLedgerSearch(e.target.value)}
                    placeholder="Search name, PRN / ID, or department..."
                    className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#0F2942]"
                  />
                  {ledgerSearch && (
                    <button
                      type="button"
                      aria-label="Clear entry search"
                      onClick={() => setLedgerSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <span className="text-xs font-mono-tabular text-slate-500 whitespace-nowrap">
                  {ledgerSearch.trim()
                    ? `${filteredRecentEntries.length} of ${recentEntries.length} records`
                    : `Latest ${recentEntries.length} records`}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto mt-4">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2.5 pr-4 font-medium">ID / PRN</th>
                    <th className="py-2.5 pr-4 font-medium">Member</th>
                    <th className="py-2.5 pr-4 font-medium">Wing · Department</th>
                    <th className="py-2.5 pr-4 font-medium">Entry (IN)</th>
                    <th className="py-2.5 pr-4 font-medium">Exit (OUT)</th>
                    <th className="py-2.5 pr-4 font-medium text-right">Duration</th>
                    <th className="py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentEntries.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-500">
                        No IN / OUT entries recorded yet. Scan a QR pass or enter a PRN above.
                      </td>
                    </tr>
                  ) : filteredRecentEntries.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-500">
                        No entries matching &ldquo;{ledgerSearch.trim()}&rdquo;.
                      </td>
                    </tr>
                  ) : (
                    filteredRecentEntries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-slate-50">
                        <td className="py-2.5 pr-4 font-mono-tabular font-medium text-slate-900 whitespace-nowrap">
                          {entry.code}
                        </td>
                        <td className="py-2.5 pr-4 text-slate-900 font-medium whitespace-nowrap">
                          {entry.full_name}
                          <span className="ml-1.5 text-[11px] font-normal text-slate-500">
                            · {entry.member_type}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 text-slate-600">
                          {entry.program} · {entry.department}
                        </td>
                        <td className="py-2.5 pr-4 font-mono-tabular text-slate-700 whitespace-nowrap">
                          {new Date(entry.entry_time).toLocaleString('en-IN')}
                        </td>
                        <td className="py-2.5 pr-4 font-mono-tabular text-slate-700 whitespace-nowrap">
                          {entry.exit_time
                            ? new Date(entry.exit_time).toLocaleTimeString('en-IN')
                            : '—'}
                        </td>
                        <td className="py-2.5 pr-4 font-mono-tabular text-right text-slate-900 whitespace-nowrap">
                          {entry.status === 'INSIDE' ? '—' : `${entry.duration_minutes} min`}
                        </td>
                        <td className="py-2.5 whitespace-nowrap">
                          <span
                            className={`font-medium ${
                              entry.status === 'INSIDE' ? 'text-emerald-700' : 'text-slate-600'
                            }`}
                          >
                            {entry.status === 'INSIDE' ? 'Inside Hall (IN)' : 'Checked Out (OUT)'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row items-center gap-6">
            {overview?.gateQrDataUrl && (
              <img
                src={overview.gateQrDataUrl}
                alt="One Universal Library Gate QR for All Students and Teachers"
                className="w-36 h-36 border border-slate-200 rounded-lg p-2 shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-500">
                One Universal Entrance QR · All Students &amp; Teachers
              </p>
              <h2 className="text-lg font-bold text-slate-900 mt-1">
                Single Gate QR for Every Student &amp; Teacher
              </h2>
              <p className="text-sm text-slate-600 mt-2 leading-relaxed max-w-3xl">
                Every Degree student, Diploma student, and Teacher/Faculty member scans this single
                entrance QR from their portal camera to log IN or OUT automatically. Staff can also
                scan any member&rsquo;s digital ID at the desk kiosk above.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <code className="text-xs font-mono-tabular text-slate-700 bg-slate-100 px-2.5 py-1 rounded">
                  DIET-GATE:CENTRAL-LIBRARY-SATARA
                </code>
                {overview?.gateQrDataUrl && (
                  <a
                    href={overview.gateQrDataUrl}
                    download="DIET_Universal_Gate_QR.png"
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#0F2942] text-white text-xs font-medium rounded-lg hover:bg-[#163A5C] transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Universal Gate QR (PNG)
                  </a>
                )}
              </div>
            </div>
          </div>

          <div id="portals" className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
              <div>
                <GraduationCap className="w-6 h-6 text-[#0F2942] mb-3" />
                <h3 className="text-base font-bold text-slate-900">
                  Student Portal (Degree & Diploma)
                </h3>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  Select your Degree or Diploma stream, access your cryptographically signed QR ID card,
                  self-scan Gate QR, and review your full visit history.
                </p>
              </div>
              <div className="pt-5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setAuthView('student-login')}
                  className="px-4 py-2 bg-[#0F2942] text-white text-xs font-medium rounded-lg hover:bg-[#163A5C] transition-colors"
                >
                  Student Sign In
                </button>
                <button
                  type="button"
                  onClick={() => setAuthView('student-register')}
                  className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Register
                </button>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
              <div>
                <Briefcase className="w-6 h-6 text-[#0F2942] mb-3" />
                <h3 className="text-base font-bold text-slate-900">
                  Teacher / Faculty Portal
                </h3>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  Dedicated Faculty Digital Library Pass for Degree & Diploma professors, Gate QR
                  self-check-in/out, department & designation profile, and personal visit logs.
                </p>
              </div>
              <div className="pt-5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setAuthView('teacher-login')}
                  className="px-4 py-2 bg-[#0F2942] text-white text-xs font-medium rounded-lg hover:bg-[#163A5C] transition-colors"
                >
                  Teacher Sign In
                </button>
                <button
                  type="button"
                  onClick={() => setAuthView('teacher-register')}
                  className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Register
                </button>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
              <div>
                <ShieldCheck className="w-6 h-6 text-[#0F2942] mb-3" />
                <h3 className="text-base font-bold text-slate-900">
                  Librarian & Staff Admin Console
                </h3>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  Live camera & USB kiosk scanner, student & faculty visit frequency tracking, Excel
                  (.xlsx) exports, automated weekly email digests, and mobile push alerts.
                </p>
              </div>
              <div className="pt-5">
                <button
                  type="button"
                  onClick={() => setAuthView('admin-login')}
                  className="px-4 py-2 bg-[#0F2942] text-white text-xs font-medium rounded-lg hover:bg-[#163A5C] transition-colors"
                >
                  Open Admin Console
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Official College Information from dnyanshree.edu.in */}
        <section
          id="college-info"
          className="scroll-mt-20 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-8"
        >
          <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-slate-200">
            <div>
              <p className="text-xs font-medium text-slate-500">
                Official Institute Profile · dnyanshree.edu.in/about-dnyanshree.html
              </p>
              <h2 className="text-xl font-bold text-slate-900 mt-1">
                Dnyanshree Institute of Engineering &amp; Technology (DIET), Satara
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                Raosaheb Wangde Master Charitable Trust · Established 2012 · Hon. Chairman Mr.
                Dnyaneshwar B. Wangde (Bhai)
              </p>
            </div>
            <a
              href="https://dnyanshree.edu.in/about-dnyanshree.html"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors shrink-0 whitespace-nowrap"
            >
              Official College Portal
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-6 space-y-5">
              <div className="flex items-center gap-2 text-[#0F2942]">
                <Building2 className="w-4 h-4 shrink-0" />
                <h3 className="text-sm font-bold text-slate-900">
                  About DIET Satara &amp; Affiliations
                </h3>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Situated on a scenic campus at Sonwadi-Gajwadi along Sajjangad Road, Satara,
                Dnyanshree Institute of Engineering &amp; Technology (DIET) excels in engineering
                education, research, innovation, and incubation through qualified faculty, modern
                laboratories, project-based learning, RedHat Laboratory, Incubation Centre, and AI
                &amp; Data Science Center. The institute is accredited with{' '}
                <strong className="text-slate-900">NAAC B+ Grade</strong>, approved by{' '}
                <strong className="text-slate-900">AICTE</strong> (UGC 2(f)), and affiliated to{' '}
                <strong className="text-slate-900">DBATU (Lonere)</strong> for Degree and{' '}
                <strong className="text-slate-900">MSBTE</strong> for Diploma programs.
              </p>

              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 border-t border-b border-slate-200 text-xs">
                <div>
                  <dt className="text-slate-500">True Engineers</dt>
                  <dd className="font-mono-tabular font-semibold text-slate-900 mt-0.5">1,500+</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Recruiters</dt>
                  <dd className="font-mono-tabular font-semibold text-slate-900 mt-0.5">150+</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Placements</dt>
                  <dd className="font-mono-tabular font-semibold text-slate-900 mt-0.5">1,000+</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Scholarships</dt>
                  <dd className="font-mono-tabular font-semibold text-slate-900 mt-0.5">3,000+</dd>
                </div>
              </dl>

              <div className="space-y-2 text-xs text-slate-600">
                <p className="flex items-start gap-2">
                  <MapPin className="w-3.5 h-3.5 text-[#0F2942] mt-0.5 shrink-0" />
                  <span>
                    <strong className="text-slate-800">Campus:</strong> A/P Sonwadi-Gajwadi,
                    Sajjangad Road, Satara, Maharashtra 415013
                  </span>
                </p>
                <p className="flex items-start gap-2">
                  <Building2 className="w-3.5 h-3.5 text-[#0F2942] mt-0.5 shrink-0" />
                  <span>
                    <strong className="text-slate-800">Trust Office:</strong> 10, Atul Nivas, 1st
                    Floor, 7th Khetwadi, Mumbai 400004
                  </span>
                </p>
                <div className="flex flex-wrap gap-x-6 gap-y-1 pt-1">
                  <span className="inline-flex items-center gap-1.5 font-mono-tabular">
                    <Phone className="w-3.5 h-3.5 text-[#0F2942]" />
                    086000 09009
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-[#0F2942]" />
                    admindiet@dnyanshree.edu.in
                  </span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6 space-y-5 lg:border-l lg:border-slate-200 lg:pl-8">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Institute Vision</h3>
                <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                  To be a renowned multidisciplinary engineering and technological institute for
                  holistic and sustainable development of the society.
                </p>
              </div>

              <div className="pt-4 border-t border-slate-200">
                <h3 className="text-sm font-bold text-slate-900">Institute Mission</h3>
                <ul className="mt-2 space-y-1.5 text-xs text-slate-600 list-disc pl-4 leading-relaxed">
                  <li>
                    To increase awareness among rural society about the importance of engineering
                    education.
                  </li>
                  <li>
                    To strengthen ecosystems for knowledge and skills pertaining to contemporary
                    industry standards.
                  </li>
                  <li>
                    To promote research, innovation, incubation, extension and collaborative
                    culture.
                  </li>
                  <li>
                    To inculcate values through ethical and professional practices among
                    stakeholders for development of socially responsible engineering graduates.
                  </li>
                </ul>
              </div>

              <div className="pt-4 border-t border-slate-200">
                <h3 className="text-sm font-bold text-slate-900">Key Campus Infrastructure</h3>
                <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                  Computer Centre · AI &amp; Data Science Lab · Language Lab · 150-Seat Seminar
                  Hall · RedHat Academy Lab · 10-Bus Transport Fleet · Gymkhana, Yoga &amp; Two
                  Playgrounds · Hygienic Cafeteria · Accessible Campus Ramps &amp; Elevators.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Official Central Library Information from dnyanshree.edu.in/infra.html */}
        <section
          id="central-library"
          className="scroll-mt-20 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-8"
        >
          <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-slate-200">
            <div>
              <p className="text-xs font-medium text-slate-500">
                Knowledge Resource Center · dnyanshree.edu.in/infra.html
              </p>
              <h2 className="text-xl font-bold text-slate-900 mt-1">
                कै. लक्ष्मण स्मृती ग्रंथालय — Central Library
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                409.5 sq. m Area · 150 Seating Capacity · Automated on e-Granthalaya 3.0 (NIC) · Free
                Membership for All Students, Faculty &amp; Staff
              </p>
            </div>
            <a
              href="https://dnyanshree.edu.in/infra.html"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors shrink-0 whitespace-nowrap"
            >
              Library on DIET Portal
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Library at a Glance</h3>
            <dl className="grid grid-cols-2 sm:grid-cols-5 gap-x-6 gap-y-4 py-4 border-t border-b border-slate-200 text-xs">
              <div>
                <dt className="text-slate-500">Total Books</dt>
                <dd className="font-mono-tabular text-base font-bold text-slate-900 mt-0.5">19,019</dd>
              </div>
              <div>
                <dt className="text-slate-500">E-Books</dt>
                <dd className="font-mono-tabular text-base font-bold text-slate-900 mt-0.5">8,798</dd>
              </div>
              <div>
                <dt className="text-slate-500">Titles</dt>
                <dd className="font-mono-tabular text-base font-bold text-slate-900 mt-0.5">3,710</dd>
              </div>
              <div>
                <dt className="text-slate-500">Reference Books</dt>
                <dd className="font-mono-tabular text-base font-bold text-slate-900 mt-0.5">3,112</dd>
              </div>
              <div>
                <dt className="text-slate-500">Text Books</dt>
                <dd className="font-mono-tabular text-base font-bold text-slate-900 mt-0.5">7,017</dd>
              </div>
              <div>
                <dt className="text-slate-500">Print Journals</dt>
                <dd className="font-mono-tabular text-base font-bold text-slate-900 mt-0.5">42</dd>
              </div>
              <div>
                <dt className="text-slate-500">E-Journals</dt>
                <dd className="font-mono-tabular text-base font-bold text-slate-900 mt-0.5">10,104</dd>
              </div>
              <div>
                <dt className="text-slate-500">Bound Volumes</dt>
                <dd className="font-mono-tabular text-base font-bold text-slate-900 mt-0.5">92</dd>
              </div>
              <div>
                <dt className="text-slate-500">CD / DVDs</dt>
                <dd className="font-mono-tabular text-base font-bold text-slate-900 mt-0.5">320</dd>
              </div>
              <div>
                <dt className="text-slate-500">Digital Library PCs</dt>
                <dd className="font-mono-tabular text-base font-bold text-slate-900 mt-0.5">13</dd>
              </div>
            </dl>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-200">
                Library Facilities &amp; Services
              </h3>
              <ul className="mt-3 space-y-1.5 text-xs text-slate-600 list-disc pl-4 leading-relaxed">
                <li>Automated Circulation via ILMS (e-Granthalaya 3.0 by NIC)</li>
                <li>OPAC — Online Public Access Catalogue</li>
                <li>Book Bank Facility (SC, Other Caste &amp; General)</li>
                <li>Inter-Library Loan (ILL) via DELNET</li>
                <li>Digitized Question Bank &amp; GATE Study Material</li>
                <li>Reprographic Facility, New Arrival &amp; Newspaper Clipping</li>
                <li>Dedicated Departmental Libraries</li>
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-200">
                Digital Library &amp; NDLI Club
              </h3>
              <p className="mt-3 text-xs text-slate-600 leading-relaxed">
                The Digital Library houses <strong className="text-slate-900">13 computers</strong>{' '}
                giving free access to e-journals, Calibre e-book collections, NPTEL video courses,
                ShodhGanga theses, and digitized university question papers. Through{' '}
                <strong className="text-slate-900">NDLI &amp; DIET NDLI Club</strong>, students and
                researchers participate in skill-building events and access full-text engineering
                repositories anytime.
              </p>
            </div>

            <div>
              <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-200">
                Remote Access E-Resources
              </h3>
              <ul className="divide-y divide-slate-100 mt-2 text-xs text-slate-700">
                <li className="py-2 flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-900">NDLI (IIT Kharagpur)</span>
                  <span className="font-mono-tabular text-slate-500">ndl.iitkgp.ac.in</span>
                </li>
                <li className="py-2 flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-900">DELNET (New Delhi)</span>
                  <span className="font-mono-tabular text-slate-500">delnet.in</span>
                </li>
                <li className="py-2 flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-900">e-Shodhsindhu (MoE)</span>
                  <span className="font-mono-tabular text-slate-500">ess.inflibnet.ac.in</span>
                </li>
                <li className="py-2 flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-900">Inventi Journals</span>
                  <span className="font-mono-tabular text-slate-500">inventi.in</span>
                </li>
                <li className="py-2 flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-900">ScienceOpen</span>
                  <span className="font-mono-tabular text-slate-500">Springer / Elsevier</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* Official Academic Wings & Departments Directory */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          <div className="pb-5 border-b border-slate-200">
            <p className="text-xs font-medium text-slate-500">
              DBATU (Degree) &amp; MSBTE (Diploma) · Official Approved Intake
            </p>
            <h2 className="text-xl font-bold text-slate-900 mt-1">
              Degree &amp; Diploma Engineering Departments
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-6">
            <div>
              <h3 className="text-sm font-semibold text-[#0F2942] pb-2 border-b border-slate-200">
                Degree Wing (B.Tech / B.E. · 1st Year–4th Year)
              </h3>
              <ul className="divide-y divide-slate-100 mt-2 text-sm text-slate-700">
                {DEGREE_DEPARTMENTS.map((dept) => (
                  <li key={dept} className="py-2 flex items-center justify-between gap-4">
                    <span>{dept}</span>
                    <span className="text-xs text-slate-500 font-mono-tabular shrink-0">
                      {DEGREE_INTAKES[dept] || 'Degree'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-amber-800 pb-2 border-b border-slate-200">
                Diploma Wing (Polytechnic · 1st Year–3rd Year)
              </h3>
              <ul className="divide-y divide-slate-100 mt-2 text-sm text-slate-700">
                {DIPLOMA_DEPARTMENTS.map((dept) => (
                  <li key={dept} className="py-2 flex items-center justify-between gap-4">
                    <span>{dept}</span>
                    <span className="text-xs text-slate-500 font-mono-tabular shrink-0">
                      {DIPLOMA_INTAKES[dept] || 'Diploma'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-white/95 border-t border-slate-200 mt-16">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <p>
            Dnyanshree Institute of Engineering &amp; Technology, Satara · Sonwadi-Gajwadi, Sajjangad
            Road, Satara 415013
          </p>
          <p className="font-mono-tabular">
            086000 09009 · admindiet@dnyanshree.edu.in · NAAC B+
          </p>
        </div>
      </footer>
    </div>
  );
}
