import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  QrCode,
  Users,
  FileSpreadsheet,
  Bell,
  CloudUpload,
  LogOut,
  Search,
  Download,
  Mail,
  Send,
  UserPlus,
  X,
  CheckCircle2,
  Briefcase,
} from 'lucide-react';
import { AuthenticatedSession } from './AuthPortal';
import { QrScannerPanel } from './QrScannerPanel';
import { syncCloudBackupMetaToFirestore } from '../firebase';
import {
  DEGREE_DEPARTMENTS,
  DIPLOMA_DEPARTMENTS,
  DEGREE_YEARS,
  DIPLOMA_YEARS,
  TEACHER_DESIGNATIONS,
  getDepartmentsForProgram,
} from '../constants/departments';

interface AdminStudent {
  id: string;
  prn: string;
  full_name: string;
  email: string;
  program: 'Degree' | 'Diploma';
  department: string;
  academic_year: string;
  visit_count: number;
  total_minutes: number;
  currently_inside: number;
  last_entry_at: string | null;
}

interface AdminTeacher {
  id: string;
  employee_id: string;
  full_name: string;
  email: string;
  program: 'Degree' | 'Diploma';
  department: string;
  designation: string;
  visit_count: number;
  total_minutes: number;
  currently_inside: number;
  last_entry_at: string | null;
}

interface AdminLog {
  id: string;
  student_id: string;
  prn: string;
  student_name: string;
  program: 'Degree' | 'Diploma';
  department: string;
  status: 'INSIDE' | 'COMPLETED';
  entry_time: string;
  exit_time: string | null;
  duration_minutes: number;
  scan_method: string;
  academic_session: string;
}

interface AdminTeacherLog {
  id: string;
  teacher_id: string;
  employee_id: string;
  teacher_name: string;
  program: 'Degree' | 'Diploma';
  department: string;
  designation: string;
  status: 'INSIDE' | 'COMPLETED';
  entry_time: string;
  exit_time: string | null;
  duration_minutes: number;
  scan_method: string;
  academic_session: string;
}

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  created_at: string;
  is_read: number;
}

interface ReportConfig {
  recipient_email: string;
  schedule_day: string;
  schedule_time: string;
  ntfy_topic: string;
  enabled: number;
  last_sent_at: string | null;
}

interface BackupItem {
  id: string;
  created_by: string;
  student_count: number;
  log_count: number;
  academic_range: string;
  checksum: string;
  file_size_kb: number;
  created_at: string;
}

interface OutboxItem {
  id: string;
  recipient_email: string;
  subject: string;
  summary_text: string;
  delivery_status: string;
  created_at: string;
}

