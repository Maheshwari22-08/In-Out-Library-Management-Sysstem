import React, { useEffect, useState } from 'react';
import { ShieldCheck, KeyRound, UserPlus, LogIn, ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react';
import { signInWithGoogleFirebase } from '../firebase';

import {
  DEGREE_DEPARTMENTS,
  DIPLOMA_DEPARTMENTS,
  DEGREE_YEARS,
  DIPLOMA_YEARS,
  TEACHER_DESIGNATIONS,
} from '../constants/departments';

export interface AuthenticatedSession {
  token: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: 'student' | 'teacher' | 'admin';
    prn?: string;
    employeeId?: string;
    designation?: string;
    program?: 'Degree' | 'Diploma';
    department?: string;
    academicYear?: string;
  };
}

export type AuthPortalMode =
  | 'student-login'
  | 'student-register'
  | 'teacher-login'
  | 'teacher-register'
  | 'admin-login';

interface AuthPortalProps {
  initialMode?: AuthPortalMode;
  onAuthenticated: (session: AuthenticatedSession) => void;
  onGoogleAuthenticated: (
    roleHint: 'student' | 'teacher' | 'admin',
    programChoice?: 'Degree' | 'Diploma'
  ) => Promise<void>;
  onCancel: () => void;
}

const DEGREE_DEPTS = DEGREE_DEPARTMENTS;
const DIPLOMA_DEPTS = DIPLOMA_DEPARTMENTS;

