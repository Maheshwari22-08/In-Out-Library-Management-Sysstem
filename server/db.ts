import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { generateBase32Secret, hashPassword, signQrPayload, signTeacherQrPayload } from './totp.ts';

export type ProgramType = 'Degree' | 'Diploma';
export type ScanMethod = 'QR_KIOSK' | 'STUDENT_SCAN' | 'TEACHER_SCAN' | 'MANUAL_ADMIN';

export interface StudentRow {
  id: string;
  prn: string;
  full_name: string;
  email: string;
  password_hash: string;
  program: ProgramType;
  department: string;
  academic_year: string;
  phone: string | null;
  qr_token: string;
  mfa_secret: string;
  mfa_enabled: number;
  visit_count: number;
  total_minutes: number;
  currently_inside: number;
  last_entry_at: string | null;
  created_at: string;
}

export interface AdminRow {
  id: string;
  email: string;
  full_name: string;
  password_hash: string;
  role: string;
  mfa_secret: string;
  mfa_enabled: number;
  created_at: string;
}

export interface LibraryLogRow {
  id: string;
  student_id: string;
  prn: string;
  student_name: string;
  program: ProgramType;
  department: string;
  status: 'INSIDE' | 'COMPLETED';
  entry_time: string;
  exit_time: string | null;
  duration_minutes: number;
  scan_method: ScanMethod;
  academic_session: string;
  entry_date: string;
}

export interface TeacherRow {
  id: string;
  employee_id: string;
  full_name: string;
  email: string;
  password_hash: string;
  program: ProgramType;
  department: string;
  designation: string;
  phone: string | null;
  qr_token: string;
  mfa_secret: string;
  mfa_enabled: number;
  visit_count: number;
  total_minutes: number;
  currently_inside: number;
  last_entry_at: string | null;
  created_at: string;
}

export interface TeacherLogRow {
  id: string;
  teacher_id: string;
  employee_id: string;
  teacher_name: string;
  program: ProgramType;
  department: string;
  designation: string;
  status: 'INSIDE' | 'COMPLETED';
  entry_time: string;
  exit_time: string | null;
  duration_minutes: number;
  scan_method: ScanMethod;
  academic_session: string;
  entry_date: string;
}

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  message: string;
  program: string | null;
  created_at: string;
  is_read: number;
}

export interface ReportConfigRow {
  id: number;
  recipient_email: string;
  schedule_day: string;
  schedule_time: string;
  ntfy_topic: string;
  enabled: number;
  last_sent_at: string | null;
}

export interface CloudBackupRow {
  id: string;
  created_by: string;
  student_count: number;
  log_count: number;
  academic_range: string;
  checksum: string;
  file_size_kb: number;
  created_at: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'dnyanshree_library.db');
export const db = new Database(DB_PATH);

// Performance & 10-12 Year Scalability Pragmas (WAL + 64MB Cache)
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000');
db.pragma('temp_store = MEMORY');
db.pragma('foreign_keys = ON');

