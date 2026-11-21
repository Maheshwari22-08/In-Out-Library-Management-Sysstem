import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { createServer as createViteServer } from 'vite';
import {
  db,
  AdminRow,
  StudentRow,
  TeacherRow,
  LibraryLogRow,
  TeacherLogRow,
  NotificationRow,
  ReportConfigRow,
  CloudBackupRow,
  ProgramType,
  recordEntryOrExit,
  recordTeacherEntryOrExit,
  getAcademicSession,
} from './server/db.ts';
import {
  buildTotpUri,
  generateBase32Secret,
  generateTotpCode,
  hashPassword,
  parseAndVerifyQrPayload,
  SessionPayload,
  signQrPayload,
  signTeacherQrPayload,
  signToken,
  verifyPassword,
  verifyToken,
  verifyTotpCode,
} from './server/totp.ts';
import {
  dispatchWeeklyReport,
  generateLibraryExcelBuffer,
  sendMobilePushNotification,
} from './server/reports.ts';

interface AuthenticatedRequest extends Request {
  user?: SessionPayload;
}

const app = express();
app.use(express.json({ limit: '1mb' }));

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const payload = verifyToken(token);
  if (!payload || !payload.mfaVerified) {
    res.status(401).json({ error: 'Invalid or expired session token' });
    return;
  }
  req.user = payload;
  next();
}

function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Librarian administrator access required' });
      return;
    }
    next();
  });
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 160;
}

function isStrongPassword(password: string): boolean {
  return typeof password === 'string' && password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

const UNIVERSAL_GATE_QR_PAYLOAD = 'DIET-GATE:CENTRAL-LIBRARY-SATARA';

function normalizeAcademicYear(raw: unknown, program: ProgramType): string | null {
  const upper = String(raw || '').trim().toUpperCase();
  const map: Record<string, string> = {
    '1ST YEAR': '1st Year',
    '1ST': '1st Year',
    'FIRST YEAR': '1st Year',
    FE: '1st Year',
    FY: '1st Year',
    '2ND YEAR': '2nd Year',
    '2ND': '2nd Year',
    'SECOND YEAR': '2nd Year',
    SE: '2nd Year',
    SY: '2nd Year',
    '3RD YEAR': '3rd Year',
    '3RD': '3rd Year',
    'THIRD YEAR': '3rd Year',
    TE: '3rd Year',
    TY: '3rd Year',
    '4TH YEAR': '4th Year',
    '4TH': '4th Year',
    'FOURTH YEAR': '4th Year',
    BE: '4th Year',
  };
  const canonical = map[upper];
  if (!canonical) return null;
  if (program === 'Diploma' && canonical === '4th Year') return null;
  return canonical;
}

// --- Public Aggregate Overview (No PII exposed) ---
app.get('/api/public/overview', (_req, res) => {
  const summary = db
    .prepare(`
      SELECT
        COUNT(*) as total_students,
        SUM(CASE WHEN program = 'Degree' THEN 1 ELSE 0 END) as degree_students,
        SUM(CASE WHEN program = 'Diploma' THEN 1 ELSE 0 END) as diploma_students,
        SUM(CASE WHEN currently_inside = 1 THEN 1 ELSE 0 END) as currently_inside,
        SUM(CASE WHEN currently_inside = 1 AND program = 'Degree' THEN 1 ELSE 0 END) as degree_inside,
        SUM(CASE WHEN currently_inside = 1 AND program = 'Diploma' THEN 1 ELSE 0 END) as diploma_inside,
        SUM(visit_count) as total_visits,
        SUM(total_minutes) as total_minutes
      FROM students
    `)
    .get() as Record<string, number>;

  const teacherSummary = db
    .prepare(`
      SELECT
        COUNT(*) as total_teachers,
        SUM(CASE WHEN currently_inside = 1 THEN 1 ELSE 0 END) as teachers_inside,
        SUM(visit_count) as teacher_visits,
        SUM(total_minutes) as teacher_minutes
      FROM teachers
    `)
    .get() as Record<string, number>;

  const todayDate = new Date().toISOString().slice(0, 10);
  const todayStats = db
    .prepare(`SELECT COUNT(*) as today_entries FROM library_logs WHERE entry_date = ?`)
    .get(todayDate) as { today_entries: number };
  const todayTeacherStats = db
    .prepare(`SELECT COUNT(*) as today_entries FROM teacher_logs WHERE entry_date = ?`)
    .get(todayDate) as { today_entries: number };

  const gateQrDataUrlPromise = QRCode.toDataURL('DIET-GATE:CENTRAL-LIBRARY-SATARA', {
    width: 280,
    margin: 2,
    color: { dark: '#0F2942', light: '#FFFFFF' },
  });

  gateQrDataUrlPromise
    .then((gateQrDataUrl) => {
      const studentsInside = summary.currently_inside || 0;
      const teachersInside = teacherSummary.teachers_inside || 0;
      const totalVisits = (summary.total_visits || 0) + (teacherSummary.teacher_visits || 0);
      const totalMinutes = (summary.total_minutes || 0) + (teacherSummary.teacher_minutes || 0);
      res.json({
        institution: 'Dnyanshree Institute of Engineering and Technology, Satara',
        summary: {
          totalStudents: summary.total_students || 0,
          degreeStudents: summary.degree_students || 0,
          diplomaStudents: summary.diploma_students || 0,
          totalTeachers: teacherSummary.total_teachers || 0,
          teachersInside,
          studentsInside,
          currentlyInside: studentsInside + teachersInside,
          degreeInside: summary.degree_inside || 0,
          diplomaInside: summary.diploma_inside || 0,
          totalVisits,
          totalHours: Math.round((totalMinutes / 60) * 10) / 10,
          todayEntries: (todayStats.today_entries || 0) + (todayTeacherStats.today_entries || 0),
          seatCapacity: 150,
        },
        gateQrDataUrl,
      });
    })
    .catch(() => {
      res.status(500).json({ error: 'Failed to generate gate QR' });
    });
});

// --- Public Gate Kiosk Recent IN/OUT Entries (No PII) ---
app.get('/api/public/recent-entries', (_req, res) => {
  const studentRows = db
    .prepare(`
      SELECT
        l.id,
        l.prn as code,
        s.full_name as full_name,
        'Student' as member_type,
        l.program,
        l.department,
        l.status,
        l.entry_time,
        l.exit_time,
        l.duration_minutes,
        l.scan_method
      FROM library_logs l
      JOIN students s ON s.id = l.student_id
      ORDER BY l.entry_time DESC
      LIMIT 20
    `)
    .all() as Array<Record<string, unknown>>;

  const teacherRows = db
    .prepare(`
      SELECT
        l.id,
        l.employee_id as code,
        t.full_name as full_name,
        'Faculty' as member_type,
        l.program,
        l.department,
        l.status,
        l.entry_time,
        l.exit_time,
        l.duration_minutes,
        l.scan_method
      FROM teacher_logs l
      JOIN teachers t ON t.id = l.teacher_id
      ORDER BY l.entry_time DESC
      LIMIT 10
    `)
    .all() as Array<Record<string, unknown>>;

  const combined = [...studentRows, ...teacherRows]
    .sort((a, b) => String(b.entry_time).localeCompare(String(a.entry_time)))
    .slice(0, 25);

  res.json({ entries: combined });
});

// --- Public Gate Kiosk IN/OUT Entry Recording (No PII returned) ---
app.post('/api/public/in-out-entry', async (req, res) => {
  const { qrPayload } = req.body || {};
  const parsed = parseAndVerifyQrPayload(String(qrPayload || ''));
  if (!parsed.valid) {
    res.status(400).json({
      error: 'Unrecognized QR or ID. Enter a valid PRN (e.g. DEG-CS-2401), Employee ID (e.g. TCH-CS-101), or scan a member QR card.',
    });
    return;
  }

  if (parsed.isGateQr || !parsed.prn) {
    res.status(400).json({
      error: 'That is the entrance Gate QR poster. At the gate kiosk, scan a Student or Teacher Digital QR ID (or enter PRN / Employee ID).',
    });
    return;
  }

  if (parsed.memberType === 'teacher') {
    const teacher = db
      .prepare('SELECT * FROM teachers WHERE employee_id = ?')
      .get(parsed.prn) as TeacherRow | undefined;
    if (!teacher) {
      res.status(404).json({ error: `No registered faculty found for Employee ID ${parsed.prn}.` });
      return;
    }
    const result = recordTeacherEntryOrExit(teacher, 'QR_KIOSK');
    await sendMobilePushNotification(
      `Library ${result.action} (Faculty): ${result.teacher.full_name}`,
      `${result.teacher.employee_id} (${result.teacher.program} · ${result.teacher.department}) — Visit #${result.teacher.visit_count}.`
    );
    res.json({
      action: result.action,
      memberType: 'teacher',
      member: {
        code: result.teacher.employee_id,
        full_name: result.teacher.full_name,
        program: result.teacher.program,
        department: result.teacher.department,
        subLabel: result.teacher.designation,
        visit_count: result.teacher.visit_count,
      },
      log: {
        entry_time: result.log.entry_time,
        exit_time: result.log.exit_time,
        duration_minutes: result.log.duration_minutes,
        status: result.log.status,
      },
    });
    return;
  }

  const student = db
    .prepare('SELECT * FROM students WHERE prn = ?')
    .get(parsed.prn) as StudentRow | undefined;
  if (student) {
    const result = recordEntryOrExit(student, 'QR_KIOSK');
    await sendMobilePushNotification(
      `Library ${result.action}: ${result.student.full_name}`,
      `${result.student.prn} (${result.student.program} · ${result.student.department}) — Visit #${result.student.visit_count}.`
    );
    res.json({
      action: result.action,
      memberType: 'student',
      member: {
        code: result.student.prn,
        full_name: result.student.full_name,
        program: result.student.program,
        department: result.student.department,
        subLabel: result.student.academic_year,
        visit_count: result.student.visit_count,
      },
      log: {
        entry_time: result.log.entry_time,
        exit_time: result.log.exit_time,
        duration_minutes: result.log.duration_minutes,
        status: result.log.status,
      },
    });
    return;
  }

  const fallbackTeacher = db
    .prepare('SELECT * FROM teachers WHERE employee_id = ?')
    .get(parsed.prn) as TeacherRow | undefined;
  if (fallbackTeacher) {
    const result = recordTeacherEntryOrExit(fallbackTeacher, 'QR_KIOSK');
    await sendMobilePushNotification(
      `Library ${result.action} (Faculty): ${result.teacher.full_name}`,
      `${result.teacher.employee_id} (${result.teacher.program} · ${result.teacher.department}) — Visit #${result.teacher.visit_count}.`
    );
    res.json({
      action: result.action,
      memberType: 'teacher',
      member: {
        code: result.teacher.employee_id,
        full_name: result.teacher.full_name,
        program: result.teacher.program,
        department: result.teacher.department,
        subLabel: result.teacher.designation,
        visit_count: result.teacher.visit_count,
      },
      log: {
        entry_time: result.log.entry_time,
        exit_time: result.log.exit_time,
        duration_minutes: result.log.duration_minutes,
        status: result.log.status,
      },
    });
    return;
  }

  res.status(404).json({ error: `No student or faculty record found for ID ${parsed.prn}.` });
});

// --- Auth: Admin First-Run Status & Claim ---
app.get('/api/auth/admin-status', (_req, res) => {
  const adminCount = (db.prepare('SELECT COUNT(*) as c FROM admins').get() as { c: number }).c;
  const envPasscodeConfigured = Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0);
  res.json({
    adminClaimed: adminCount > 0 || envPasscodeConfigured,
    envOverrideActive: envPasscodeConfigured,
  });
});