interface AdminDashboardProps {
  session: AuthenticatedSession;
  gateQrDataUrl: string;
  onSignOut: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  session,
  gateQrDataUrl,
  onSignOut,
}) => {
  const [section, setSection] = useState<
    'analytics' | 'scanner' | 'frequency' | 'teachers' | 'logs' | 'reports'
  >('analytics');
  const [programFilter, setProgramFilter] = useState<'ALL' | 'Degree' | 'Diploma'>('ALL');
  const [departmentFilter, setDepartmentFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const [students, setStudents] = useState<AdminStudent[]>([]);
  const [teachers, setTeachers] = useState<AdminTeacher[]>([]);
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [teacherLogs, setTeacherLogs] = useState<AdminTeacherLog[]>([]);
  const [logsView, setLogsView] = useState<'students' | 'teachers'>('students');
  const [deptBreakdown, setDeptBreakdown] = useState<
    Array<{ program: string; department: string; students: number; visits: number; active_inside: number }>
  >([]);
  const [hourlyBuckets, setHourlyBuckets] = useState<
    Array<{ hour: string; entries: number; degree_entries: number; diploma_entries: number }>
  >([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [queryTimeMs, setQueryTimeMs] = useState<number>(0);

  // Report Config Form
  const [recipientEmail, setRecipientEmail] = useState('librarian@dnyanshree.edu.in');
  const [scheduleDay, setScheduleDay] = useState('Monday');
  const [scheduleTime, setScheduleTime] = useState('08:30');
  const [ntfyTopic, setNtfyTopic] = useState('');
  const [reportEnabled, setReportEnabled] = useState(true);
  const [reportStatusMsg, setReportStatusMsg] = useState<string | null>(null);
  const [browserPushGranted, setBrowserPushGranted] = useState<boolean>(
    typeof Notification !== 'undefined' && Notification.permission === 'granted'
  );

  // Visit History Inspector Modal (Student or Faculty)
  const [inspectedTitle, setInspectedTitle] = useState<string | null>(null);
  const [inspectedSubtitle, setInspectedSubtitle] = useState<string>('');
  const [inspectedLogs, setInspectedLogs] = useState<
    Array<{ id: string; entry_time: string; exit_time: string | null; status: string; duration_minutes: number; scan_method: string }>
  >([]);

  // Enroll Student Modal
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [newPrn, setNewPrn] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newProgram, setNewProgram] = useState<'Degree' | 'Diploma'>('Degree');
  const [newDept, setNewDept] = useState(DEGREE_DEPARTMENTS[0]);
  const [newYear, setNewYear] = useState('3rd Year');
  const [enrollError, setEnrollError] = useState<string | null>(null);

  // Enroll Faculty Modal
  const [showEnrollTeacherModal, setShowEnrollTeacherModal] = useState(false);
  const [newEmpId, setNewEmpId] = useState('');
  const [newTchName, setNewTchName] = useState('');
  const [newTchEmail, setNewTchEmail] = useState('');
  const [newTchProgram, setNewTchProgram] = useState<'Degree' | 'Diploma'>('Degree');
  const [newTchDept, setNewTchDept] = useState(DEGREE_DEPARTMENTS[0]);
  const [newTchDesig, setNewTchDesig] = useState(TEACHER_DESIGNATIONS[2]);
  const [enrollTeacherError, setEnrollTeacherError] = useState<string | null>(null);

  const fetchDashboard = async () => {
    try {
      const params = new URLSearchParams({
        program: programFilter,
        department: departmentFilter,
        search: searchQuery,
      });
      const res = await fetch(`/api/admin/dashboard?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (!res.ok) throw new Error('Failed to load admin metrics');
      const data = await res.json();
      setStudents(data.students);
      setTeachers(data.teachers || []);
      setLogs(data.logs);
      setTeacherLogs(data.teacherLogs || []);
      setDeptBreakdown(data.deptBreakdown);
      setHourlyBuckets(data.hourlyBuckets);
      setNotifications(data.notifications);
      setBackups(data.backups);
      setOutbox(data.outbox);
      setQueryTimeMs(data.queryTimeMs);
      if (data.reportConfig) {
        const cfg = data.reportConfig as ReportConfig;
        setRecipientEmail(cfg.recipient_email);
        setScheduleDay(cfg.schedule_day);
        setScheduleTime(cfg.schedule_time);
        setNtfyTopic(cfg.ntfy_topic || '');
        setReportEnabled(cfg.enabled === 1);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, [programFilter, departmentFilter, searchQuery, session.token]);

  const metrics = useMemo(() => {
    const studentsInside = students.filter((s) => s.currently_inside === 1).length;
    const teachersInside = teachers.filter((t) => t.currently_inside === 1).length;
    const insideNow = studentsInside + teachersInside;
    const degreeInside = students.filter(
      (s) => s.currently_inside === 1 && s.program === 'Degree'
    ).length;
    const diplomaInside = students.filter(
      (s) => s.currently_inside === 1 && s.program === 'Diploma'
    ).length;
    const totalVisits =
      students.reduce((acc, s) => acc + s.visit_count, 0) +
      teachers.reduce((acc, t) => acc + t.visit_count, 0);
    const totalMinutes =
      students.reduce((acc, s) => acc + s.total_minutes, 0) +
      teachers.reduce((acc, t) => acc + t.total_minutes, 0);
    const totalHours = Math.round((totalMinutes / 60) * 10) / 10;
    return {
      insideNow,
      studentsInside,
      teachersInside,
      degreeInside,
      diplomaInside,
      totalVisits,
      totalHours,
    };
  }, [students, teachers]);

  const handleKioskScan = async (payload: string) => {
    const res = await fetch('/api/kiosk/scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ qrPayload: payload, scanMethod: 'QR_KIOSK' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Scan failed');

    const memberName = data.member?.full_name || data.student?.full_name || data.teacher?.full_name;
    const memberCode = data.member?.code || data.student?.prn || data.teacher?.employee_id;
    const memberProgram = data.member?.program || data.student?.program || data.teacher?.program;
    const memberVisits = data.member?.visit_count ?? data.student?.visit_count ?? data.teacher?.visit_count;
    const roleSuffix = data.memberType === 'teacher' ? ' (Faculty)' : '';

    if (browserPushGranted && typeof Notification !== 'undefined') {
      new Notification(`DIET Library ${data.action}${roleSuffix}: ${memberName}`, {
        body: `${memberCode} (${memberProgram}) · Visit #${memberVisits}`,
      });
    }

    await fetchDashboard();
    return {
      action: data.action as 'IN' | 'OUT',
      message: `${memberName}${roleSuffix} (${memberCode} · ${memberProgram}) — Total Visits: ${memberVisits}`,
    };
  };

  const handleExportExcel = async () => {
    const params = new URLSearchParams({
      program: programFilter,
      department: departmentFilter,
    });
    const res = await fetch(`/api/reports/export.xlsx?${params.toString()}`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `DIET_Satara_Library_${programFilter}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleInspectStudent = async (student: AdminStudent) => {
    setInspectedTitle(student.full_name);
    setInspectedSubtitle(
      `${student.prn} · ${student.program} · ${student.department} · ${student.visit_count} Total Visits`
    );
    const res = await fetch(`/api/admin/students/${student.id}/logs`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setInspectedLogs(data.logs);
    }
  };

  const handleInspectTeacher = async (teacher: AdminTeacher) => {
    setInspectedTitle(`${teacher.full_name} (Faculty)`);
    setInspectedSubtitle(
      `${teacher.employee_id} · ${teacher.designation} · ${teacher.program} · ${teacher.department} · ${teacher.visit_count} Total Visits`
    );
    const res = await fetch(`/api/admin/teachers/${teacher.id}/logs`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setInspectedLogs(data.logs);
    }
  };

  const handleSaveReportConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setReportStatusMsg(null);
    const res = await fetch('/api/admin/report-config', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({
        recipientEmail,
        scheduleDay,
        scheduleTime,
        ntfyTopic,
        enabled: reportEnabled,
      }),
    });
    if (res.ok) {
      setReportStatusMsg('Weekly report schedule and mobile notification settings saved.');
      await fetchDashboard();
    }
  };

  const handleSendWeeklyReportNow = async () => {
    setReportStatusMsg('Generating weekly report & Excel digest...');
    const res = await fetch('/api/admin/send-weekly-report', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}` },
    });
    const data = await res.json();
    if (res.ok) {
      setReportStatusMsg(
        `Weekly digest prepared for ${data.recipientEmail} (${data.deliveryMode}).`
      );
      await fetchDashboard();
    }
  };

  const handleEnableBrowserPush = async () => {
    if (typeof Notification === 'undefined') return;
    const perm = await Notification.requestPermission();
    setBrowserPushGranted(perm === 'granted');
    if (perm === 'granted') {
      await fetch('/api/admin/test-notification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ ntfyTopic }),
      });
      new Notification('DIET Library Mobile Alerts Enabled', {
        body: 'You will receive live check-in, check-out, and weekly report alerts.',
      });
      await fetchDashboard();
    }
  };

  const handleCreateBackup = async () => {
    const res = await fetch('/api/admin/backups', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (res.ok) {
      const bkp = await res.json();
      syncCloudBackupMetaToFirestore({
        backupId: bkp.backupId,
        recordCount: bkp.logCount,
        studentCount: bkp.studentCount,
        checksum: bkp.checksum,
        academicRange: '2026-27',
      }).catch(() => {
        // Optional Firestore sync when Firebase Auth is connected
      });
      setReportStatusMsg(`Archival snapshot ${bkp.backupId} created (SHA-256: ${bkp.checksum}).`);
      await fetchDashboard();
    }
  };

  const handleDownloadBackup = async (backupId: string) => {
    const res = await fetch(`/api/admin/backups/${backupId}/download`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${backupId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleEnrollStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnrollError(null);
    const res = await fetch('/api/admin/students', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({
        prn: newPrn,
        fullName: newName,
        email: newEmail,
        program: newProgram,
        department: newDept,
        academicYear: newYear,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setEnrollError(data.error || 'Failed to enroll student.');
      return;
    }
    setShowEnrollModal(false);
    setNewPrn('');
    setNewName('');
    setNewEmail('');
    await fetchDashboard();
  };

  const handleEnrollTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnrollTeacherError(null);
    const res = await fetch('/api/admin/teachers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({
        employeeId: newEmpId,
        fullName: newTchName,
        email: newTchEmail,
        program: newTchProgram,
        department: newTchDept,
        designation: newTchDesig,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setEnrollTeacherError(data.error || 'Failed to enroll faculty member.');
      return;
    }
    setShowEnrollTeacherModal(false);
    setNewEmpId('');
    setNewTchName('');
    setNewTchEmail('');
    await fetchDashboard();
  };

  const maxHourEntries = Math.max(1, ...hourlyBuckets.map((b) => b.entries));

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
            <p className="text-xs text-slate-500 truncate">Librarian Console</p>
          </div>

          <nav className="mt-5 space-y-1">
            {[
              { id: 'analytics', label: 'Real-Time Analytics', icon: BarChart3 },
              { id: 'scanner', label: 'Gate QR Scanner', icon: QrCode },
              { id: 'frequency', label: 'Student Visit Frequency', icon: Users },
              { id: 'teachers', label: 'Faculty Visit Frequency', icon: Briefcase },
              { id: 'logs', label: 'Entry & Exit Logs', icon: FileSpreadsheet },
              { id: 'reports', label: 'Reports, Backup & Alerts', icon: Bell },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id as typeof section)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                    section === item.id
                      ? 'bg-[#0F2942] text-white'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="pt-5 mt-6 border-t border-slate-200">
          <div className="flex items-center gap-3">
            <img
              src="/src/assets/images/librarian_admin_avatar_1795247875814.jpg"
              alt="Head Librarian"
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-full object-cover border border-slate-200 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-900 truncate">
                {session.user.fullName}
              </p>
              <p className="text-xs text-slate-500 truncate">{session.user.email}</p>
            </div>
          </div>
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
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm text-slate-600">
            <span>Dnyanshree Institute, Satara</span>
            <span className="mx-2 text-slate-300">/</span>
            <span className="font-medium text-slate-900">
              {section === 'analytics' && 'Real-Time Analytics'}
              {section === 'scanner' && 'Gate QR Scanner Kiosk'}
              {section === 'frequency' && 'Student Visit Frequency Tracker'}
              {section === 'teachers' && 'Faculty / Teacher Visit Tracker'}
              {section === 'logs' && 'Chronological Entry & Exit Logs'}
              {section === 'reports' && 'Excel, Weekly Email & Cloud Backup'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#0F2942] text-white text-xs font-medium rounded-lg hover:bg-[#163A5C] transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Export Excel (.xlsx)
            </button>
          </div>
        </header>

        <main className="p-6 max-w-7xl w-full mx-auto space-y-6">
          {/* Global Filter Bar (Shown on data tabs) */}
          {section !== 'reports' && (
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(['ALL', 'Degree', 'Diploma'] as const).map((prog) => (
                    <button
                      key={prog}
                      type="button"
                      onClick={() => {
                        setProgramFilter(prog);
                        setDepartmentFilter('ALL');
                      }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        programFilter === prog
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {prog === 'ALL' ? 'All Programs' : `${prog} Wing`}
                    </button>
                  ))}
                </div>

                <select
                  aria-label="Filter by Department"
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className="px-3 py-1.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-[#0F2942]"
                >
                  <option value="ALL">
                    All {programFilter === 'ALL' ? '' : `${programFilter} `}Departments
                  </option>
                  {getDepartmentsForProgram(programFilter).map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-3 flex-1 min-w-[220px] max-w-md">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search student name, PRN, or department..."
                    className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-[#0F2942]"
                  />
                </div>
                <span className="text-xs font-mono-tabular text-slate-500 whitespace-nowrap">
                  {queryTimeMs} ms
                </span>
              </div>
            </div>
          )}

          {/* Section: Real-Time Analytics */}
          {section === 'analytics' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <p className="text-xs font-medium text-slate-500">Currently Inside Hall</p>
                  <p className="text-3xl font-bold font-mono-tabular text-slate-900 mt-1.5">
                    {metrics.insideNow}
                    <span className="text-sm font-normal text-slate-400"> / 150 seats</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-2">
                    Degree: {metrics.degreeInside} · Diploma: {metrics.diplomaInside} · Faculty: {metrics.teachersInside}
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <p className="text-xs font-medium text-slate-500">Filtered Profiles</p>
                  <p className="text-3xl font-bold font-mono-tabular text-slate-900 mt-1.5">
                    {students.length + teachers.length}
                  </p>
                  <p className="text-xs text-slate-500 mt-2">
                    {students.length} students · {teachers.length} faculty
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <p className="text-xs font-medium text-slate-500">Total Visits Logged</p>
                  <p className="text-3xl font-bold font-mono-tabular text-slate-900 mt-1.5">
                    {metrics.totalVisits}
                  </p>
                  <p className="text-xs text-slate-500 mt-2">
                    Cumulative study: {metrics.totalHours} hrs
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <p className="text-xs font-medium text-slate-500">Archival Snapshots</p>
                  <p className="text-3xl font-bold font-mono-tabular text-slate-900 mt-1.5">
                    {backups.length}
                  </p>
                  <p className="text-xs text-slate-500 mt-2">
                    10–12 year retention enabled
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Hourly Footfall Bar Chart */}
                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
                  <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">
                        Hourly Library Entry Distribution
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Degree (Navy) vs. Diploma (Brass) check-ins by hour of day
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 h-56 flex items-end gap-2 sm:gap-3 pt-4">
                    {hourlyBuckets.length === 0 ? (
                      <p className="text-xs text-slate-500 m-auto">No hourly telemetry yet.</p>
                    ) : (
                      hourlyBuckets.map((bucket) => {
                        const totalH = Math.max(8, Math.round((bucket.entries / maxHourEntries) * 165));
                        const degShare =
                          bucket.entries > 0
                            ? Math.round((bucket.degree_entries / bucket.entries) * totalH)
                            : 0;
                        const dipShare = Math.max(0, totalH - degShare);
                        return (
                          <div key={bucket.hour} className="flex-1 flex flex-col items-center gap-1.5">
                            <span className="text-[11px] font-mono-tabular text-slate-500">
                              {bucket.entries}
                            </span>
                            <div className="w-full max-w-[32px] flex flex-col justify-end rounded-t overflow-hidden bg-slate-100">
                              {dipShare > 0 && (
                                <div
                                  style={{ height: `${dipShare}px` }}
                                  className="w-full bg-amber-600"
                                  title={`Diploma: ${bucket.diploma_entries}`}
                                />
                              )}
                              {degShare > 0 && (
                                <div
                                  style={{ height: `${degShare}px` }}
                                  className="w-full bg-[#0F2942]"
                                  title={`Degree: ${bucket.degree_entries}`}
                                />
                              )}
                            </div>
                            <span className="text-[11px] font-mono-tabular text-slate-600">
                              {bucket.hour}:00
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Department Breakdown */}
                <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6">
                  <h3 className="text-base font-semibold text-slate-900 pb-4 border-b border-slate-200">
                    Department & Stream Utilization
                  </h3>
                  <div className="mt-4 divide-y divide-slate-100 max-h-64 overflow-y-auto">
                    {deptBreakdown.map((row) => (
                      <button
                        type="button"
                        key={`${row.program}-${row.department}`}
                        onClick={() => {
                          setProgramFilter(row.program as 'Degree' | 'Diploma');
                          setDepartmentFilter(row.department);
                        }}
                        className="w-full text-left py-2.5 px-2 -mx-2 rounded-lg hover:bg-slate-50 flex items-center justify-between text-xs transition-colors"
                      >
                        <div className="min-w-0 pr-3">
                          <p className="font-medium text-slate-900 truncate">{row.department}</p>
                          <p className="text-slate-500">
                            {row.program} · {row.students} students
                          </p>
                        </div>
                        <div className="text-right font-mono-tabular shrink-0">
                          <p className="font-semibold text-slate-900">{row.visits} visits</p>
                          <p className="text-emerald-700">{row.active_inside} inside</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Recent Admin Notifications Feed */}
              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                  <h3 className="text-base font-semibold text-slate-900">
                    Live Gate & System Notifications
                  </h3>
                  <button
                    type="button"
                    onClick={() => setSection('reports')}
                    className="text-xs font-medium text-[#0F2942] hover:underline"
                  >
                    Configure Mobile Alerts
                  </button>
                </div>
                <div className="divide-y divide-slate-100 mt-2">
                  {notifications.slice(0, 6).map((n) => (
                    <div key={n.id} className="py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div>
                        <span className="font-semibold text-slate-900">{n.title}</span>
                        <span className="text-slate-400 mx-2">·</span>
                        <span className="text-slate-600">{n.message}</span>
                      </div>
                      <span className="font-mono-tabular text-slate-500">
                        {new Date(n.created_at).toLocaleTimeString('en-IN')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Section: Gate QR Scanner */}
          {section === 'scanner' && (
            <div className="space-y-6">
              <QrScannerPanel
                mode="kiosk"
                onScanPayload={handleKioskScan}
                sampleCodes={[
                  ...students.slice(0, 3).map((s) => ({
                    label: `${s.full_name.split(' ')[0]} (${s.prn})`,
                    payload: s.prn,
                  })),
                  ...teachers.slice(0, 2).map((t) => ({
                    label: `${t.full_name.split(' ').slice(0, 2).join(' ')} (${t.employee_id})`,
                    payload: t.employee_id,
                  })),
                ]}
              />

              <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row items-center gap-6">
                {gateQrDataUrl && (
                  <img
                    src={gateQrDataUrl}
                    alt="One Universal Gate QR for All Students and Teachers"
                    className="w-40 h-40 border border-slate-200 rounded-lg p-2 shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-500">
                    One Universal QR · All Students &amp; Teachers
                  </p>
                  <h3 className="text-base font-semibold text-slate-900 mt-0.5">
                    Printable Library Entrance Gate QR Poster
                  </h3>
                  <p className="text-sm text-slate-600 mt-1 leading-relaxed max-w-xl">
                    Display this single QR code at the Central Library entrance desk. All registered
                    Degree &amp; Diploma students and all Teachers/Faculty scan this same QR from their
                    portal camera for contactless IN/OUT logging.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <code className="text-xs font-mono-tabular text-slate-700 bg-slate-100 px-2.5 py-1 rounded">
                      DIET-GATE:CENTRAL-LIBRARY-SATARA
                    </code>
                    {gateQrDataUrl && (
                      <a
                        href={gateQrDataUrl}
                        download="DIET_Universal_Gate_QR.png"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0F2942] text-white text-xs font-medium rounded-lg hover:bg-[#163A5C] transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download Universal QR (PNG)
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Section: Student Visit Frequency Tracker */}
          {section === 'frequency' && (
            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Student Visit Frequency & Engagement Tracker
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Ranked attendance count per student across Degree & Diploma programs. Click &ldquo;Inspect&rdquo; for individual entry/exit timelines.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowEnrollModal(true)}
                  className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#0F2942] text-white text-xs font-medium rounded-lg hover:bg-[#163A5C] transition-colors whitespace-nowrap shrink-0"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  Enroll Student
                </button>
              </div>

              <div className="overflow-x-auto mt-4">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2.5 pr-4 font-medium">PRN</th>
                      <th className="py-2.5 pr-4 font-medium">Student Name</th>
                      <th className="py-2.5 pr-4 font-medium">Program · Dept</th>
                      <th className="py-2.5 pr-4 font-medium text-right">Total Visits</th>
                      <th className="py-2.5 pr-4 font-medium text-right">Hours Spent</th>
                      <th className="py-2.5 pr-4 font-medium">Status</th>
                      <th className="py-2.5 font-medium text-right">History</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {students.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50">
                        <td className="py-3 pr-4 font-mono-tabular font-medium text-slate-900">
                          {s.prn}
                        </td>
                        <td className="py-3 pr-4 font-medium text-slate-900">{s.full_name}</td>
                        <td className="py-3 pr-4 text-slate-600">
                          {s.program} · {s.department} ({s.academic_year})
                        </td>
                        <td className="py-3 pr-4 font-mono-tabular text-right font-bold text-[#0F2942]">
                          {s.visit_count}
                        </td>
                        <td className="py-3 pr-4 font-mono-tabular text-right text-slate-700">
                          {Math.round((s.total_minutes / 60) * 10) / 10} hrs
                        </td>
                        <td className="py-3 pr-4">
                          <span
                            className={`font-medium ${
                              s.currently_inside === 1 ? 'text-emerald-700' : 'text-slate-500'
                            }`}
                          >
                            {s.currently_inside === 1 ? 'Inside Hall' : 'Checked Out'}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleInspectStudent(s)}
                            className="text-xs font-medium text-[#0F2942] hover:underline"
                          >
                            Inspect Logs
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Section: Faculty Visit Frequency Tracker */}
          {section === 'teachers' && (
            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Faculty / Teacher Visit Frequency Tracker
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Ranked library visit count per faculty member across Degree & Diploma departments. Click &ldquo;Inspect Logs&rdquo; for timelines.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowEnrollTeacherModal(true)}
                  className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#0F2942] text-white text-xs font-medium rounded-lg hover:bg-[#163A5C] transition-colors whitespace-nowrap shrink-0"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  Enroll Faculty
                </button>
              </div>

              <div className="overflow-x-auto mt-4">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2.5 pr-4 font-medium">Employee ID</th>
                      <th className="py-2.5 pr-4 font-medium">Faculty Name</th>
                      <th className="py-2.5 pr-4 font-medium">Designation</th>
                      <th className="py-2.5 pr-4 font-medium">Wing · Dept</th>
                      <th className="py-2.5 pr-4 font-medium text-right">Total Visits</th>
                      <th className="py-2.5 pr-4 font-medium text-right">Hours Spent</th>
                      <th className="py-2.5 pr-4 font-medium">Status</th>
                      <th className="py-2.5 font-medium text-right">History</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {teachers.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50">
                        <td className="py-3 pr-4 font-mono-tabular font-medium text-slate-900">
                          {t.employee_id}
                        </td>
                        <td className="py-3 pr-4 font-medium text-slate-900">{t.full_name}</td>
                        <td className="py-3 pr-4 text-slate-600">{t.designation}</td>
                        <td className="py-3 pr-4 text-slate-600">
                          {t.program} · {t.department}
                        </td>
                        <td className="py-3 pr-4 font-mono-tabular text-right font-bold text-[#0F2942]">
                          {t.visit_count}
                        </td>
                        <td className="py-3 pr-4 font-mono-tabular text-right text-slate-700">
                          {Math.round((t.total_minutes / 60) * 10) / 10} hrs
                        </td>
                        <td className="py-3 pr-4">
                          <span
                            className={`font-medium ${
                              t.currently_inside === 1 ? 'text-emerald-700' : 'text-slate-500'
                            }`}
                          >
                            {t.currently_inside === 1 ? 'Inside Hall' : 'Checked Out'}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleInspectTeacher(t)}
                            className="text-xs font-medium text-[#0F2942] hover:underline"
                          >
                            Inspect Logs
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Section: Entry & Exit Logs */}
          {section === 'logs' && (
            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Chronological In/Out Attendance Ledger
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Showing{' '}
                    {logsView === 'students' ? `${logs.length} student` : `${teacherLogs.length} faculty`}{' '}
                    most recent indexed records
                  </p>
                </div>
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setLogsView('students')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      logsView === 'students'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Student Logs ({logs.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setLogsView('teachers')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      logsView === 'teachers'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Faculty Logs ({teacherLogs.length})
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto mt-4">
                {logsView === 'students' ? (
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2.5 pr-4 font-medium">PRN</th>
                        <th className="py-2.5 pr-4 font-medium">Student</th>
                        <th className="py-2.5 pr-4 font-medium">Program · Dept</th>
                        <th className="py-2.5 pr-4 font-medium">Entry Time</th>
                        <th className="py-2.5 pr-4 font-medium">Exit Time</th>
                        <th className="py-2.5 pr-4 font-medium text-right">Duration</th>
                        <th className="py-2.5 font-medium">Method</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {logs.map((l) => (
                        <tr key={l.id} className="hover:bg-slate-50">
                          <td className="py-3 pr-4 font-mono-tabular font-medium text-slate-900">
                            {l.prn}
                          </td>
                          <td className="py-3 pr-4 font-medium text-slate-900">{l.student_name}</td>
                          <td className="py-3 pr-4 text-slate-600">
                            {l.program} · {l.department}
                          </td>
                          <td className="py-3 pr-4 font-mono-tabular text-slate-700">
                            {new Date(l.entry_time).toLocaleString('en-IN')}
                          </td>
                          <td className="py-3 pr-4 font-mono-tabular text-slate-700">
                            {l.exit_time ? (
                              new Date(l.exit_time).toLocaleTimeString('en-IN')
                            ) : (
                              <span className="text-emerald-700 font-medium">Active Inside</span>
                            )}
                          </td>
                          <td className="py-3 pr-4 font-mono-tabular text-right text-slate-900">
                            {l.status === 'INSIDE' ? '—' : `${l.duration_minutes} min`}
                          </td>
                          <td className="py-3 text-slate-500">{l.scan_method}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2.5 pr-4 font-medium">Employee ID</th>
                        <th className="py-2.5 pr-4 font-medium">Faculty</th>
                        <th className="py-2.5 pr-4 font-medium">Wing · Dept</th>
                        <th className="py-2.5 pr-4 font-medium">Entry Time</th>
                        <th className="py-2.5 pr-4 font-medium">Exit Time</th>
                        <th className="py-2.5 pr-4 font-medium text-right">Duration</th>
                        <th className="py-2.5 font-medium">Method</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {teacherLogs.map((l) => (
                        <tr key={l.id} className="hover:bg-slate-50">
                          <td className="py-3 pr-4 font-mono-tabular font-medium text-slate-900">
                            {l.employee_id}
                          </td>
                          <td className="py-3 pr-4 font-medium text-slate-900">
                            {l.teacher_name}
                            <span className="block text-[11px] font-normal text-slate-500">
                              {l.designation}
                            </span>
                          </td>
                          <td className="py-3 pr-4 text-slate-600">
                            {l.program} · {l.department}
                          </td>
                          <td className="py-3 pr-4 font-mono-tabular text-slate-700">
                            {new Date(l.entry_time).toLocaleString('en-IN')}
                          </td>
                          <td className="py-3 pr-4 font-mono-tabular text-slate-700">
                            {l.exit_time ? (
                              new Date(l.exit_time).toLocaleTimeString('en-IN')
                            ) : (
                              <span className="text-emerald-700 font-medium">Active Inside</span>
                            )}
                          </td>
                          <td className="py-3 pr-4 font-mono-tabular text-right text-slate-900">
                            {l.status === 'INSIDE' ? '—' : `${l.duration_minutes} min`}
                          </td>
                          <td className="py-3 text-slate-500">{l.scan_method}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* Section: Reports, Mobile Alerts & Cloud Backup */}
          {section === 'reports' && (
            <div className="space-y-6">
              {reportStatusMsg && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2.5 text-sm text-emerald-900">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>{reportStatusMsg}</span>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Automated Weekly Email & Mobile Alert Settings */}
                <div className="bg-white border border-slate-200 rounded-xl p-6">
                  <div className="flex items-center gap-2.5 pb-4 border-b border-slate-200">
                    <Mail className="w-5 h-5 text-[#0F2942]" />
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">
                        Automated Weekly Email & Mobile Push
                      </h3>
                      <p className="text-xs text-slate-500">
                        Schedule Excel attendance digests and configure mobile push channels
                      </p>
                    </div>
                  </div>

                  <form onSubmit={handleSaveReportConfig} className="mt-5 space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Librarian Recipient Email
                      </label>
                      <input
                        type="email"
                        required
                        value={recipientEmail}
                        onChange={(e) => setRecipientEmail(e.target.value)}
                        className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Weekly Day
                        </label>
                        <select
                          value={scheduleDay}
                          onChange={(e) => setScheduleDay(e.target.value)}
                          className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                        >
                          {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
                            (d) => (
                              <option key={d} value={d}>
                                {d}
                              </option>
                            )
                          )}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Dispatch Time (24h)
                        </label>
                        <input
                          type="time"
                          value={scheduleTime}
                          onChange={(e) => setScheduleTime(e.target.value)}
                          className="w-full px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Mobile Push Topic (ntfy.sh app channel, optional)
                      </label>
                      <input
                        type="text"
                        value={ntfyTopic}
                        onChange={(e) => setNtfyTopic(e.target.value)}
                        placeholder="e.g. diet-satara-library-alerts"
                        className="w-full px-3.5 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg"
                      />
                    </div>

                    <label className="flex items-center gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={reportEnabled}
                        onChange={(e) => setReportEnabled(e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      Enable automated weekly email digest scheduler
                    </label>

                    <div className="flex flex-wrap gap-3 pt-2">
                      <button
                        type="submit"
                        className="px-4 py-2 bg-[#0F2942] text-white text-xs font-medium rounded-lg hover:bg-[#163A5C] transition-colors"
                      >
                        Save Schedule
                      </button>
                      <button
                        type="button"
                        onClick={handleSendWeeklyReportNow}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 transition-colors"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Send Weekly Digest Now
                      </button>
                      <button
                        type="button"
                        onClick={handleEnableBrowserPush}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 transition-colors"
                      >
                        <Bell className="w-3.5 h-3.5" />
                        {browserPushGranted ? 'Test Browser Alert' : 'Enable Device Push Alerts'}
                      </button>
                    </div>
                  </form>
                </div>

                {/* 10-12 Year Cloud Backup & Snapshots */}
                <div className="bg-white border border-slate-200 rounded-xl p-6">
                  <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                    <div className="flex items-center gap-2.5">
                      <CloudUpload className="w-5 h-5 text-[#0F2942]" />
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">
                          10–12 Year Cloud Archive & Snapshots
                        </h3>
                        <p className="text-xs text-slate-500">
                          SHA-256 verified JSON archives + Firestore sync
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleCreateBackup}
                      className="px-3.5 py-2 bg-[#0F2942] text-white text-xs font-medium rounded-lg hover:bg-[#163A5C] transition-colors whitespace-nowrap"
                    >
                      Create Snapshot
                    </button>
                  </div>

                  <div className="mt-4 divide-y divide-slate-100 max-h-72 overflow-y-auto">
                    {backups.map((b) => (
                      <div key={b.id} className="py-3 flex items-center justify-between gap-4 text-xs">
                        <div>
                          <p className="font-mono-tabular font-medium text-slate-900">{b.id}</p>
                          <p className="text-slate-500 mt-0.5">
                            {b.student_count} students · {b.log_count} logs · SHA-256: {b.checksum}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDownloadBackup(b.id)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#0F2942] hover:underline shrink-0"
                        >
                          <Download className="w-3.5 h-3.5" />
                          JSON ({b.file_size_kb} KB)
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Weekly Email Digest Outbox Preview */}
              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <h3 className="text-base font-semibold text-slate-900 pb-4 border-b border-slate-200">
                  Dispatched Weekly Email Digests
                </h3>
                {outbox.length === 0 ? (
                  <p className="text-xs text-slate-500 pt-4">
                    No weekly digests dispatched yet. Click &ldquo;Send Weekly Digest Now&rdquo; above to generate and inspect a report.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200 mt-2">
                    {outbox.map((mail) => (
                      <div key={mail.id} className="py-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-slate-900">{mail.subject}</span>
                          <span className="font-mono-tabular text-slate-500">
                            To: {mail.recipient_email} · {mail.delivery_status} ·{' '}
                            {new Date(mail.created_at).toLocaleString('en-IN')}
                          </span>
                        </div>
                        <pre className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono-tabular text-slate-700 whitespace-pre-wrap">
                          {mail.summary_text}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Modal: Inspect Individual Member Visit Timeline */}
      {inspectedTitle && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full p-6 max-h-[85vh] flex flex-col">
            <div className="flex items-start justify-between pb-4 border-b border-slate-200">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{inspectedTitle}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{inspectedSubtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setInspectedTitle(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto mt-4 flex-1">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3 font-medium">Entry Timestamp</th>
                    <th className="py-2 pr-3 font-medium">Exit Timestamp</th>
                    <th className="py-2 pr-3 font-medium text-right">Duration</th>
                    <th className="py-2 font-medium">Method</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {inspectedLogs.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2.5 pr-3 font-mono-tabular text-slate-800">
                        {new Date(l.entry_time).toLocaleString('en-IN')}
                      </td>
                      <td className="py-2.5 pr-3 font-mono-tabular text-slate-600">
                        {l.exit_time ? new Date(l.exit_time).toLocaleString('en-IN') : 'Active'}
                      </td>
                      <td className="py-2.5 pr-3 font-mono-tabular text-right">
                        {l.status === 'INSIDE' ? '—' : `${l.duration_minutes} min`}
                      </td>
                      <td className="py-2.5 text-slate-500">{l.scan_method}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Quick Enroll Student */}
      {showEnrollModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">Enroll New Student Profile</h3>
              <button
                type="button"
                onClick={() => setShowEnrollModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleEnrollStudent} className="mt-4 space-y-3.5">
              {enrollError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 p-2.5 rounded-lg">
                  {enrollError}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setNewProgram('Degree');
                    setNewDept(DEGREE_DEPARTMENTS[0]);
                    setNewYear('3rd Year');
                  }}
                  className={`py-1.5 text-xs font-medium rounded-md ${
                    newProgram === 'Degree' ? 'bg-[#0F2942] text-white' : 'text-slate-700'
                  }`}
                >
                  Degree
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNewProgram('Diploma');
                    setNewDept(DIPLOMA_DEPARTMENTS[0]);
                    setNewYear('3rd Year');
                  }}
                  className={`py-1.5 text-xs font-medium rounded-md ${
                    newProgram === 'Diploma' ? 'bg-[#0F2942] text-white' : 'text-slate-700'
                  }`}
                >
                  Diploma
                </button>
              </div>
              <input
                type="text"
                required
                value={newPrn}
                onChange={(e) => setNewPrn(e.target.value.toUpperCase())}
                placeholder="PRN (e.g. DEG-CS-2650)"
                className="w-full px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg"
              />
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Student Full Name"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="student@dnyanshree.edu.in"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={newDept}
                  onChange={(e) => setNewDept(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  {(newProgram === 'Degree' ? DEGREE_DEPARTMENTS : DIPLOMA_DEPARTMENTS).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <select
                  value={newYear}
                  onChange={(e) => setNewYear(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  {(newProgram === 'Degree' ? DEGREE_YEARS : DIPLOMA_YEARS).map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="w-full py-2.5 bg-[#0F2942] text-white text-xs font-medium rounded-lg hover:bg-[#163A5C]"
              >
                Save Student & Generate QR Token
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Quick Enroll Faculty */}
      {showEnrollTeacherModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">Enroll New Faculty Profile</h3>
              <button
                type="button"
                onClick={() => setShowEnrollTeacherModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleEnrollTeacher} className="mt-4 space-y-3.5">
              {enrollTeacherError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 p-2.5 rounded-lg">
                  {enrollTeacherError}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setNewTchProgram('Degree');
                    setNewTchDept(DEGREE_DEPARTMENTS[0]);
                  }}
                  className={`py-1.5 text-xs font-medium rounded-md ${
                    newTchProgram === 'Degree' ? 'bg-[#0F2942] text-white' : 'text-slate-700'
                  }`}
                >
                  Degree Wing
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNewTchProgram('Diploma');
                    setNewTchDept(DIPLOMA_DEPARTMENTS[0]);
                  }}
                  className={`py-1.5 text-xs font-medium rounded-md ${
                    newTchProgram === 'Diploma' ? 'bg-[#0F2942] text-white' : 'text-slate-700'
                  }`}
                >
                  Diploma Wing
                </button>
              </div>
              <input
                type="text"
                required
                value={newEmpId}
                onChange={(e) => setNewEmpId(e.target.value.toUpperCase())}
                placeholder="Employee ID (e.g. TCH-CS-110)"
                className="w-full px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg"
              />
              <input
                type="text"
                required
                value={newTchName}
                onChange={(e) => setNewTchName(e.target.value)}
                placeholder="Faculty Full Name"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <input
                type="email"
                required
                value={newTchEmail}
                onChange={(e) => setNewTchEmail(e.target.value)}
                placeholder="faculty@dnyanshree.edu.in"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={newTchDept}
                  onChange={(e) => setNewTchDept(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  {(newTchProgram === 'Degree' ? DEGREE_DEPARTMENTS : DIPLOMA_DEPARTMENTS).map(
                    (d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    )
                  )}
                </select>
                <select
                  value={newTchDesig}
                  onChange={(e) => setNewTchDesig(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  {TEACHER_DESIGNATIONS.map((desig) => (
                    <option key={desig} value={desig}>
                      {desig}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="w-full py-2.5 bg-[#0F2942] text-white text-xs font-medium rounded-lg hover:bg-[#163A5C]"
              >
                Save Faculty & Generate QR Token
              </button>
            </form>
          </div>
        </div>
      )}

      {loading && (
        <div className="fixed bottom-4 right-4 bg-white border border-slate-200 px-3 py-2 rounded-lg text-xs text-slate-600 shadow-sm">
          Syncing metrics...
        </div>
      )}
    </div>
  );
};