// Schema Definition
db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    prn TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    program TEXT CHECK(program IN ('Degree', 'Diploma')) NOT NULL,
    department TEXT NOT NULL,
    academic_year TEXT NOT NULL,
    phone TEXT,
    qr_token TEXT NOT NULL,
    mfa_secret TEXT NOT NULL,
    mfa_enabled INTEGER NOT NULL DEFAULT 1,
    visit_count INTEGER NOT NULL DEFAULT 0,
    total_minutes INTEGER NOT NULL DEFAULT 0,
    currently_inside INTEGER NOT NULL DEFAULT 0,
    last_entry_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'head_librarian',
    mfa_secret TEXT NOT NULL,
    mfa_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS library_logs (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    prn TEXT NOT NULL,
    student_name TEXT NOT NULL,
    program TEXT CHECK(program IN ('Degree', 'Diploma')) NOT NULL,
    department TEXT NOT NULL,
    status TEXT CHECK(status IN ('INSIDE', 'COMPLETED')) NOT NULL,
    entry_time TEXT NOT NULL,
    exit_time TEXT,
    duration_minutes INTEGER NOT NULL DEFAULT 0,
    scan_method TEXT NOT NULL,
    academic_session TEXT NOT NULL,
    entry_date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notification_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    program TEXT,
    created_at TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS report_config (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    recipient_email TEXT NOT NULL,
    schedule_day TEXT NOT NULL,
    schedule_time TEXT NOT NULL,
    ntfy_topic TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    last_sent_at TEXT
  );

  CREATE TABLE IF NOT EXISTS cloud_backups (
    id TEXT PRIMARY KEY,
    created_by TEXT NOT NULL,
    student_count INTEGER NOT NULL,
    log_count INTEGER NOT NULL,
    academic_range TEXT NOT NULL,
    checksum TEXT NOT NULL,
    file_size_kb REAL NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS email_outbox (
    id TEXT PRIMARY KEY,
    recipient_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    summary_text TEXT NOT NULL,
    delivery_status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS teachers (
    id TEXT PRIMARY KEY,
    employee_id TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    program TEXT CHECK(program IN ('Degree', 'Diploma')) NOT NULL,
    department TEXT NOT NULL,
    designation TEXT NOT NULL,
    phone TEXT,
    qr_token TEXT NOT NULL,
    mfa_secret TEXT NOT NULL,
    mfa_enabled INTEGER NOT NULL DEFAULT 1,
    visit_count INTEGER NOT NULL DEFAULT 0,
    total_minutes INTEGER NOT NULL DEFAULT 0,
    currently_inside INTEGER NOT NULL DEFAULT 0,
    last_entry_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS teacher_logs (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    employee_id TEXT NOT NULL,
    teacher_name TEXT NOT NULL,
    program TEXT CHECK(program IN ('Degree', 'Diploma')) NOT NULL,
    department TEXT NOT NULL,
    designation TEXT NOT NULL,
    status TEXT CHECK(status IN ('INSIDE', 'COMPLETED')) NOT NULL,
    entry_time TEXT NOT NULL,
    exit_time TEXT,
    duration_minutes INTEGER NOT NULL DEFAULT 0,
    scan_method TEXT NOT NULL,
    academic_session TEXT NOT NULL,
    entry_date TEXT NOT NULL
  );

  -- Composite B-Tree Indexes for fast query processing across 3,000-4,000+ students & 10-12 year logs
  CREATE INDEX IF NOT EXISTS idx_students_program_dept ON students(program, department);
  CREATE INDEX IF NOT EXISTS idx_students_visits ON students(visit_count DESC);
  CREATE INDEX IF NOT EXISTS idx_students_inside ON students(currently_inside);
  CREATE INDEX IF NOT EXISTS idx_teachers_program_dept ON teachers(program, department);
  CREATE INDEX IF NOT EXISTS idx_teachers_visits ON teachers(visit_count DESC);
  CREATE INDEX IF NOT EXISTS idx_teacher_logs_time ON teacher_logs(teacher_id, entry_time DESC);
  CREATE INDEX IF NOT EXISTS idx_teacher_logs_date ON teacher_logs(entry_date DESC, program);
  CREATE INDEX IF NOT EXISTS idx_logs_student_time ON library_logs(student_id, entry_time DESC);
  CREATE INDEX IF NOT EXISTS idx_logs_date_program ON library_logs(entry_date DESC, program);
  CREATE INDEX IF NOT EXISTS idx_logs_status ON library_logs(status);
  CREATE INDEX IF NOT EXISTS idx_logs_session ON library_logs(academic_session, entry_date DESC);
  CREATE INDEX IF NOT EXISTS idx_notifications_created ON notification_events(created_at DESC);

  -- Migrate legacy year codes (FE/SE/TE/BE, FY/SY/TY) to 1st Year - 4th Year
  UPDATE students SET academic_year = '1st Year' WHERE academic_year IN ('FE', 'FY');
  UPDATE students SET academic_year = '2nd Year' WHERE academic_year IN ('SE', 'SY');
  UPDATE students SET academic_year = '3rd Year' WHERE academic_year IN ('TE', 'TY');
  UPDATE students SET academic_year = '4th Year' WHERE academic_year = 'BE';

  -- Align legacy department names with official dnyanshree.edu.in branches
  UPDATE students SET department = 'Computer Science & Engineering' WHERE department IN ('Computer Science & Engg', 'Computer Engineering');
  UPDATE students SET department = 'AI & DS Engineering' WHERE department = 'AI & Data Science';
  UPDATE students SET department = 'Electronics & Telecommunication Engineering' WHERE department IN ('E&TC Engineering', 'Electronics & Telecomm');
  UPDATE students SET department = 'Civil & Environmental Engineering' WHERE department = 'Civil Engineering' AND program = 'Degree';
  UPDATE students SET department = 'Mechanical & Mechatronics Engineering' WHERE department = 'Mechanical Engineering' AND program = 'Degree';
  UPDATE students SET department = 'Electrical & Computer Engineering' WHERE department = 'Electrical Engineering' AND program = 'Degree';
  UPDATE students SET department = 'Electronics & Telecommunication Engineering' WHERE department = 'Electrical Engineering' AND program = 'Diploma';
  UPDATE students SET department = 'Mechanical Engineering' WHERE department = 'Civil Engineering' AND program = 'Diploma';

  UPDATE teachers SET department = 'Computer Science & Engineering' WHERE department IN ('Computer Science & Engg', 'Computer Engineering');
  UPDATE teachers SET department = 'Mechanical & Mechatronics Engineering' WHERE department = 'Mechanical Engineering' AND program = 'Degree';
  UPDATE teachers SET department = 'Mechanical Engineering' WHERE department = 'Civil Engineering' AND program = 'Diploma';
  UPDATE teachers SET department = 'Electronics & Telecommunication Engineering' WHERE department IN ('E&TC Engineering', 'Electronics & Telecomm') OR (department = 'Electrical Engineering' AND program = 'Diploma');

  UPDATE library_logs SET department = 'Computer Science & Engineering' WHERE department IN ('Computer Science & Engg', 'Computer Engineering');
  UPDATE library_logs SET department = 'AI & DS Engineering' WHERE department = 'AI & Data Science';
  UPDATE library_logs SET department = 'Electronics & Telecommunication Engineering' WHERE department IN ('E&TC Engineering', 'Electronics & Telecomm') OR (department = 'Electrical Engineering' AND program = 'Diploma');
  UPDATE library_logs SET department = 'Civil & Environmental Engineering' WHERE department = 'Civil Engineering' AND program = 'Degree';
  UPDATE library_logs SET department = 'Mechanical & Mechatronics Engineering' WHERE department = 'Mechanical Engineering' AND program = 'Degree';
  UPDATE library_logs SET department = 'Electrical & Computer Engineering' WHERE department = 'Electrical Engineering' AND program = 'Degree';
  UPDATE library_logs SET department = 'Mechanical Engineering' WHERE department = 'Civil Engineering' AND program = 'Diploma';

  UPDATE teacher_logs SET department = 'Computer Science & Engineering' WHERE department IN ('Computer Science & Engg', 'Computer Engineering');
  UPDATE teacher_logs SET department = 'Mechanical & Mechatronics Engineering' WHERE department = 'Mechanical Engineering' AND program = 'Degree';
  UPDATE teacher_logs SET department = 'Mechanical Engineering' WHERE department = 'Civil Engineering' AND program = 'Diploma';
  UPDATE teacher_logs SET department = 'Electronics & Telecommunication Engineering' WHERE department IN ('E&TC Engineering', 'Electronics & Telecomm') OR (department = 'Electrical Engineering' AND program = 'Diploma');
`);

export function getAcademicSession(date = new Date()): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  if (month >= 6) {
    return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
  }
  return `${year - 1}-${String(year % 100).padStart(2, '0')}`;
}

function seedInstitutionalDataIfEmpty() {
  const configCount = db.prepare('SELECT COUNT(*) as c FROM report_config').get() as { c: number };
  if (configCount.c === 0) {
    db.prepare(`
      INSERT INTO report_config (id, recipient_email, schedule_day, schedule_time, ntfy_topic, enabled, last_sent_at)
      VALUES (1, 'librarian@dnyanshree.edu.in', 'Monday', '08:30', '', 1, NULL)
    `).run();
  }

  const studentCount = db.prepare('SELECT COUNT(*) as c FROM students').get() as { c: number };
  if (studentCount.c > 0) return;

  const seedStudents = [
    { prn: 'DEG-CS-2401', name: 'Aarav Deshmukh', email: 'aarav.deshmukh@dnyanshree.edu.in', program: 'Degree' as ProgramType, dept: 'Computer Science & Engineering', year: '3rd Year', phone: '+91 98230 11201', visits: 18, mins: 1420, inside: true },
    { prn: 'DEG-ME-2408', name: 'Sneha Kulkarni', email: 'sneha.kulkarni@dnyanshree.edu.in', program: 'Degree' as ProgramType, dept: 'Mechanical & Mechatronics Engineering', year: '4th Year', phone: '+91 98230 11202', visits: 24, mins: 2180, inside: true },
    { prn: 'DIP-CO-2503', name: 'Omkar Jadhav', email: 'omkar.jadhav@dnyanshree.edu.in', program: 'Diploma' as ProgramType, dept: 'Computer Science & Engineering', year: '3rd Year', phone: '+91 98230 11203', visits: 15, mins: 1105, inside: true },
    { prn: 'DIP-EE-2512', name: 'Priya Pawar', email: 'priya.pawar@dnyanshree.edu.in', program: 'Diploma' as ProgramType, dept: 'Electronics & Telecommunication Engineering', year: '2nd Year', phone: '+91 98230 11204', visits: 11, mins: 890, inside: false },
    { prn: 'DEG-AI-2419', name: 'Rohan Shinde', email: 'rohan.shinde@dnyanshree.edu.in', program: 'Degree' as ProgramType, dept: 'AI & DS Engineering', year: '2nd Year', phone: '+91 98230 11205', visits: 29, mins: 2640, inside: true },
    { prn: 'DEG-CE-2304', name: 'Tanvi Bhosale', email: 'tanvi.bhosale@dnyanshree.edu.in', program: 'Degree' as ProgramType, dept: 'Civil & Environmental Engineering', year: '4th Year', phone: '+91 98230 11206', visits: 14, mins: 1090, inside: false },
    { prn: 'DIP-ME-2518', name: 'Aditya Chavan', email: 'aditya.chavan@dnyanshree.edu.in', program: 'Diploma' as ProgramType, dept: 'Mechanical Engineering', year: '3rd Year', phone: '+91 98230 11207', visits: 9, mins: 675, inside: false },
    { prn: 'DEG-EC-2411', name: 'Neha Salunkhe', email: 'neha.salunkhe@dnyanshree.edu.in', program: 'Degree' as ProgramType, dept: 'Electronics & Telecommunication Engineering', year: '3rd Year', phone: '+91 98230 11208', visits: 21, mins: 1760, inside: true },
    { prn: 'DIP-ME-2507', name: 'Siddharth More', email: 'siddharth.more@dnyanshree.edu.in', program: 'Diploma' as ProgramType, dept: 'Mechanical Engineering', year: '1st Year', phone: '+91 98230 11209', visits: 7, mins: 480, inside: false },
    { prn: 'DEG-CS-2515', name: 'Vaishnavi Patil', email: 'vaishnavi.patil@dnyanshree.edu.in', program: 'Degree' as ProgramType, dept: 'Computer Science & Engineering', year: '2nd Year', phone: '+91 98230 11210', visits: 31, mins: 2890, inside: false },
    { prn: 'DIP-CO-2522', name: 'Karan Nikam', email: 'karan.nikam@dnyanshree.edu.in', program: 'Diploma' as ProgramType, dept: 'Computer Science & Engineering', year: '2nd Year', phone: '+91 98230 11211', visits: 16, mins: 1240, inside: true },
    { prn: 'DEG-EL-2502', name: 'Meera Sawant', email: 'meera.sawant@dnyanshree.edu.in', program: 'Degree' as ProgramType, dept: 'Electrical & Computer Engineering', year: '1st Year', phone: '+91 98230 11212', visits: 6, mins: 410, inside: false },
  ];

  // Note: Seeded sample profiles use non-login placeholder hashes until students register or reset via Portal
  const placeholderHash = hashPassword(crypto.randomBytes(24).toString('hex'));
  const now = new Date();
  const session = getAcademicSession(now);

  const insertStudent = db.prepare(`
    INSERT INTO students (
      id, prn, full_name, email, password_hash, program, department, academic_year,
      phone, qr_token, mfa_secret, mfa_enabled, visit_count, total_minutes,
      currently_inside, last_entry_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
  `);

  const insertLog = db.prepare(`
    INSERT INTO library_logs (
      id, student_id, prn, student_name, program, department, status,
      entry_time, exit_time, duration_minutes, scan_method, academic_session, entry_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    seedStudents.forEach((s, idx) => {
      const id = `stu_${s.prn.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      const createdAt = new Date(now.getTime() - (30 + idx) * 86400_000).toISOString();
      const entryToday = new Date(now.getTime() - (idx * 25 + 15) * 60_000);
      const lastEntryIso = s.inside ? entryToday.toISOString() : new Date(now.getTime() - 86400_000 + idx * 3600_000).toISOString();

      insertStudent.run(
        id,
        s.prn,
        s.name,
        s.email,
        placeholderHash,
        s.program,
        s.dept,
        s.year,
        s.phone,
        signQrPayload(s.prn),
        generateBase32Secret(),
        s.visits,
        s.mins,
        s.inside ? 1 : 0,
        lastEntryIso,
        createdAt
      );

      // Seed historical completed visits over the last 6 days
      for (let d = 1; d <= 5; d++) {
        if ((idx + d) % 2 === 0) {
          const histIn = new Date(now.getTime() - d * 86400_000);
          histIn.setHours(9 + (idx % 6), 15, 0, 0);
          const dur = 65 + ((idx * 17 + d * 13) % 95);
          const histOut = new Date(histIn.getTime() + dur * 60_000);
          insertLog.run(
            `log_${id}_d${d}`,
            id,
            s.prn,
            s.name,
            s.program,
            s.dept,
            'COMPLETED',
            histIn.toISOString(),
            histOut.toISOString(),
            dur,
            idx % 3 === 0 ? 'STUDENT_SCAN' : 'QR_KIOSK',
            session,
            histIn.toISOString().slice(0, 10)
          );
        }
      }

      // Today's active or completed visit
      if (s.inside) {
        insertLog.run(
          `log_${id}_today`,
          id,
          s.prn,
          s.name,
          s.program,
          s.dept,
          'INSIDE',
          entryToday.toISOString(),
          null,
          0,
          idx % 2 === 0 ? 'QR_KIOSK' : 'STUDENT_SCAN',
          session,
          entryToday.toISOString().slice(0, 10)
        );
      } else {
        const earlyIn = new Date(now);
        earlyIn.setHours(8, 45 + idx, 0, 0);
        const earlyOut = new Date(earlyIn.getTime() + 85 * 60_000);
        if (earlyOut < now) {
          insertLog.run(
            `log_${id}_today_done`,
            id,
            s.prn,
            s.name,
            s.program,
            s.dept,
            'COMPLETED',
            earlyIn.toISOString(),
            earlyOut.toISOString(),
            85,
            'QR_KIOSK',
            session,
            earlyIn.toISOString().slice(0, 10)
          );
        }
      }
    });

    db.prepare(`
      INSERT INTO cloud_backups (id, created_by, student_count, log_count, academic_range, checksum, file_size_kb, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'bkp_initial_2026',
      'system_scheduler',
      seedStudents.length,
      42,
      session,
      crypto.createHash('sha256').update('dnyanshree-initial-snapshot').digest('hex').slice(0, 16),
      48.6,
      new Date(now.getTime() - 3600_000 * 12).toISOString()
    );

    db.prepare(`
      INSERT INTO notification_events (id, type, title, message, program, created_at, is_read)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(
      'notif_boot_1',
      'SYSTEM',
      'Central Library Gate Ready',
      'QR Kiosk & Indexed Archive initialized for Degree and Diploma cohorts at DIET Satara.',
      null,
      now.toISOString()
    );
  });

  tx();
}

seedInstitutionalDataIfEmpty();

function seedTeachersIfEmpty() {
  const teacherCount = db.prepare('SELECT COUNT(*) as c FROM teachers').get() as { c: number };
  if (teacherCount.c > 0) return;

  const placeholderHash = hashPassword(crypto.randomBytes(24).toString('hex'));
  const now = new Date();
  const session = getAcademicSession(now);

  const seedTeachers = [
    { empId: 'TCH-CS-101', name: 'Prof. Mahesh Patil', email: 'mahesh.patil@dnyanshree.edu.in', program: 'Degree' as ProgramType, dept: 'Computer Science & Engineering', designation: 'Assistant Professor', visits: 22, mins: 1640, inside: true },
    { empId: 'TCH-ME-104', name: 'Dr. Ashwini Jadhav', email: 'ashwini.jadhav@dnyanshree.edu.in', program: 'Degree' as ProgramType, dept: 'Mechanical & Mechatronics Engineering', designation: 'Associate Professor', visits: 17, mins: 1320, inside: false },
    { empId: 'TCH-DIP-201', name: 'Prof. Sagar Kadam', email: 'sagar.kadam@dnyanshree.edu.in', program: 'Diploma' as ProgramType, dept: 'Computer Science & Engineering', designation: 'Senior Lecturer', visits: 14, mins: 980, inside: true },
    { empId: 'TCH-DIP-205', name: 'Prof. Pallavi More', email: 'pallavi.more@dnyanshree.edu.in', program: 'Diploma' as ProgramType, dept: 'Mechanical Engineering', designation: 'Lecturer', visits: 11, mins: 760, inside: false },
  ];

  const insertTeacher = db.prepare(`
    INSERT INTO teachers (
      id, employee_id, full_name, email, password_hash, program, department, designation,
      phone, qr_token, mfa_secret, mfa_enabled, visit_count, total_minutes,
      currently_inside, last_entry_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?, ?, ?, ?, ?)
  `);

  const insertTeacherLog = db.prepare(`
    INSERT INTO teacher_logs (
      id, teacher_id, employee_id, teacher_name, program, department, designation, status,
      entry_time, exit_time, duration_minutes, scan_method, academic_session, entry_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    seedTeachers.forEach((t, idx) => {
      const id = `tch_${t.empId.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      const entryToday = new Date(now.getTime() - (idx * 20 + 18) * 60_000);
      const lastEntryIso = t.inside ? entryToday.toISOString() : new Date(now.getTime() - 86400_000).toISOString();

      insertTeacher.run(
        id,
        t.empId,
        t.name,
        t.email,
        placeholderHash,
        t.program,
        t.dept,
        t.designation,
        signTeacherQrPayload(t.empId),
        generateBase32Secret(),
        t.visits,
        t.mins,
        t.inside ? 1 : 0,
        lastEntryIso,
        new Date(now.getTime() - 45 * 86400_000).toISOString()
      );

      for (let d = 1; d <= 3; d++) {
        const histIn = new Date(now.getTime() - d * 86400_000);
        histIn.setHours(10 + idx, 30, 0, 0);
        const dur = 55 + d * 15;
        const histOut = new Date(histIn.getTime() + dur * 60_000);
        insertTeacherLog.run(
          `tlog_${id}_d${d}`,
          id,
          t.empId,
          t.name,
          t.program,
          t.dept,
          t.designation,
          'COMPLETED',
          histIn.toISOString(),
          histOut.toISOString(),
          dur,
          'TEACHER_SCAN',
          session,
          histIn.toISOString().slice(0, 10)
        );
      }

      if (t.inside) {
        insertTeacherLog.run(
          `tlog_${id}_today`,
          id,
          t.empId,
          t.name,
          t.program,
          t.dept,
          t.designation,
          'INSIDE',
          entryToday.toISOString(),
          null,
          0,
          'QR_KIOSK',
          session,
          entryToday.toISOString().slice(0, 10)
        );
      }
    });
  });

  tx();
}

seedTeachersIfEmpty();

export function recordEntryOrExit(
  student: StudentRow,
  scanMethod: ScanMethod
): { action: 'IN' | 'OUT'; log: LibraryLogRow; student: StudentRow } {
  const now = new Date();
  const nowIso = now.toISOString();
  const todayDate = nowIso.slice(0, 10);
  const session = getAcademicSession(now);

  const tx = db.transaction(() => {
    const activeLog = db
      .prepare(`SELECT * FROM library_logs WHERE student_id = ? AND status = 'INSIDE' ORDER BY entry_time DESC LIMIT 1`)
      .get(student.id) as LibraryLogRow | undefined;

    if (activeLog) {
      // CHECK OUT
      const entryMs = new Date(activeLog.entry_time).getTime();
      const durationMinutes = Math.max(1, Math.min(1440, Math.round((now.getTime() - entryMs) / 60_000)));
      db.prepare(`
        UPDATE library_logs
        SET status = 'COMPLETED', exit_time = ?, duration_minutes = ?
        WHERE id = ?
      `).run(nowIso, durationMinutes, activeLog.id);

      db.prepare(`
        UPDATE students
        SET currently_inside = 0, total_minutes = total_minutes + ?
        WHERE id = ?
      `).run(durationMinutes, student.id);

      const updatedLog = db.prepare(`SELECT * FROM library_logs WHERE id = ?`).get(activeLog.id) as LibraryLogRow;
      const updatedStudent = db.prepare(`SELECT * FROM students WHERE id = ?`).get(student.id) as StudentRow;

      db.prepare(`
        INSERT INTO notification_events (id, type, title, message, program, created_at, is_read)
        VALUES (?, 'EXIT', ?, ?, ?, ?, 0)
      `).run(
        `notif_${crypto.randomUUID().slice(0, 12)}`,
        `${student.full_name} Checked Out`,
        `${student.prn} (${student.program} · ${student.department}) exited after ${durationMinutes} min via ${scanMethod}.`,
        student.program,
        nowIso
      );

      return { action: 'OUT' as const, log: updatedLog, student: updatedStudent };
    } else {
      // CHECK IN
      const logId = `log_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      db.prepare(`
        INSERT INTO library_logs (
          id, student_id, prn, student_name, program, department, status,
          entry_time, exit_time, duration_minutes, scan_method, academic_session, entry_date
        ) VALUES (?, ?, ?, ?, ?, ?, 'INSIDE', ?, NULL, 0, ?, ?, ?)
      `).run(
        logId,
        student.id,
        student.prn,
        student.full_name,
        student.program,
        student.department,
        nowIso,
        scanMethod,
        session,
        todayDate
      );

      db.prepare(`
        UPDATE students
        SET currently_inside = 1, visit_count = visit_count + 1, last_entry_at = ?
        WHERE id = ?
      `).run(nowIso, student.id);

      const createdLog = db.prepare(`SELECT * FROM library_logs WHERE id = ?`).get(logId) as LibraryLogRow;
      const updatedStudent = db.prepare(`SELECT * FROM students WHERE id = ?`).get(student.id) as StudentRow;

      db.prepare(`
        INSERT INTO notification_events (id, type, title, message, program, created_at, is_read)
        VALUES (?, 'ENTRY', ?, ?, ?, ?, 0)
      `).run(
        `notif_${crypto.randomUUID().slice(0, 12)}`,
        `${student.full_name} Checked In`,
        `${student.prn} (${student.program} · ${student.department}) entered Central Library (Visit #${updatedStudent.visit_count}).`,
        student.program,
        nowIso
      );

      return { action: 'IN' as const, log: createdLog, student: updatedStudent };
    }
  });

  return tx();
}

export function recordTeacherEntryOrExit(
  teacher: TeacherRow,
  scanMethod: ScanMethod
): { action: 'IN' | 'OUT'; log: TeacherLogRow; teacher: TeacherRow } {
  const now = new Date();
  const nowIso = now.toISOString();
  const todayDate = nowIso.slice(0, 10);
  const session = getAcademicSession(now);

  const tx = db.transaction(() => {
    const activeLog = db
      .prepare(`SELECT * FROM teacher_logs WHERE teacher_id = ? AND status = 'INSIDE' ORDER BY entry_time DESC LIMIT 1`)
      .get(teacher.id) as TeacherLogRow | undefined;

    if (activeLog) {
      const entryMs = new Date(activeLog.entry_time).getTime();
      const durationMinutes = Math.max(1, Math.min(1440, Math.round((now.getTime() - entryMs) / 60_000)));
      db.prepare(`
        UPDATE teacher_logs
        SET status = 'COMPLETED', exit_time = ?, duration_minutes = ?
        WHERE id = ?
      `).run(nowIso, durationMinutes, activeLog.id);

      db.prepare(`
        UPDATE teachers
        SET currently_inside = 0, total_minutes = total_minutes + ?
        WHERE id = ?
      `).run(durationMinutes, teacher.id);

      const updatedLog = db.prepare(`SELECT * FROM teacher_logs WHERE id = ?`).get(activeLog.id) as TeacherLogRow;
      const updatedTeacher = db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(teacher.id) as TeacherRow;

      db.prepare(`
        INSERT INTO notification_events (id, type, title, message, program, created_at, is_read)
        VALUES (?, 'EXIT', ?, ?, ?, ?, 0)
      `).run(
        `notif_${crypto.randomUUID().slice(0, 12)}`,
        `${teacher.full_name} (Faculty) Checked Out`,
        `${teacher.employee_id} (${teacher.program} · ${teacher.department}) exited after ${durationMinutes} min via ${scanMethod}.`,
        teacher.program,
        nowIso
      );

      return { action: 'OUT' as const, log: updatedLog, teacher: updatedTeacher };
    } else {
      const logId = `tlog_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      db.prepare(`
        INSERT INTO teacher_logs (
          id, teacher_id, employee_id, teacher_name, program, department, designation, status,
          entry_time, exit_time, duration_minutes, scan_method, academic_session, entry_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'INSIDE', ?, NULL, 0, ?, ?, ?)
      `).run(
        logId,
        teacher.id,
        teacher.employee_id,
        teacher.full_name,
        teacher.program,
        teacher.department,
        teacher.designation,
        nowIso,
        scanMethod,
        session,
        todayDate
      );

      db.prepare(`
        UPDATE teachers
        SET currently_inside = 1, visit_count = visit_count + 1, last_entry_at = ?
        WHERE id = ?
      `).run(nowIso, teacher.id);

      const createdLog = db.prepare(`SELECT * FROM teacher_logs WHERE id = ?`).get(logId) as TeacherLogRow;
      const updatedTeacher = db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(teacher.id) as TeacherRow;

      db.prepare(`
        INSERT INTO notification_events (id, type, title, message, program, created_at, is_read)
        VALUES (?, 'ENTRY', ?, ?, ?, ?, 0)
      `).run(
        `notif_${crypto.randomUUID().slice(0, 12)}`,
        `${teacher.full_name} (Faculty) Checked In`,
        `${teacher.employee_id} (${teacher.program} · ${teacher.department}) entered Central Library (Visit #${updatedTeacher.visit_count}).`,
        teacher.program,
        nowIso
      );

      return { action: 'IN' as const, log: createdLog, teacher: updatedTeacher };
    }
  });

  return tx();
}