app.post('/api/auth/admin-setup', async (req, res) => {
  const adminCount = (db.prepare('SELECT COUNT(*) as c FROM admins').get() as { c: number }).c;
  const envPasscodeConfigured = Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0);
  if (adminCount > 0 || envPasscodeConfigured) {
    res.status(403).json({ error: 'Head Librarian account is already claimed. Please sign in.' });
    return;
  }

  const { email, fullName, password } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(fullName || '').trim();
  if (!isValidEmail(cleanEmail) || cleanName.length < 2 || cleanName.length > 100) {
    res.status(400).json({ error: 'Valid institutional email and full name are required.' });
    return;
  }
  if (!isStrongPassword(password)) {
    res.status(400).json({ error: 'Password must be at least 8 characters and include letters and numbers.' });
    return;
  }

  const adminId = `adm_${crypto.randomUUID().slice(0, 12)}`;
  const mfaSecret = generateBase32Secret();
  const passwordHash = hashPassword(password);
  const nowIso = new Date().toISOString();

  db.prepare(`
    INSERT INTO admins (id, email, full_name, password_hash, role, mfa_secret, mfa_enabled, created_at)
    VALUES (?, ?, ?, ?, 'head_librarian', ?, 1, ?)
  `).run(adminId, cleanEmail, cleanName, passwordHash, mfaSecret, nowIso);

  const otpauthUri = buildTotpUri(cleanEmail, mfaSecret, 'Admin');
  const totpQrDataUrl = await QRCode.toDataURL(otpauthUri, { width: 220, margin: 1 });
  const challengeToken = signToken({ sub: adminId, role: 'admin', email: cleanEmail, mfaVerified: false }, 600);

  res.status(201).json({
    message: 'Head Librarian credentials configured. Complete MFA verification to enter.',
    challengeToken,
    mfaSetup: {
      secret: mfaSecret,
      otpauthUri,
      totpQrDataUrl,
      initialVerificationHint: generateTotpCode(mfaSecret),
    },
  });
});