export const AuthPortal: React.FC<AuthPortalProps> = ({
  initialMode = 'student-login',
  onAuthenticated,
  onGoogleAuthenticated,
  onCancel,
}) => {
  const [tab, setTab] = useState<AuthPortalMode>(initialMode);
  const [adminClaimed, setAdminClaimed] = useState<boolean>(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Login fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Registration & Admin Claim fields
  const [fullName, setFullName] = useState('');
  const [prn, setPrn] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [designation, setDesignation] = useState(TEACHER_DESIGNATIONS[2]);
  const [program, setProgram] = useState<'Degree' | 'Diploma'>('Degree');
  const [department, setDepartment] = useState(DEGREE_DEPTS[0]);
  const [academicYear, setAcademicYear] = useState('3rd Year');
  const [phone, setPhone] = useState('');

  // MFA challenge state
  const [mfaStep, setMfaStep] = useState<{
    challengeToken: string;
    email: string;
    mfaSetup?: {
      secret: string;
      totpQrDataUrl: string;
      initialVerificationHint: string;
    };
  } | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  useEffect(() => {
    fetch('/api/auth/admin-status')
      .then((r) => r.json())
      .then((d) => setAdminClaimed(Boolean(d.adminClaimed)))
      .catch(() => setAdminClaimed(true));
  }, []);

  const currentRole: 'student' | 'teacher' | 'admin' =
    tab === 'admin-login'
      ? 'admin'
      : tab === 'teacher-login' || tab === 'teacher-register'
      ? 'teacher'
      : 'student';

  const isRegister = tab === 'student-register' || tab === 'teacher-register';

  const handleRoleSwitch = (nextRole: 'student' | 'teacher' | 'admin') => {
    setError(null);
    if (nextRole === 'admin') {
      setTab('admin-login');
    } else if (nextRole === 'teacher') {
      setTab(isRegister ? 'teacher-register' : 'teacher-login');
    } else {
      setTab(isRegister ? 'student-register' : 'student-login');
    }
  };

  const handleProgramChange = (nextProgram: 'Degree' | 'Diploma') => {
    setProgram(nextProgram);
    if (nextProgram === 'Degree') {
      setDepartment(DEGREE_DEPTS[0]);
      setAcademicYear('3rd Year');
    } else {
      setDepartment(DIPLOMA_DEPTS[0]);
      setAcademicYear('3rd Year');
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: currentRole,
          email,
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');
      setMfaStep({
        challengeToken: data.challengeToken,
        email: data.email,
      });
      setMfaCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleStudentRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/student-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prn,
          fullName,
          email,
          password,
          program,
          department,
          academicYear,
          phone,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      setMfaStep({
        challengeToken: data.challengeToken,
        email,
        mfaSetup: data.mfaSetup,
      });
      setMfaCode(data.mfaSetup?.initialVerificationHint || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to register student.');
    } finally {
      setLoading(false);
    }
  };

  const handleTeacherRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/teacher-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId,
          fullName,
          email,
          password,
          program,
          department,
          designation,
          phone,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Faculty registration failed');
      setMfaStep({
        challengeToken: data.challengeToken,
        email,
        mfaSetup: data.mfaSetup,
      });
      setMfaCode(data.mfaSetup?.initialVerificationHint || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to register faculty profile.');
    } finally {
      setLoading(false);
    }
  };

  const handleAdminClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/admin-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          fullName,
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Admin setup failed');
      setAdminClaimed(true);
      setMfaStep({
        challengeToken: data.challengeToken,
        email,
        mfaSetup: data.mfaSetup,
      });
      setMfaCode(data.mfaSetup?.initialVerificationHint || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to configure Head Librarian account.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaStep) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/verify-mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeToken: mfaStep.challengeToken,
          code: mfaCode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid MFA code');
      onAuthenticated(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MFA verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithGoogleFirebase();
      await onGoogleAuthenticated(currentRole, program);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google Sign-In was cancelled or failed.');
    } finally {
      setLoading(false);
    }
  };

  const deptList = program === 'Degree' ? DEGREE_DEPTS : DIPLOMA_DEPTS;
  const yearList = program === 'Degree' ? DEGREE_YEARS : DIPLOMA_YEARS;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 px-4 sm:px-6">
      <div className="max-w-xl w-full mx-auto">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Library Overview
        </button>

        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200">
            <div>
              <img
                src="/src/assets/images/diet_official_logo.png"
                alt="Dnyanshree Institute of Engineering and Technology, Satara"
                referrerPolicy="no-referrer"
                className="h-10 w-auto object-contain mb-3"
              />
              <h1 className="text-xl font-bold text-slate-900">
                Dnyanshree Central Library Portal
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Dnyanshree Institute of Engineering & Technology, Satara · MFA Protected
              </p>
            </div>
          </div>

          {!mfaStep ? (
            <>
              {/* Role Selector */}
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg mt-6 mb-3">
                <button
                  type="button"
                  onClick={() => handleRoleSwitch('student')}
                  className={`px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    currentRole === 'student'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Student
                </button>
                <button
                  type="button"
                  onClick={() => handleRoleSwitch('teacher')}
                  className={`px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    currentRole === 'teacher'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Teacher / Faculty
                </button>
                <button
                  type="button"
                  onClick={() => handleRoleSwitch('admin')}
                  className={`px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    currentRole === 'admin'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Admin / Staff
                </button>
              </div>

              {/* Action Selector for Student & Teacher */}
              {currentRole !== 'admin' && (
                <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg mb-6">
                  <button
                    type="button"
                    onClick={() => {
                      setTab(currentRole === 'teacher' ? 'teacher-login' : 'student-login');
                      setError(null);
                    }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      !isRegister
                        ? 'bg-[#0F2942] text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTab(currentRole === 'teacher' ? 'teacher-register' : 'student-register');
                      setError(null);
                    }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      isRegister
                        ? 'bg-[#0F2942] text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Register New {currentRole === 'teacher' ? 'Faculty' : 'Student'}
                  </button>
                </div>
              )}

              {currentRole === 'admin' && <div className="mb-6" />}

              {error && (
                <div className="mb-5 p-3.5 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2.5 text-sm text-red-800">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-700" />
                  <span>{error}</span>
                </div>
              )}

              {tab === 'student-register' && (
                <form onSubmit={handleStudentRegister} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Select Academic Program (Degree or Diploma)
                    </label>
                    <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg">
                      <button
                        type="button"
                        onClick={() => handleProgramChange('Degree')}
                        className={`py-2 px-3 text-sm font-medium rounded-md transition-colors ${
                          program === 'Degree'
                            ? 'bg-[#0F2942] text-white'
                            : 'text-slate-700 hover:text-slate-900'
                        }`}
                      >
                        Degree (B.E. / B.Tech)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleProgramChange('Diploma')}
                        className={`py-2 px-3 text-sm font-medium rounded-md transition-colors ${
                          program === 'Diploma'
                            ? 'bg-[#0F2942] text-white'
                            : 'text-slate-700 hover:text-slate-900'
                        }`}
                      >
                        Diploma (Polytechnic)
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        PRN / Roll Number
                      </label>
                      <input
                        type="text"
                        required
                        value={prn}
                        onChange={(e) => setPrn(e.target.value.toUpperCase())}
                        placeholder={program === 'Degree' ? 'DEG-CS-2601' : 'DIP-CO-2601'}
                        className="w-full px-3.5 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Full Name
                      </label>
                      <input
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Pranav Deshpande"
                        className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Department
                      </label>
                      <select
                        value={department}
                        onChange={(e) => setDepartment(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                      >
                        {deptList.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Year
                      </label>
                      <select
                        value={academicYear}
                        onChange={(e) => setAcademicYear(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                      >
                        {yearList.map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Student Email ID
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="student@dnyanshree.edu.in"
                        className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Mobile Number (Optional)
                      </label>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+91 98230 00000"
                        className="w-full px-3.5 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Password (Min 8 chars, letters + numbers)
                    </label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Create a strong password"
                      className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#0F2942] text-white text-sm font-medium rounded-lg hover:bg-[#163A5C] disabled:opacity-50 transition-colors"
                  >
                    <UserPlus className="w-4 h-4" />
                    {loading ? 'Creating Profile & MFA Key...' : 'Register & Generate Library QR'}
                  </button>
                </form>
              )}

              {tab === 'teacher-register' && (
                <form onSubmit={handleTeacherRegister} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Select Teaching Wing (Degree or Diploma)
                    </label>
                    <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg">
                      <button
                        type="button"
                        onClick={() => handleProgramChange('Degree')}
                        className={`py-2 px-3 text-sm font-medium rounded-md transition-colors ${
                          program === 'Degree'
                            ? 'bg-[#0F2942] text-white'
                            : 'text-slate-700 hover:text-slate-900'
                        }`}
                      >
                        Degree Faculty
                      </button>
                      <button
                        type="button"
                        onClick={() => handleProgramChange('Diploma')}
                        className={`py-2 px-3 text-sm font-medium rounded-md transition-colors ${
                          program === 'Diploma'
                            ? 'bg-[#0F2942] text-white'
                            : 'text-slate-700 hover:text-slate-900'
                        }`}
                      >
                        Diploma Faculty
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Employee / Faculty ID
                      </label>
                      <input
                        type="text"
                        required
                        value={employeeId}
                        onChange={(e) => setEmployeeId(e.target.value.toUpperCase())}
                        placeholder={program === 'Degree' ? 'TCH-CS-105' : 'TCH-DIP-208'}
                        className="w-full px-3.5 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Faculty Full Name
                      </label>
                      <input
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Prof. Snehal Kulkarni"
                        className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Department
                      </label>
                      <select
                        value={department}
                        onChange={(e) => setDepartment(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                      >
                        {deptList.map((d) => (
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
                        value={designation}
                        onChange={(e) => setDesignation(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                      >
                        {TEACHER_DESIGNATIONS.map((desig) => (
                          <option key={desig} value={desig}>
                            {desig}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Faculty Email ID
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="faculty@dnyanshree.edu.in"
                        className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Mobile Number (Optional)
                      </label>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+91 98230 00000"
                        className="w-full px-3.5 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Password (Min 8 chars, letters + numbers)
                    </label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Create a strong password"
                      className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#0F2942] text-white text-sm font-medium rounded-lg hover:bg-[#163A5C] disabled:opacity-50 transition-colors"
                  >
                    <UserPlus className="w-4 h-4" />
                    {loading ? 'Creating Faculty Profile & MFA Key...' : 'Register & Generate Faculty QR'}
                  </button>
                </form>
              )}

              {tab === 'admin-login' && !adminClaimed && (
                <form onSubmit={handleAdminClaim} className="space-y-4">
                  <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 leading-relaxed">
                    <strong>First-Run Head Librarian Setup:</strong> Claim the primary library administrator account below. Once claimed, this setup locks permanently.
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Head Librarian Full Name
                    </label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Prof. S. V. Kulkarni"
                      className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Admin Email ID
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="librarian@dnyanshree.edu.in"
                      className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Set Admin Password (Min 8 chars, letters + numbers)
                    </label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Create Head Librarian password"
                      className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#0F2942] text-white text-sm font-medium rounded-lg hover:bg-[#163A5C] disabled:opacity-50 transition-colors"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    {loading ? 'Provisioning Admin MFA...' : 'Claim Head Librarian Account'}
                  </button>
                </form>
              )}

              {(tab === 'student-login' ||
                tab === 'teacher-login' ||
                (tab === 'admin-login' && adminClaimed)) && (
                <form onSubmit={handleLoginSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {tab === 'admin-login'
                        ? 'Librarian Email ID'
                        : tab === 'teacher-login'
                        ? 'Faculty Email ID'
                        : 'Student Email ID'}
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={
                        tab === 'admin-login'
                          ? 'librarian@dnyanshree.edu.in'
                          : tab === 'teacher-login'
                          ? 'faculty@dnyanshree.edu.in'
                          : 'student@dnyanshree.edu.in'
                      }
                      className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Password
                    </label>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#0F2942] text-white text-sm font-medium rounded-lg hover:bg-[#163A5C] disabled:opacity-50 transition-colors"
                  >
                    <LogIn className="w-4 h-4" />
                    {loading ? 'Validating...' : 'Continue to MFA Verification'}
                  </button>
                </form>
              )}

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white px-3 text-slate-500">
                    Or connect with Cloud Identity
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={loading}
                onClick={handleGoogleSignIn}
                className="w-full inline-flex items-center justify-center gap-2.5 px-4 py-2.5 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                  />
                </svg>
                Sign in with Google (
                {currentRole === 'admin'
                  ? 'Librarian Cloud Sync'
                  : currentRole === 'teacher'
                  ? 'Faculty SSO'
                  : 'Student SSO'}
                )
              </button>
            </>
          ) : (
            <form onSubmit={handleVerifyMfa} className="pt-6 space-y-5">
              <div className="flex items-start gap-3 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                <KeyRound className="w-5 h-5 text-[#0F2942] shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    Multi-Factor Authentication (TOTP)
                  </p>
                  <p className="text-xs text-slate-600 mt-1">
                    Verifying account <span className="font-medium text-slate-900">{mfaStep.email}</span>
                  </p>
                </div>
              </div>

              {mfaStep.mfaSetup && (
                <div className="p-4 border border-slate-200 rounded-lg bg-white space-y-3">
                  <p className="text-xs font-semibold text-slate-800">
                    Scan this QR code in Google Authenticator or Authy to save your MFA key:
                  </p>
                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <img
                      src={mfaStep.mfaSetup.totpQrDataUrl}
                      alt="MFA Authenticator QR"
                      className="w-36 h-36 border border-slate-200 rounded-lg p-1"
                    />
                    <div className="text-xs text-slate-600 space-y-2">
                      <div>
                        <span className="text-slate-500 block">Manual Setup Key (Base32):</span>
                        <code className="font-mono-tabular text-slate-900 bg-slate-100 px-2 py-1 rounded inline-block mt-1">
                          {mfaStep.mfaSetup.secret}
                        </code>
                      </div>
                      <div className="flex items-center gap-1.5 text-emerald-700 font-medium">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        Initial verification code pre-filled for enrollment confirmation.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Enter 6-Digit Authenticator Code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="w-full px-4 py-3 text-center text-xl tracking-[0.4em] font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setMfaStep(null);
                    setError(null);
                  }}
                  className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900 border border-slate-300 rounded-lg"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading || mfaCode.length !== 6}
                  className="flex-1 px-4 py-2.5 bg-[#0F2942] text-white text-sm font-medium rounded-lg hover:bg-[#163A5C] disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Verifying Code...' : 'Verify & Unlock Dashboard'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
