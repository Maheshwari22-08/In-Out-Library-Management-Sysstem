import ExcelJS from 'exceljs';
import nodemailer from 'nodemailer';
import crypto from 'node:crypto';
import { db, LibraryLogRow, StudentRow, TeacherRow, TeacherLogRow, ReportConfigRow } from './db.ts';

export async function generateLibraryExcelBuffer(filters: {
  program?: string;
  department?: string;
  search?: string;
  session?: string;
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Dnyanshree Institute of Engineering & Technology, Satara';
  workbook.created = new Date();

  const programFilter = filters.program && filters.program !== 'ALL' ? filters.program : null;
  const deptFilter = filters.department && filters.department !== 'ALL' ? filters.department : null;
  const sessionFilter = filters.session && filters.session !== 'ALL' ? filters.session : null;

  let studentSql = 'SELECT * FROM students WHERE 1=1';
  const studentParams: string[] = [];
  if (programFilter) {
    studentSql += ' AND program = ?';
    studentParams.push(programFilter);
  }
  if (deptFilter) {
    studentSql += ' AND department = ?';
    studentParams.push(deptFilter);
  }
  studentSql += ' ORDER BY visit_count DESC';
  const students = db.prepare(studentSql).all(...studentParams) as StudentRow[];

  let logSql = 'SELECT * FROM library_logs WHERE 1=1';
  const params: string[] = [];
  if (programFilter) {
    logSql += ' AND program = ?';
    params.push(programFilter);
  }
  if (deptFilter) {
    logSql += ' AND department = ?';
    params.push(deptFilter);
  }
  if (sessionFilter) {
    logSql += ' AND academic_session = ?';
    params.push(sessionFilter);
  }
  logSql += ' ORDER BY entry_time DESC LIMIT 5000';
  const logs = db.prepare(logSql).all(...params) as LibraryLogRow[];

  // Sheet 1: Executive Summary
  const summarySheet = workbook.addWorksheet('Executive Summary');
  summarySheet.columns = [
    { header: 'Institutional Metric', key: 'metric', width: 42 },
    { header: 'Value', key: 'value', width: 32 },
  ];
  summarySheet.getRow(1).font = { bold: true };

  const degreeStudents = students.filter((s) => s.program === 'Degree');
  const diplomaStudents = students.filter((s) => s.program === 'Diploma');
  const insideNow = students.filter((s) => s.currently_inside === 1).length;
  const totalVisits = students.reduce((acc, s) => acc + s.visit_count, 0);
  const totalMinutes = students.reduce((acc, s) => acc + s.total_minutes, 0);

  summarySheet.addRows([
    { metric: 'Institution', value: 'Dnyanshree Institute of Engineering & Technology, Satara' },
    { metric: 'Report Generated At', value: new Date().toLocaleString('en-IN') },
    { metric: 'Filter Scope (Program)', value: programFilter || 'All (Degree + Diploma)' },
    { metric: 'Filter Scope (Department)', value: deptFilter || 'All Departments' },
    { metric: 'Registered Students Tracked', value: students.length },
    { metric: 'Degree Cohort Students', value: degreeStudents.length },
    { metric: 'Diploma Cohort Students', value: diplomaStudents.length },
    { metric: 'Currently Inside Reading Hall', value: insideNow },
    { metric: 'Cumulative Library Visits Recorded', value: totalVisits },
    { metric: 'Cumulative Study Hours', value: Math.round((totalMinutes / 60) * 10) / 10 },
    { metric: 'Exported Entry/Exit Rows', value: logs.length },
  ]);

  // Sheet 2: Student Visit Frequency Tracker
  const freqSheet = workbook.addWorksheet('Student Visit Frequency');
  freqSheet.columns = [
    { header: 'PRN / Roll No', key: 'prn', width: 18 },
    { header: 'Student Name', key: 'full_name', width: 26 },
    { header: 'Program', key: 'program', width: 12 },
    { header: 'Department', key: 'department', width: 28 },
    { header: 'Year', key: 'academic_year', width: 10 },
    { header: 'Total Visits', key: 'visit_count', width: 14 },
    { header: 'Total Hours', key: 'total_hours', width: 14 },
    { header: 'Current Status', key: 'status', width: 16 },
    { header: 'Last Entry Time', key: 'last_entry_at', width: 26 },
  ];
  freqSheet.getRow(1).font = { bold: true };
  freqSheet.addRows(
    students.map((s) => ({
      prn: s.prn,
      full_name: s.full_name,
      program: s.program,
      department: s.department,
      academic_year: s.academic_year,
      visit_count: s.visit_count,
      total_hours: Math.round((s.total_minutes / 60) * 10) / 10,
      status: s.currently_inside ? 'Inside Library' : 'Checked Out',
      last_entry_at: s.last_entry_at || 'N/A',
    }))
  );

  // Sheet 3: Chronological Entry/Exit Logs
  const logsSheet = workbook.addWorksheet('Entry Exit Logs');
  logsSheet.columns = [
    { header: 'Log ID', key: 'id', width: 22 },
    { header: 'PRN', key: 'prn', width: 16 },
    { header: 'Student Name', key: 'student_name', width: 24 },
    { header: 'Program', key: 'program', width: 12 },
    { header: 'Department', key: 'department', width: 26 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Entry Time', key: 'entry_time', width: 25 },
    { header: 'Exit Time', key: 'exit_time', width: 25 },
    { header: 'Duration (Min)', key: 'duration_minutes', width: 16 },
    { header: 'Scan Method', key: 'scan_method', width: 16 },
    { header: 'Academic Session', key: 'academic_session', width: 16 },
  ];
  logsSheet.getRow(1).font = { bold: true };
  logsSheet.addRows(
    logs.map((l) => ({
      ...l,
      exit_time: l.exit_time || 'Active Session',
    }))
  );

  // Sheet 4: Teacher / Faculty Visit Frequency
  let tSql = 'SELECT * FROM teachers WHERE 1=1';
  const tParams: string[] = [];
  if (programFilter) {
    tSql += ' AND program = ?';
    tParams.push(programFilter);
  }
  if (deptFilter) {
    tSql += ' AND department = ?';
    tParams.push(deptFilter);
  }
  tSql += ' ORDER BY visit_count DESC';
  const teachers = db.prepare(tSql).all(...tParams) as TeacherRow[];

  const teacherFreqSheet = workbook.addWorksheet('Teacher Visit Frequency');
  teacherFreqSheet.columns = [
    { header: 'Employee ID', key: 'employee_id', width: 18 },
    { header: 'Faculty Name', key: 'full_name', width: 26 },
    { header: 'Designation', key: 'designation', width: 20 },
    { header: 'Program Wing', key: 'program', width: 14 },
    { header: 'Department', key: 'department', width: 28 },
    { header: 'Total Visits', key: 'visit_count', width: 14 },
    { header: 'Total Hours', key: 'total_hours', width: 14 },
    { header: 'Current Status', key: 'status', width: 16 },
    { header: 'Last Entry Time', key: 'last_entry_at', width: 26 },
  ];
  teacherFreqSheet.getRow(1).font = { bold: true };
  teacherFreqSheet.addRows(
    teachers.map((t) => ({
      employee_id: t.employee_id,
      full_name: t.full_name,
      designation: t.designation,
      program: t.program,
      department: t.department,
      visit_count: t.visit_count,
      total_hours: Math.round((t.total_minutes / 60) * 10) / 10,
      status: t.currently_inside ? 'Inside Library' : 'Checked Out',
      last_entry_at: t.last_entry_at || 'N/A',
    }))
  );

  let tLogSql = 'SELECT * FROM teacher_logs WHERE 1=1';
  const tLogParams: string[] = [];
  if (programFilter) {
    tLogSql += ' AND program = ?';
    tLogParams.push(programFilter);
  }
  if (deptFilter) {
    tLogSql += ' AND department = ?';
    tLogParams.push(deptFilter);
  }
  if (sessionFilter) {
    tLogSql += ' AND academic_session = ?';
    tLogParams.push(sessionFilter);
  }
  tLogSql += ' ORDER BY entry_time DESC LIMIT 5000';
  const teacherLogs = db.prepare(tLogSql).all(...tLogParams) as TeacherLogRow[];

  const teacherLogsSheet = workbook.addWorksheet('Teacher Entry Exit Logs');
  teacherLogsSheet.columns = [
    { header: 'Log ID', key: 'id', width: 22 },
    { header: 'Employee ID', key: 'employee_id', width: 16 },
    { header: 'Faculty Name', key: 'teacher_name', width: 24 },
    { header: 'Designation', key: 'designation', width: 20 },
    { header: 'Program', key: 'program', width: 12 },
    { header: 'Department', key: 'department', width: 26 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Entry Time', key: 'entry_time', width: 25 },
    { header: 'Exit Time', key: 'exit_time', width: 25 },
    { header: 'Duration (Min)', key: 'duration_minutes', width: 16 },
    { header: 'Scan Method', key: 'scan_method', width: 16 },
    { header: 'Academic Session', key: 'academic_session', width: 16 },
  ];
  teacherLogsSheet.getRow(1).font = { bold: true };
  teacherLogsSheet.addRows(
    teacherLogs.map((l) => ({
      ...l,
      exit_time: l.exit_time || 'Active Session',
    }))
  );

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

export async function sendMobilePushNotification(title: string, message: string, topicOverride?: string): Promise<{ sent: boolean; channel: string }> {
  const cfg = db.prepare('SELECT ntfy_topic FROM report_config WHERE id = 1').get() as { ntfy_topic: string } | undefined;
  const topic = (topicOverride ?? cfg?.ntfy_topic ?? process.env.NTFY_TOPIC ?? '').trim();
  if (!topic) {
    return { sent: false, channel: 'in-app-browser' };
  }
  try {
    const safeTopic = topic.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeTopic) return { sent: false, channel: 'in-app-browser' };
    await fetch(`https://ntfy.sh/${safeTopic}`, {
      method: 'POST',
      headers: {
        Title: title,
        Priority: 'default',
        Tags: 'books,mortar_board',
      },
      body: message,
    });
    return { sent: true, channel: `ntfy.sh/${safeTopic}` };
  } catch {
    return { sent: false, channel: 'ntfy-error' };
  }
}

export async function dispatchWeeklyReport(triggerSource: 'scheduled' | 'manual'): Promise<{
  recipientEmail: string;
  subject: string;
  deliveryMode: 'smtp' | 'archived_digest';
  summaryText: string;
}> {
  const cfg = db.prepare('SELECT * FROM report_config WHERE id = 1').get() as ReportConfigRow;
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_students,
      SUM(CASE WHEN program = 'Degree' THEN 1 ELSE 0 END) as degree_count,
      SUM(CASE WHEN program = 'Diploma' THEN 1 ELSE 0 END) as diploma_count,
      SUM(visit_count) as total_visits,
      SUM(total_minutes) as total_minutes
    FROM students
  `).get() as {
    total_students: number;
    degree_count: number;
    diploma_count: number;
    total_visits: number;
    total_minutes: number;
  };

  const recentWeekLogs = db.prepare(`
    SELECT COUNT(*) as count,
      SUM(CASE WHEN program = 'Degree' THEN 1 ELSE 0 END) as degree_logs,
      SUM(CASE WHEN program = 'Diploma' THEN 1 ELSE 0 END) as diploma_logs
    FROM library_logs
    WHERE entry_time >= datetime('now', '-7 days')
  `).get() as { count: number; degree_logs: number; diploma_logs: number };

  const topVisitors = db.prepare(`
    SELECT prn, full_name, program, department, visit_count, total_minutes
    FROM students ORDER BY visit_count DESC LIMIT 5
  `).all() as Array<{ prn: string; full_name: string; program: string; department: string; visit_count: number; total_minutes: number }>;

  const nowIso = new Date().toISOString();
  const subject = `[DIET Satara Library] Weekly Attendance & Occupancy Digest (${nowIso.slice(0, 10)})`;
  const summaryLines = [
    `Dnyanshree Institute of Engineering and Technology, Satara — Central Library Weekly Report`,
    `Trigger: ${triggerSource.toUpperCase()} | Generated: ${new Date().toLocaleString('en-IN')}`,
    `------------------------------------------------------------`,
    `Last 7 Days Entries: ${recentWeekLogs.count || 0} (Degree: ${recentWeekLogs.degree_logs || 0} | Diploma: ${recentWeekLogs.diploma_logs || 0})`,
    `Total Enrolled Profiles: ${stats.total_students || 0} (Degree: ${stats.degree_count || 0} | Diploma: ${stats.diploma_count || 0})`,
    `Cumulative Study Hours Logged: ${Math.round(((stats.total_minutes || 0) / 60) * 10) / 10} hrs`,
    ``,
    `Top Frequent Visitors:`,
    ...topVisitors.map(
      (v, i) => `${i + 1}. ${v.full_name} (${v.prn} · ${v.program}) — ${v.visit_count} visits (${Math.round((v.total_minutes / 60) * 10) / 10} hrs)`
    ),
  ];
  const summaryText = summaryLines.join('\n');

  let deliveryMode: 'smtp' | 'archived_digest' = 'archived_digest';
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const excelBuffer = await generateLibraryExcelBuffer({});
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: cfg.recipient_email,
        subject,
        text: summaryText,
        attachments: [
          {
            filename: `DIET_Library_Weekly_Report_${nowIso.slice(0, 10)}.xlsx`,
            content: excelBuffer,
          },
        ],
      });
      deliveryMode = 'smtp';
    } catch (err) {
      console.error('SMTP dispatch failed, archived digest locally:', err);
    }
  }

  db.prepare(`UPDATE report_config SET last_sent_at = ? WHERE id = 1`).run(nowIso);
  db.prepare(`
    INSERT INTO email_outbox (id, recipient_email, subject, summary_text, delivery_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(`mail_${crypto.randomUUID().slice(0, 10)}`, cfg.recipient_email, subject, summaryText, deliveryMode, nowIso);

  db.prepare(`
    INSERT INTO notification_events (id, type, title, message, program, created_at, is_read)
    VALUES (?, 'WEEKLY_REPORT', ?, ?, NULL, ?, 0)
  `).run(
    `notif_${crypto.randomUUID().slice(0, 10)}`,
    'Weekly Library Report Dispatched',
    `Weekly Excel & attendance summary prepared for ${cfg.recipient_email} (${deliveryMode}).`,
    nowIso
  );

  await sendMobilePushNotification(
    'DIET Library Weekly Report Ready',
    `7-day entries: ${recentWeekLogs.count || 0}. Prepared for ${cfg.recipient_email}.`
  );

  return {
    recipientEmail: cfg.recipient_email,
    subject,
    deliveryMode,
    summaryText,
  };
}