// --- Auth: Student Registration (Degree & Diploma selection) ---
app.post('/api/auth/student-register', async (req, res) => {
  const { prn, fullName, email, password, program, department, academicYear, phone } = req.body || {};
  const cleanPrn = String(prn || '').trim().toUpperCase();
  const cleanName = String(fullName || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanDept = String(department || '').trim();
  const cleanPhone = phone ? String(phone).trim().slice(0, 20) : null;

  if (!/^[A-Z0-9-]{4,32}$/.test(cleanPrn)) {
    res.status(400).json({ error: 'PRN / Roll Number must be 4-32 uppercase letters, numbers, or hyphens.' });
    return;
  }
  if (cleanName.length < 2 || cleanName.length > 100) {
    res.status(400).json({ error: 'Full name must be between 2 and 100 characters.' });
    return;
  }
  if (!isValidEmail(cleanEmail)) {
    res.status(400).json({ error: 'Please provide a valid student email address.' });
    return;
  }
  if (!isStrongPassword(password)) {
    res.status(400).json({ error: 'Password must be at least 8 characters with letters and digits.' });
    return;
  }
  if (program !== 'Degree' && program !== 'Diploma') {
    res.status(400).json({ error: 'Program must be either Degree or Diploma.' });
    return;
  }
  const cleanYear = normalizeAcademicYear(academicYear, program);
  const validYears = program === 'Degree' ? ['1st Year', '2nd Year', '3rd Year', '4th Year'] : ['1st Year', '2nd Year', '3rd Year'];
  if (!cleanYear) {
    res.status(400).json({ error: `Invalid academic year for ${program}. Expected: ${validYears.join(', ')}` });
    return;
  }
  if (cleanDept.length < 2 || cleanDept.length > 80) {
    res.status(400).json({ error: 'Please select a valid department.' });
    return;
  }

  const existing = db
    .prepare('SELECT id FROM students WHERE email = ? OR prn = ?')
    .get(cleanEmail, cleanPrn) as { id: string } | undefined;
  if (existing) {
    res.status(409).json({ error: 'A student account with this Email or PRN already exists.' });
    return;
  }

  const studentId = `stu_${crypto.randomUUID().slice(0, 12)}`;
  const mfaSecret = generateBase32Secret();
  const qrToken = signQrPayload(cleanPrn);
  const nowIso = new Date().toISOString();

  db.prepare(`
    INSERT INTO students (
      id, prn, full_name, email, password_hash, program, department, academic_year,
      phone, qr_token, mfa_secret, mfa_enabled, visit_count, total_minutes,
      currently_inside, last_entry_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 0, NULL, ?)
  `).run(
    studentId,
    cleanPrn,
    cleanName,
    cleanEmail,
    hashPassword(password),
    program,
    cleanDept,
    cleanYear,
    cleanPhone,
    qrToken,
    mfaSecret,
    nowIso
  );

  const otpauthUri = buildTotpUri(cleanEmail, mfaSecret, program);
  const totpQrDataUrl = await QRCode.toDataURL(otpauthUri, { width: 220, margin: 1 });
  const challengeToken = signToken({ sub: studentId, role: 'student', email: cleanEmail, mfaVerified: false }, 600);

  res.status(201).json({
    message: 'Student profile created. Verify your 6-digit MFA code to activate your Digital Library Card.',
    challengeToken,
    mfaSetup: {
      secret: mfaSecret,
      otpauthUri,
      totpQrDataUrl,
      initialVerificationHint: generateTotpCode(mfaSecret),
    },
  });
});

// --- Auth: Teacher Registration (Degree & Diploma Faculty) ---
app.post('/api/auth/teacher-register', async (req, res) => {
  const { employeeId, fullName, email, password, program, department, designation, phone } = req.body || {};
  const cleanEmpId = String(employeeId || '').trim().toUpperCase();
  const cleanName = String(fullName || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanDept = String(department || '').trim();
  const cleanDesignation = String(designation || '').trim();
  const cleanPhone = phone ? String(phone).trim().slice(0, 20) : null;

  if (!/^[A-Z0-9-]{4,32}$/.test(cleanEmpId)) {
    res.status(400).json({ error: 'Employee / Faculty ID must be 4-32 uppercase letters, numbers, or hyphens.' });
    return;
  }
  if (cleanName.length < 2 || cleanName.length > 100) {
    res.status(400).json({ error: 'Full name must be between 2 and 100 characters.' });
    return;
  }
  if (!isValidEmail(cleanEmail)) {
    res.status(400).json({ error: 'Please provide a valid institutional faculty email address.' });
    return;
  }
  if (!isStrongPassword(password)) {
    res.status(400).json({ error: 'Password must be at least 8 characters with letters and digits.' });
    return;
  }
  if (program !== 'Degree' && program !== 'Diploma') {
    res.status(400).json({ error: 'Program wing must be either Degree or Diploma.' });
    return;
  }
  if (cleanDept.length < 2 || cleanDept.length > 80) {
    res.status(400).json({ error: 'Please select a valid department.' });
    return;
  }
  if (cleanDesignation.length < 2 || cleanDesignation.length > 60) {
    res.status(400).json({ error: 'Please select a valid faculty designation.' });
    return;
  }

  const existing = db
    .prepare('SELECT id FROM teachers WHERE email = ? OR employee_id = ?')
    .get(cleanEmail, cleanEmpId) as { id: string } | undefined;
  if (existing) {
    res.status(409).json({ error: 'A faculty account with this Email or Employee ID already exists.' });
    return;
  }

  const teacherId = `tch_${crypto.randomUUID().slice(0, 12)}`;
  const mfaSecret = generateBase32Secret();
  const qrToken = signTeacherQrPayload(cleanEmpId);
  const nowIso = new Date().toISOString();

  db.prepare(`
    INSERT INTO teachers (
      id, employee_id, full_name, email, password_hash, program, department, designation,
      phone, qr_token, mfa_secret, mfa_enabled, visit_count, total_minutes,
      currently_inside, last_entry_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 0, NULL, ?)
  `).run(
    teacherId,
    cleanEmpId,
    cleanName,
    cleanEmail,
    hashPassword(password),
    program,
    cleanDept,
    cleanDesignation,
    cleanPhone,
    qrToken,
    mfaSecret,
    nowIso
  );

  const otpauthUri = buildTotpUri(cleanEmail, mfaSecret, `Faculty · ${program}`);
  const totpQrDataUrl = await QRCode.toDataURL(otpauthUri, { width: 220, margin: 1 });
  const challengeToken = signToken({ sub: teacherId, role: 'teacher', email: cleanEmail, mfaVerified: false }, 600);

  res.status(201).json({
    message: 'Faculty profile created. Verify your 6-digit MFA code to activate your Digital Faculty Library Card.',
    challengeToken,
    mfaSetup: {
      secret: mfaSecret,
      otpauthUri,
      totpQrDataUrl,
      initialVerificationHint: generateTotpCode(mfaSecret),
    },
  });
});

// --- Auth: Step 1 Login (Email + Password validation) ---
app.post('/api/auth/login', (req, res) => {
  const { role, email, password } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!isValidEmail(cleanEmail) || typeof password !== 'string' || password.length === 0) {
    res.status(400).json({ error: 'Valid email and password are required.' });
    return;
  }

  if (role === 'admin') {
    const envPasscode = process.env.ADMIN_PASSCODE?.trim();
    const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(cleanEmail) as AdminRow | undefined;

    if (envPasscode) {
      if (password !== envPasscode) {
        res.status(401).json({ error: 'Invalid admin email or password.' });
        return;
      }
      const adminId = admin?.id || 'adm_env_primary';
      const secret = admin?.mfa_secret || generateBase32Secret();
      if (!admin) {
        db.prepare(`
          INSERT INTO admins (id, email, full_name, password_hash, role, mfa_secret, mfa_enabled, created_at)
          VALUES (?, ?, 'Head Librarian', ?, 'head_librarian', ?, 1, ?)
        `).run(adminId, cleanEmail, hashPassword(envPasscode), secret, new Date().toISOString());
      }
      const challengeToken = signToken({ sub: adminId, role: 'admin', email: cleanEmail, mfaVerified: false }, 300);
      res.json({ requiresMfa: true, challengeToken, role: 'admin', email: cleanEmail });
      return;
    }

    if (!admin || !verifyPassword(password, admin.password_hash)) {
      res.status(401).json({ error: 'Invalid admin email or password.' });
      return;
    }
    const challengeToken = signToken({ sub: admin.id, role: 'admin', email: admin.email, mfaVerified: false }, 300);
    res.json({ requiresMfa: true, challengeToken, role: 'admin', email: admin.email });
    return;
  }

  if (role === 'teacher') {
    const teacher = db.prepare('SELECT * FROM teachers WHERE email = ?').get(cleanEmail) as TeacherRow | undefined;
    if (!teacher || !verifyPassword(password, teacher.password_hash)) {
      res.status(401).json({ error: 'Invalid faculty email or password.' });
      return;
    }
    const challengeToken = signToken({ sub: teacher.id, role: 'teacher', email: teacher.email, mfaVerified: false }, 300);
    res.json({ requiresMfa: true, challengeToken, role: 'teacher', email: teacher.email });
    return;
  }

  const student = db.prepare('SELECT * FROM students WHERE email = ?').get(cleanEmail) as StudentRow | undefined;
  if (!student || !verifyPassword(password, student.password_hash)) {
    res.status(401).json({ error: 'Invalid student email or password.' });
    return;
  }

  const challengeToken = signToken({ sub: student.id, role: 'student', email: student.email, mfaVerified: false }, 300);
  res.json({ requiresMfa: true, challengeToken, role: 'student', email: student.email });
});

// --- Auth: Step 2 MFA Verification ---
app.post('/api/auth/verify-mfa', (req, res) => {
  const { challengeToken, code } = req.body || {};
  const payload = verifyToken(String(challengeToken || ''));
  if (!payload) {
    res.status(401).json({ error: 'MFA challenge expired. Please sign in again.' });
    return;
  }

  if (payload.role === 'admin') {
    const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(payload.sub) as AdminRow | undefined;
    if (!admin || !verifyTotpCode(admin.mfa_secret, String(code || ''))) {
      res.status(401).json({ error: 'Invalid 6-digit authenticator code.' });
      return;
    }
    const sessionToken = signToken({ sub: admin.id, role: 'admin', email: admin.email, mfaVerified: true }, 8 * 3600);
    res.json({
      token: sessionToken,
      user: {
        id: admin.id,
        email: admin.email,
        fullName: admin.full_name,
        role: 'admin',
      },
    });
    return;
  }

  if (payload.role === 'teacher') {
    const teacher = db.prepare('SELECT * FROM teachers WHERE id = ?').get(payload.sub) as TeacherRow | undefined;
    if (!teacher || !verifyTotpCode(teacher.mfa_secret, String(code || ''))) {
      res.status(401).json({ error: 'Invalid 6-digit authenticator code.' });
      return;
    }
    const sessionToken = signToken({ sub: teacher.id, role: 'teacher', email: teacher.email, mfaVerified: true }, 8 * 3600);
    res.json({
      token: sessionToken,
      user: {
        id: teacher.id,
        employeeId: teacher.employee_id,
        email: teacher.email,
        fullName: teacher.full_name,
        program: teacher.program,
        department: teacher.department,
        designation: teacher.designation,
        role: 'teacher',
      },
    });
    return;
  }

  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(payload.sub) as StudentRow | undefined;
  if (!student || !verifyTotpCode(student.mfa_secret, String(code || ''))) {
    res.status(401).json({ error: 'Invalid 6-digit authenticator code.' });
    return;
  }
  const sessionToken = signToken({ sub: student.id, role: 'student', email: student.email, mfaVerified: true }, 8 * 3600);
  res.json({
    token: sessionToken,
    user: {
      id: student.id,
      prn: student.prn,
      email: student.email,
      fullName: student.full_name,
      program: student.program,
      department: student.department,
      academicYear: student.academic_year,
      role: 'student',
    },
  });
});

// --- Auth: Verified Firebase Google SSO Exchange ---
app.post('/api/auth/firebase-exchange', async (req, res) => {
  const { idToken, roleHint, programChoice } = req.body || {};
  if (typeof idToken !== 'string' || idToken.length < 20) {
    res.status(400).json({ error: 'Valid Firebase ID token is required.' });
    return;
  }

  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { apiKey?: string };
    if (!cfg.apiKey) {
      res.status(500).json({ error: 'Firebase configuration missing.' });
      return;
    }

    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(cfg.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!verifyRes.ok) {
      res.status(401).json({ error: 'Unable to verify Google identity token.' });
      return;
    }
    const verifyData = (await verifyRes.json()) as {
      users?: Array<{ email?: string; emailVerified?: boolean; displayName?: string; localId?: string }>;
    };
    const fbUser = verifyData.users?.[0];
    if (!fbUser?.email || !fbUser.emailVerified) {
      res.status(401).json({ error: 'Verified Google email is required.' });
      return;
    }

    const cleanEmail = fbUser.email.toLowerCase();
    const displayName = (fbUser.displayName || cleanEmail.split('@')[0]).slice(0, 100);

    if (roleHint === 'admin') {
      const existingAdmin = db.prepare('SELECT * FROM admins WHERE email = ?').get(cleanEmail) as AdminRow | undefined;
      const isBootstrappedAdmin = cleanEmail === 'mahipawar295@gmail.com';
      if (!existingAdmin && !isBootstrappedAdmin) {
        res.status(403).json({
          error: 'This Google account is not authorized as a Library Administrator. Use Student SSO or sign in with Librarian credentials.',
        });
        return;
      }
      let admin = existingAdmin;
      if (!admin) {
        const adminId = `adm_${crypto.randomUUID().slice(0, 12)}`;
        db.prepare(`
          INSERT INTO admins (id, email, full_name, password_hash, role, mfa_secret, mfa_enabled, created_at)
          VALUES (?, ?, ?, ?, 'head_librarian', ?, 1, ?)
        `).run(adminId, cleanEmail, displayName, hashPassword(crypto.randomBytes(24).toString('hex')), generateBase32Secret(), new Date().toISOString());
        admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(adminId) as AdminRow;
      }
      const token = signToken({ sub: admin.id, role: 'admin', email: admin.email, mfaVerified: true }, 8 * 3600);
      res.json({
        token,
        user: {
          id: admin.id,
          email: admin.email,
          fullName: admin.full_name,
          role: 'admin',
        },
      });
      return;
    }

    if (roleHint === 'teacher') {
      let teacher = db.prepare('SELECT * FROM teachers WHERE email = ?').get(cleanEmail) as TeacherRow | undefined;
      if (!teacher) {
        const prog: ProgramType = programChoice === 'Diploma' ? 'Diploma' : 'Degree';
        const empId = `TCH-SSO-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
        const tchId = `tch_${crypto.randomUUID().slice(0, 12)}`;
        const dept = 'Computer Science & Engineering';
        const desig = prog === 'Degree' ? 'Assistant Professor' : 'Lecturer';
        db.prepare(`
          INSERT INTO teachers (
            id, employee_id, full_name, email, password_hash, program, department, designation,
            phone, qr_token, mfa_secret, mfa_enabled, visit_count, total_minutes,
            currently_inside, last_entry_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, 0, 0, 0, NULL, ?)
        `).run(
          tchId,
          empId,
          displayName,
          cleanEmail,
          hashPassword(crypto.randomBytes(24).toString('hex')),
          prog,
          dept,
          desig,
          signTeacherQrPayload(empId),
          generateBase32Secret(),
          new Date().toISOString()
        );
        teacher = db.prepare('SELECT * FROM teachers WHERE id = ?').get(tchId) as TeacherRow;
      }

      const token = signToken({ sub: teacher.id, role: 'teacher', email: teacher.email, mfaVerified: true }, 8 * 3600);
      res.json({
        token,
        user: {
          id: teacher.id,
          employeeId: teacher.employee_id,
          email: teacher.email,
          fullName: teacher.full_name,
          program: teacher.program,
          department: teacher.department,
          designation: teacher.designation,
          role: 'teacher',
        },
      });
      return;
    }

    let student = db.prepare('SELECT * FROM students WHERE email = ?').get(cleanEmail) as StudentRow | undefined;
    if (!student) {
      const prog: ProgramType = programChoice === 'Diploma' ? 'Diploma' : 'Degree';
      const prefix = prog === 'Degree' ? 'DEG' : 'DIP';
      const prn = `${prefix}-SSO-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const stuId = `stu_${crypto.randomUUID().slice(0, 12)}`;
      const dept = 'Computer Science & Engineering';
      const yr = '3rd Year';
      db.prepare(`
        INSERT INTO students (
          id, prn, full_name, email, password_hash, program, department, academic_year,
          phone, qr_token, mfa_secret, mfa_enabled, visit_count, total_minutes,
          currently_inside, last_entry_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, 0, 0, 0, NULL, ?)
      `).run(
        stuId,
        prn,
        displayName,
        cleanEmail,
        hashPassword(crypto.randomBytes(24).toString('hex')),
        prog,
        dept,
        yr,
        signQrPayload(prn),
        generateBase32Secret(),
        new Date().toISOString()
      );
      student = db.prepare('SELECT * FROM students WHERE id = ?').get(stuId) as StudentRow;
    }

    const token = signToken({ sub: student.id, role: 'student', email: student.email, mfaVerified: true }, 8 * 3600);
    res.json({
      token,
      user: {
        id: student.id,
        prn: student.prn,
        email: student.email,
        fullName: student.full_name,
        program: student.program,
        department: student.department,
        academicYear: student.academic_year,
        role: 'student',
      },
    });
  } catch (err) {
    console.error('Firebase SSO exchange failed:', err);
    res.status(500).json({ error: 'Unable to complete Google SSO session.' });
  }
});

// --- Student Self-Service Dashboard API ---
app.get('/api/student/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (req.user?.role !== 'student') {
    res.status(403).json({ error: 'Student account required' });
    return;
  }
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.user.sub) as StudentRow | undefined;
  if (!student) {
    res.status(404).json({ error: 'Student profile not found' });
    return;
  }

  const logs = db
    .prepare('SELECT * FROM library_logs WHERE student_id = ? ORDER BY entry_time DESC LIMIT 100')
    .all(student.id) as LibraryLogRow[];

  const qrDataUrl = await QRCode.toDataURL(student.qr_token, {
    width: 260,
    margin: 2,
    color: { dark: '#0F2942', light: '#FFFFFF' },
  });
  const gateQrDataUrl = await QRCode.toDataURL(UNIVERSAL_GATE_QR_PAYLOAD, {
    width: 260,
    margin: 2,
    color: { dark: '#0F2942', light: '#FFFFFF' },
  });

  res.json({
    profile: {
      id: student.id,
      prn: student.prn,
      fullName: student.full_name,
      email: student.email,
      program: student.program,
      department: student.department,
      academicYear: student.academic_year,
      phone: student.phone,
      qrToken: student.qr_token,
      qrDataUrl,
      visitCount: student.visit_count,
      totalMinutes: student.total_minutes,
      currentlyInside: student.currently_inside === 1,
      lastEntryAt: student.last_entry_at,
    },
    gateQrDataUrl,
    logs,
  });
});

