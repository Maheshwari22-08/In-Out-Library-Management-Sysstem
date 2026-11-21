# Security Specification — Dnyanshree Central Library System

## 1. Data Invariants
1. **Identity Integrity**: No student can create or update a `StudentProfile` or `LibraryLog` claiming another user's `uid` or `studentUid`.
2. **PII Isolation**: Student email, phone, and MFA state are stored strictly under `/students/{studentId}/private/contact` and never exposed to non-owners or unauthenticated callers.
3. **Terminal State Locking**: Once a `LibraryLog` reaches `status: "COMPLETED"` (check-out recorded), students cannot reopen or mutate `durationMinutes`, `entryTime`, or `exitTime`. Only verified admins may correct records.
4. **Immutable Audit Fields**: `createdAt`, `uid`, `studentUid`, and `logId` cannot be changed after creation.
5. **Temporal Integrity**: All `createdAt` and `updatedAt` timestamps must equal `request.time`.
6. **Privilege Escalation Prevention**: Only the bootstrapped head librarian (`mahipawar295@gmail.com` with `email_verified == true`) or an existing admin can write to `/admins/{adminId}`, `/backups/{backupId}`, or `/reportSchedules/{scheduleId}`.

## 2. Dirty Dozen Adversarial Payloads
1. **Shadow Admin Injection**: Student writes `{ "uid": "stu1", "role": "admin" }` to `/admins/stu1` -> DENIED.
2. **Ghost Field Stuffing**: Student adds `{ "isExempt": true }` to `/students/stu1` -> DENIED (`keys().hasOnly()`).
3. **Unverified Email Spoofing**: Caller with `email: "mahipawar295@gmail.com"` and `email_verified: false` reads `/admins/admin1` -> DENIED.
4. **Cross-Student PII Read**: Student A reads `/students/studentB/private/contact` -> DENIED.
5. **Unbounded ID Poisoning**: Caller attempts write to `/libraryLogs/aaa...(150 chars)` -> DENIED (`isValidId()`).
6. **Log Ownership Spoofing**: Student A creates `/libraryLogs/log99` with `studentUid: "studentB"` -> DENIED.
7. **Post-Checkout Tampering**: Student updates `/libraryLogs/log1` after `status == "COMPLETED"` to alter `durationMinutes` -> DENIED.
8. **Backdated Timestamp Attack**: Student creates log with `createdAt: "2018-01-01T00:00:00Z"` instead of `request.time` -> DENIED.
9. **Blanket List Scraping**: Student runs `getDocs(collection(db, "libraryLogs"))` without filtering `where("studentUid", "==", auth.uid)` -> DENIED.
10. **Program Enum Injection**: Student sets `program: "PhD_Invalid"` -> DENIED.
11. **Oversized String Exhaustion**: Student submits `fullName` of 5,000 chars -> DENIED (`.size() <= 100`).
12. **Unauthorized Backup Deletion**: Non-admin attempts `deleteDoc(doc(db, "backups", "bkp1"))` -> DENIED.
