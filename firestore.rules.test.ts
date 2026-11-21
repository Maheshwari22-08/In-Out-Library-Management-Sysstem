/**
 * Verification suite specification for the Dirty Dozen security invariants
 * targeting firestore.rules for Dnyanshree Central Library.
 */
export interface AdversarialPayloadCase {
  id: string;
  name: string;
  collectionPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expected: 'PERMISSION_DENIED';
  payload?: Record<string, unknown>;
}

export const DIRTY_DOZEN_CASES: AdversarialPayloadCase[] = [
  {
    id: 'DD-01',
    name: 'Shadow Admin Injection',
    collectionPath: 'admins/stu1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { uid: 'stu1', email: 'stu1@dnyanshree.edu.in', fullName: 'Rogue', role: 'head_librarian' }
  },
  {
    id: 'DD-02',
    name: 'Ghost Field Stuffing on StudentProfile',
    collectionPath: 'students/stu1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { uid: 'stu1', prn: 'DIET202601', fullName: 'Test', program: 'Degree', isAdminBypass: true }
  },
  {
    id: 'DD-03',
    name: 'Unverified Email Spoofing',
    collectionPath: 'admins/admin1',
    operation: 'get',
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 'DD-04',
    name: 'Cross-Student PII Read',
    collectionPath: 'students/studentB/private/contact',
    operation: 'get',
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 'DD-05',
    name: 'Unbounded ID Poisoning',
    collectionPath: `libraryLogs/${'A'.repeat(140)}`,
    operation: 'create',
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 'DD-06',
    name: 'Log Ownership Spoofing',
    collectionPath: 'libraryLogs/log_spoof',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { logId: 'log_spoof', studentUid: 'victim_uid', status: 'INSIDE' }
  },
  {
    id: 'DD-07',
    name: 'Post-Checkout Duration Tampering',
    collectionPath: 'libraryLogs/log_completed',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: { durationMinutes: 9999 }
  },
  {
    id: 'DD-08',
    name: 'Backdated Timestamp Attack',
    collectionPath: 'libraryLogs/log_backdate',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { createdAt: '2019-01-01T00:00:00Z' }
  },
  {
    id: 'DD-09',
    name: 'Blanket LibraryLogs List Scraping',
    collectionPath: 'libraryLogs',
    operation: 'list',
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 'DD-10',
    name: 'Invalid Program Enum Injection',
    collectionPath: 'students/stu1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { program: 'UnknownProgram' }
  },
  {
    id: 'DD-11',
    name: 'Oversized String Exhaustion',
    collectionPath: 'students/stu1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: { fullName: 'X'.repeat(500) }
  },
  {
    id: 'DD-12',
    name: 'Unauthorized Backup Deletion',
    collectionPath: 'backups/bkp_001',
    operation: 'delete',
    expected: 'PERMISSION_DENIED'
  }
];