app.patch('/api/student/program', requireAuth, (req: AuthenticatedRequest, res) => {
  if (req.user?.role !== 'student') {
    res.status(403).json({ error: 'Student account required' });
    return;
  }
  const { program, department, academicYear } = req.body || {};
  if (program !== 'Degree' && program !== 'Diploma') {
    res.status(400).json({ error: 'Program must be Degree or Diploma.' });
    return;
  }
  const cleanYear = normalizeAcademicYear(academicYear, program);
  const cleanDept = String(department || '').trim();
  if (!cleanYear || cleanDept.length < 2 || cleanDept.length > 80) {
    res.status(400).json({ error: 'Invalid department or academic year.' });
    return;
  }
  db.prepare(`UPDATE students SET program = ?, department = ?, academic_year = ? WHERE id = ?`).run(
    program,
    cleanDept,
    cleanYear,
    req.user.sub
  );
  res.json({ updated: true, program, department: cleanDept, academicYear: cleanYear });
});

app.post('/api/student/self-scan', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (req.user?.role !== 'student') {
    res.status(403).json({ error: 'Student account required' });
    return;
  }
  const { qrPayload } = req.body || {};
  const parsed = parseAndVerifyQrPayload(String(qrPayload || ''));
  if (!parsed.valid) {
    res.status(400).json({ error: 'Unrecognized QR code. Please scan the Central Library Gate QR.' });
    return;
  }

  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.user.sub) as StudentRow | undefined;
  if (!student) {
    res.status(404).json({ error: 'Student record not found' });
    return;
  }

  if (!parsed.isGateQr && parsed.prn !== student.prn) {
    res.status(403).json({ error: 'Cannot scan another student ID from self-service portal.' });
    return;
  }

  const result = recordEntryOrExit(student, 'STUDENT_SCAN');
  await sendMobilePushNotification(
    `Library ${result.action}: ${result.student.full_name}`,
    `${result.student.prn} (${result.student.program}) checked ${result.action} via Student Scan.`
  );
  res.json(result);
});

// --- Teacher Self-Service Dashboard API ---
app.get('/api/teacher/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (req.user?.role !== 'teacher') {
    res.status(403).json({ error: 'Faculty account required' });
    return;
  }
  const teacher = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.user.sub) as TeacherRow | undefined;
  if (!teacher) {
    res.status(404).json({ error: 'Faculty profile not found' });
    return;
  }

  const logs = db
    .prepare('SELECT * FROM teacher_logs WHERE teacher_id = ? ORDER BY entry_time DESC LIMIT 100')
    .all(teacher.id) as TeacherLogRow[];

  const qrDataUrl = await QRCode.toDataURL(teacher.qr_token, {
    width: 260,
    margin: 2,
    color: { dark: '#0F2942', light: '#FFFFFF' },
  });
  const gateQrDataUrl = await QRCode.toDataURL(UNIVERSAL_GATE_QR_PAYLOAD, {
    width: 260,
    margin: 2,
    color: { dark: '#0F2942', light: '#FFFFFF' },
  });

  res.json({
    profile: {
      id: teacher.id,
      employeeId: teacher.employee_id,
      fullName: teacher.full_name,
      email: teacher.email,
      program: teacher.program,
      department: teacher.department,
      designation: teacher.designation,
      phone: teacher.phone,
      qrToken: teacher.qr_token,
      qrDataUrl,
      visitCount: teacher.visit_count,
      totalMinutes: teacher.total_minutes,
      currentlyInside: teacher.currently_inside === 1,
      lastEntryAt: teacher.last_entry_at,
    },
    gateQrDataUrl,
    logs,
  });
});

app.patch('/api/teacher/program', requireAuth, (req: AuthenticatedRequest, res) => {
  if (req.user?.role !== 'teacher') {
    res.status(403).json({ error: 'Faculty account required' });
    return;
  }
  const { program, department, designation } = req.body || {};
  if (program !== 'Degree' && program !== 'Diploma') {
    res.status(400).json({ error: 'Program must be Degree or Diploma.' });
    return;
  }
  const cleanDept = String(department || '').trim();
  const cleanDesig = String(designation || '').trim();
  if (cleanDept.length < 2 || cleanDept.length > 80 || cleanDesig.length < 2 || cleanDesig.length > 60) {
    res.status(400).json({ error: 'Invalid department or faculty designation.' });
    return;
  }
  db.prepare(`UPDATE teachers SET program = ?, department = ?, designation = ? WHERE id = ?`).run(
    program,
    cleanDept,
    cleanDesig,
    req.user.sub
  );
  res.json({ updated: true, program, department: cleanDept, designation: cleanDesig });
});

app.post('/api/teacher/self-scan', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (req.user?.role !== 'teacher') {
    res.status(403).json({ error: 'Faculty account required' });
    return;
  }
  const { qrPayload } = req.body || {};
  const parsed = parseAndVerifyQrPayload(String(qrPayload || ''));
  if (!parsed.valid) {
    res.status(400).json({ error: 'Unrecognized QR code. Please scan the Central Library Gate QR.' });
    return;
  }

  const teacher = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.user.sub) as TeacherRow | undefined;
  if (!teacher) {
    res.status(404).json({ error: 'Faculty record not found' });
    return;
  }

  if (!parsed.isGateQr && parsed.prn !== teacher.employee_id) {
    res.status(403).json({ error: 'Cannot scan another member ID from self-service portal.' });
    return;
  }

  const result = recordTeacherEntryOrExit(teacher, 'TEACHER_SCAN');
  await sendMobilePushNotification(
    `Library ${result.action} (Faculty): ${result.teacher.full_name}`,
    `${result.teacher.employee_id} (${result.teacher.program} · ${result.teacher.designation}) checked ${result.action} via Teacher Scan.`
  );
  res.json(result);
});

// --- Admin / Gate Kiosk Scanner Endpoint (Supports Students & Faculty) ---
app.post('/api/kiosk/scan', requireAdmin, async (req: AuthenticatedRequest, res) => {
  const { qrPayload, scanMethod } = req.body || {};
  const parsed = parseAndVerifyQrPayload(String(qrPayload || ''));
  if (!parsed.valid || !parsed.prn) {
    res.status(400).json({ error: 'Invalid member QR, PRN, or Employee ID code.' });
    return;
  }

  const method = scanMethod === 'MANUAL_ADMIN' ? 'MANUAL_ADMIN' : 'QR_KIOSK';

  if (parsed.memberType === 'teacher') {
    const teacher = db.prepare('SELECT * FROM teachers WHERE employee_id = ?').get(parsed.prn) as TeacherRow | undefined;
    if (!teacher) {
      res.status(404).json({ error: `No registered faculty found for Employee ID ${parsed.prn}.` });
      return;
    }
    const result = recordTeacherEntryOrExit(teacher, method);
    await sendMobilePushNotification(
      `Library ${result.action} (Faculty): ${result.teacher.full_name}`,
      `${result.teacher.employee_id} (${result.teacher.program} · ${result.teacher.department}) — Visit #${result.teacher.visit_count}.`
    );
    res.json({
      ...result,
      memberType: 'teacher',
      member: {
        id: result.teacher.id,
        code: result.teacher.employee_id,
        full_name: result.teacher.full_name,
        program: result.teacher.program,
        department: result.teacher.department,
        subLabel: result.teacher.designation,
        visit_count: result.teacher.visit_count,
      },
    });
    return;
  }

  const student = db.prepare('SELECT * FROM students WHERE prn = ?').get(parsed.prn) as StudentRow | undefined;
  if (student) {
    const result = recordEntryOrExit(student, method);
    await sendMobilePushNotification(
      `Library ${result.action}: ${result.student.full_name}`,
      `${result.student.prn} (${result.student.program} · ${result.student.department}) — Visit #${result.student.visit_count}.`
    );
    res.json({
      ...result,
      memberType: 'student',
      member: {
        id: result.student.id,
        code: result.student.prn,
        full_name: result.student.full_name,
        program: result.student.program,
        department: result.student.department,
        subLabel: result.student.academic_year,
        visit_count: result.student.visit_count,
      },
    });
    return;
  }

  const fallbackTeacher = db.prepare('SELECT * FROM teachers WHERE employee_id = ?').get(parsed.prn) as TeacherRow | undefined;
  if (fallbackTeacher) {
    const result = recordTeacherEntryOrExit(fallbackTeacher, method);
    await sendMobilePushNotification(
      `Library ${result.action} (Faculty): ${result.teacher.full_name}`,
      `${result.teacher.employee_id} (${result.teacher.program} · ${result.teacher.department}) — Visit #${result.teacher.visit_count}.`
    );
    res.json({
      ...result,
      memberType: 'teacher',
      member: {
        id: result.teacher.id,
        code: result.teacher.employee_id,
        full_name: result.teacher.full_name,
        program: result.teacher.program,
        department: result.teacher.department,
        subLabel: result.teacher.designation,
        visit_count: result.teacher.visit_count,
      },
    });
    return;
  }

  res.status(404).json({ error: `No registered student or faculty member found for ID ${parsed.prn}.` });
});

// --- Admin Analytics, Logs, Frequency Tracker & Reporting ---
app.get('/api/admin/dashboard', requireAdmin, (req, res) => {
  const program = typeof req.query.program === 'string' ? req.query.program : 'ALL';
  const department = typeof req.query.department === 'string' ? req.query.department : 'ALL';
  const session = typeof req.query.session === 'string' ? req.query.session : 'ALL';
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

  const t0 = performance.now();

  let studentSql = `SELECT id, prn, full_name, email, program, department, academic_year, phone, qr_token, visit_count, total_minutes, currently_inside, last_entry_at, created_at FROM students WHERE 1=1`;
  const studentParams: string[] = [];
  if (program === 'Degree' || program === 'Diploma') {
    studentSql += ` AND program = ?`;
    studentParams.push(program);
  }
  if (department && department !== 'ALL') {
    studentSql += ` AND department = ?`;
    studentParams.push(department);
  }
  if (search) {
    studentSql += ` AND (prn LIKE ? OR full_name LIKE ? OR department LIKE ?)`;
    const pat = `%${search}%`;
    studentParams.push(pat, pat, pat);
  }
  studentSql += ` ORDER BY visit_count DESC, full_name ASC LIMIT 500`;
  const students = db.prepare(studentSql).all(...studentParams);

  let logSql = `SELECT * FROM library_logs WHERE 1=1`;
  const logParams: string[] = [];
  if (program === 'Degree' || program === 'Diploma') {
    logSql += ` AND program = ?`;
    logParams.push(program);
  }
  if (department && department !== 'ALL') {
    logSql += ` AND department = ?`;
    logParams.push(department);
  }
  if (session !== 'ALL') {
    logSql += ` AND academic_session = ?`;
    logParams.push(session);
  }
  if (search) {
    logSql += ` AND (prn LIKE ? OR student_name LIKE ? OR department LIKE ?)`;
    const pat = `%${search}%`;
    logParams.push(pat, pat, pat);
  }
  logSql += ` ORDER BY entry_time DESC LIMIT 300`;
  const logs = db.prepare(logSql).all(...logParams) as LibraryLogRow[];

  const deptBreakdown = db
    .prepare(`
      SELECT program, department, COUNT(*) as students, SUM(visit_count) as visits, SUM(currently_inside) as active_inside
      FROM students
      GROUP BY program, department
      ORDER BY visits DESC
    `)
    .all();

  const hourlyBuckets = db
    .prepare(`
      SELECT strftime('%H', entry_time) as hour, COUNT(*) as entries,
        SUM(CASE WHEN program = 'Degree' THEN 1 ELSE 0 END) as degree_entries,
        SUM(CASE WHEN program = 'Diploma' THEN 1 ELSE 0 END) as diploma_entries
      FROM library_logs
      GROUP BY hour
      ORDER BY hour ASC
    `)
    .all();

  let teacherSql = `SELECT id, employee_id, full_name, email, program, department, designation, phone, qr_token, visit_count, total_minutes, currently_inside, last_entry_at, created_at FROM teachers WHERE 1=1`;
  const teacherParams: string[] = [];
  if (program === 'Degree' || program === 'Diploma') {
    teacherSql += ` AND program = ?`;
    teacherParams.push(program);
  }
  if (department && department !== 'ALL') {
    teacherSql += ` AND department = ?`;
    teacherParams.push(department);
  }
  if (search) {
    teacherSql += ` AND (employee_id LIKE ? OR full_name LIKE ? OR department LIKE ? OR designation LIKE ?)`;
    const pat = `%${search}%`;
    teacherParams.push(pat, pat, pat, pat);
  }
  teacherSql += ` ORDER BY visit_count DESC, full_name ASC LIMIT 300`;
  const teachers = db.prepare(teacherSql).all(...teacherParams);

  let teacherLogSql = `SELECT * FROM teacher_logs WHERE 1=1`;
  const teacherLogParams: string[] = [];
  if (program === 'Degree' || program === 'Diploma') {
    teacherLogSql += ` AND program = ?`;
    teacherLogParams.push(program);
  }
  if (department && department !== 'ALL') {
    teacherLogSql += ` AND department = ?`;
    teacherLogParams.push(department);
  }
  if (session !== 'ALL') {
    teacherLogSql += ` AND academic_session = ?`;
    teacherLogParams.push(session);
  }
  if (search) {
    teacherLogSql += ` AND (employee_id LIKE ? OR teacher_name LIKE ? OR department LIKE ?)`;
    const pat = `%${search}%`;
    teacherLogParams.push(pat, pat, pat);
  }
  teacherLogSql += ` ORDER BY entry_time DESC LIMIT 300`;
  const teacherLogs = db.prepare(teacherLogSql).all(...teacherLogParams) as TeacherLogRow[];

  const notifications = db
    .prepare(`SELECT * FROM notification_events ORDER BY created_at DESC LIMIT 30`)
    .all() as NotificationRow[];

  const reportConfig = db.prepare(`SELECT * FROM report_config WHERE id = 1`).get() as ReportConfigRow;
  const backups = db.prepare(`SELECT * FROM cloud_backups ORDER BY created_at DESC LIMIT 15`).all() as CloudBackupRow[];
  const outbox = db.prepare(`SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 10`).all();

  const queryTimeMs = Math.round((performance.now() - t0) * 100) / 100;

  res.json({
    queryTimeMs,
    activeSession: getAcademicSession(),
    students,
    logs,
    teachers,
    teacherLogs,
    deptBreakdown,
    hourlyBuckets,
    notifications,
    reportConfig,
    backups,
    outbox,
  });
});

app.post('/api/admin/students', requireAdmin, (req, res) => {
  const { prn, fullName, email, password, program, department, academicYear, phone } = req.body || {};
  const cleanPrn = String(prn || '').trim().toUpperCase();
  const cleanName = String(fullName || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanDept = String(department || '').trim();

  if (!/^[A-Z0-9-]{4,32}$/.test(cleanPrn) || !isValidEmail(cleanEmail) || cleanName.length < 2) {
    res.status(400).json({ error: 'Valid PRN, full name, and email are required.' });
    return;
  }
  if (program !== 'Degree' && program !== 'Diploma') {
    res.status(400).json({ error: 'Program must be Degree or Diploma.' });
    return;
  }
  const cleanYear = normalizeAcademicYear(academicYear, program) || '1st Year';
  const initialPassword = password && isStrongPassword(password) ? password : `Diet@${cleanPrn.slice(-4)}2026`;
  const existing = db.prepare('SELECT id FROM students WHERE prn = ? OR email = ?').get(cleanPrn, cleanEmail);
  if (existing) {
    res.status(409).json({ error: 'Student with this PRN or email already exists.' });
    return;
  }

  const studentId = `stu_${crypto.randomUUID().slice(0, 12)}`;
  db.prepare(`
    INSERT INTO students (
      id, prn, full_name, email, password_hash, program, department, academic_year,
      phone, qr_token, mfa_secret, mfa_enabled, visit_count, total_minutes,
      currently_inside, last_entry_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 0, NULL, ?)
  `).run(
    studentId,
    cleanPrn,
    cleanName,
    cleanEmail,
    hashPassword(initialPassword),
    program,
    cleanDept,
    cleanYear,
    phone ? String(phone).slice(0, 20) : null,
    signQrPayload(cleanPrn),
    generateBase32Secret(),
    new Date().toISOString()
  );

  res.status(201).json({ id: studentId, prn: cleanPrn });
});

app.get('/api/admin/students/:studentId/logs', requireAdmin, (req, res) => {
  const logs = db
    .prepare('SELECT * FROM library_logs WHERE student_id = ? ORDER BY entry_time DESC LIMIT 200')
    .all(req.params.studentId);
  res.json({ logs });
});

app.post('/api/admin/teachers', requireAdmin, (req, res) => {
  const { employeeId, fullName, email, password, program, department, designation, phone } = req.body || {};
  const cleanEmpId = String(employeeId || '').trim().toUpperCase();
  const cleanName = String(fullName || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanDept = String(department || '').trim();
  const cleanDesig = String(designation || 'Assistant Professor').trim();

  if (!/^[A-Z0-9-]{4,32}$/.test(cleanEmpId) || !isValidEmail(cleanEmail) || cleanName.length < 2) {
    res.status(400).json({ error: 'Valid Employee ID, full name, and email are required.' });
    return;
  }
  if (program !== 'Degree' && program !== 'Diploma') {
    res.status(400).json({ error: 'Program must be Degree or Diploma.' });
    return;
  }
  const initialPassword = password && isStrongPassword(password) ? password : `DietTch@${cleanEmpId.slice(-4)}2026`;
  const existing = db.prepare('SELECT id FROM teachers WHERE employee_id = ? OR email = ?').get(cleanEmpId, cleanEmail);
  if (existing) {
    res.status(409).json({ error: 'Faculty member with this Employee ID or email already exists.' });
    return;
  }

  const teacherId = `tch_${crypto.randomUUID().slice(0, 12)}`;
  db.prepare(`
    INSERT INTO teachers (
      id, employee_id, full_name, email, password_hash, program, department, designation,
      phone, qr_token, mfa_secret, mfa_enabled, visit_count, total_minutes,
      currently_inside, last_entry_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 0, NULL, ?)
  `).run(
    teacherId,
    cleanEmpId,
    cleanName,
    cleanEmail,
    hashPassword(initialPassword),
    program,
    cleanDept,
    cleanDesig,
    phone ? String(phone).slice(0, 20) : null,
    signTeacherQrPayload(cleanEmpId),
    generateBase32Secret(),
    new Date().toISOString()
  );

  res.status(201).json({ id: teacherId, employeeId: cleanEmpId });
});

app.get('/api/admin/teachers/:teacherId/logs', requireAdmin, (req, res) => {
  const logs = db
    .prepare('SELECT * FROM teacher_logs WHERE teacher_id = ? ORDER BY entry_time DESC LIMIT 200')
    .all(req.params.teacherId);
  res.json({ logs });
});

app.get('/api/reports/export.xlsx', requireAdmin, async (req, res) => {
  const program = typeof req.query.program === 'string' ? req.query.program : 'ALL';
  const department = typeof req.query.department === 'string' ? req.query.department : 'ALL';
  const session = typeof req.query.session === 'string' ? req.query.session : 'ALL';
  const buffer = await generateLibraryExcelBuffer({ program, department, session });
  const dateStamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="DIET_Library_Report_${program}_${dateStamp}.xlsx"`);
  res.send(buffer);
});

app.put('/api/admin/report-config', requireAdmin, (req, res) => {
  const { recipientEmail, scheduleDay, scheduleTime, ntfyTopic, enabled } = req.body || {};
  const cleanEmail = String(recipientEmail || '').trim().toLowerCase();
  if (!isValidEmail(cleanEmail)) {
    res.status(400).json({ error: 'Valid recipient email required.' });
    return;
  }
  const cleanDay = String(scheduleDay || 'Monday');
  const cleanTime = String(scheduleTime || '08:30').slice(0, 5);
  const cleanTopic = String(ntfyTopic || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
  db.prepare(`
    UPDATE report_config
    SET recipient_email = ?, schedule_day = ?, schedule_time = ?, ntfy_topic = ?, enabled = ?
    WHERE id = 1
  `).run(cleanEmail, cleanDay, cleanTime, cleanTopic, enabled ? 1 : 0);
  res.json({ saved: true });
});

app.post('/api/admin/send-weekly-report', requireAdmin, async (_req, res) => {
  const result = await dispatchWeeklyReport('manual');
  res.json(result);
});

app.post('/api/admin/test-notification', requireAdmin, async (req, res) => {
  const { ntfyTopic } = req.body || {};
  const nowIso = new Date().toISOString();
  db.prepare(`
    INSERT INTO notification_events (id, type, title, message, program, created_at, is_read)
    VALUES (?, 'SYSTEM', 'Mobile Notification Test', 'Verified push channel for Dnyanshree Central Library Admin.', NULL, ?, 0)
  `).run(`notif_${crypto.randomUUID().slice(0, 10)}`, nowIso);
  const push = await sendMobilePushNotification(
    'DIET Library Alert Test',
    'Mobile notifications for Dnyanshree Central Library are active.',
    typeof ntfyTopic === 'string' ? ntfyTopic : undefined
  );
  res.json(push);
});

app.post('/api/admin/backups', requireAdmin, (req: AuthenticatedRequest, res) => {
  const studentCount = (db.prepare('SELECT COUNT(*) as c FROM students').get() as { c: number }).c;
  const teacherCount = (db.prepare('SELECT COUNT(*) as c FROM teachers').get() as { c: number }).c;
  const logCount = (db.prepare('SELECT COUNT(*) as c FROM library_logs').get() as { c: number }).c;
  const teacherLogCount = (db.prepare('SELECT COUNT(*) as c FROM teacher_logs').get() as { c: number }).c;
  const nowIso = new Date().toISOString();
  const backupId = `bkp_${Date.now()}`;

  const payload = {
    backupId,
    institution: 'Dnyanshree Institute of Engineering and Technology, Satara',
    createdAt: nowIso,
    students: db.prepare('SELECT id, prn, full_name, program, department, academic_year, visit_count, total_minutes FROM students').all(),
    teachers: db.prepare('SELECT id, employee_id, full_name, program, department, designation, visit_count, total_minutes FROM teachers').all(),
    logs: db.prepare('SELECT * FROM library_logs ORDER BY entry_time DESC').all(),
    teacherLogs: db.prepare('SELECT * FROM teacher_logs ORDER BY entry_time DESC').all(),
  };

  const totalLogs = logCount + teacherLogCount;
  const jsonStr = JSON.stringify(payload);
  const checksum = crypto.createHash('sha256').update(jsonStr).digest('hex').slice(0, 16);
  const fileSizeKb = Math.round((Buffer.byteLength(jsonStr, 'utf8') / 1024) * 10) / 10;
  const backupDir = path.resolve(process.cwd(), 'data', 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(backupDir, `${backupId}.json`), jsonStr, 'utf8');

  db.prepare(`
    INSERT INTO cloud_backups (id, created_by, student_count, log_count, academic_range, checksum, file_size_kb, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(backupId, req.user?.email || 'admin', studentCount + teacherCount, totalLogs, getAcademicSession(), checksum, fileSizeKb, nowIso);

  db.prepare(`
    INSERT INTO notification_events (id, type, title, message, program, created_at, is_read)
    VALUES (?, 'BACKUP', 'Archival Snapshot Created', ?, NULL, ?, 0)
  `).run(
    `notif_${crypto.randomUUID().slice(0, 10)}`,
    `Archived ${studentCount} student + ${teacherCount} faculty profiles and ${totalLogs} entry logs (SHA-256: ${checksum}).`,
    nowIso
  );

  res.status(201).json({ backupId, checksum, studentCount: studentCount + teacherCount, logCount: totalLogs, fileSizeKb, createdAt: nowIso });
});

app.get('/api/admin/backups/:backupId/download', requireAdmin, (req, res) => {
  const safeId = String(req.params.backupId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const backupDir = path.resolve(process.cwd(), 'data', 'backups');
  const resolved = path.resolve(backupDir, `${safeId}.json`);
  if (!resolved.startsWith(backupDir + path.sep) || !fs.existsSync(resolved)) {
    res.status(404).json({ error: 'Backup snapshot file not found' });
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${safeId}.json"`);
  res.sendFile(resolved);
});

app.post('/api/admin/notifications/mark-read', requireAdmin, (_req, res) => {
  db.prepare('UPDATE notification_events SET is_read = 1 WHERE is_read = 0').run();
  res.json({ ok: true });
});

// --- Weekly Scheduled Email Cron Check (every 5 minutes) ---
let lastCronSlot = '';
setInterval(() => {
  try {
    const cfg = db.prepare('SELECT * FROM report_config WHERE id = 1').get() as ReportConfigRow | undefined;
    if (!cfg || cfg.enabled !== 1) return;
    const now = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDay = days[now.getDay()];
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const slotKey = `${now.toISOString().slice(0, 10)}-${hhmm}`;
    if (currentDay === cfg.schedule_day && hhmm === cfg.schedule_time && lastCronSlot !== slotKey) {
      lastCronSlot = slotKey;
      dispatchWeeklyReport('scheduled').catch(console.error);
    }
  } catch (err) {
    console.error('Weekly report scheduler check error:', err);
  }
}, 60_000);

// --- Server Startup with Vite Dev Middleware or Static Production ---
async function startServer() {
  const port = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Dnyanshree Library Server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
