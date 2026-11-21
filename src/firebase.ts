import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  setDoc,
  serverTimestamp,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
    return false;
  }
}

testFirestoreConnection();

export async function signInWithGoogleFirebase() {
  return signInWithPopup(auth, googleProvider);
}

export async function signOutFirebase() {
  return signOut(auth);
}

export async function syncStudentToFirestore(params: {
  prn: string;
  fullName: string;
  email: string;
  program: 'Degree' | 'Diploma';
  department: string;
  year: string;
  phone?: string;
  visitCount: number;
  totalMinutes: number;
  currentlyInside: boolean;
}) {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const studentPath = `students/${user.uid}`;
  try {
    await setDoc(
      doc(db, 'students', user.uid),
      {
        uid: user.uid,
        prn: params.prn.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32) || 'DIET2026',
        fullName: params.fullName.slice(0, 100),
        program: params.program,
        department: params.department.slice(0, 80),
        year: params.year,
        visitCount: params.visitCount,
        totalMinutes: params.totalMinutes,
        currentlyInside: params.currentlyInside,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, studentPath);
  }

  const privatePath = `students/${user.uid}/private/contact`;
  try {
    await setDoc(
      doc(db, 'students', user.uid, 'private', 'contact'),
      {
        uid: user.uid,
        email: params.email.slice(0, 160),
        phone: (params.phone || '').slice(0, 20),
        mfaEnabled: true,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, privatePath);
  }
}

export async function syncTeacherToFirestore(params: {
  employeeId: string;
  fullName: string;
  email: string;
  program: 'Degree' | 'Diploma';
  department: string;
  designation: string;
  phone?: string;
  visitCount: number;
  totalMinutes: number;
  currentlyInside: boolean;
}) {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const teacherPath = `teachers/${user.uid}`;
  try {
    await setDoc(
      doc(db, 'teachers', user.uid),
      {
        uid: user.uid,
        employeeId: params.employeeId.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32) || 'TCH2026',
        fullName: params.fullName.slice(0, 100),
        program: params.program,
        department: params.department.slice(0, 80),
        designation: params.designation.slice(0, 60),
        visitCount: params.visitCount,
        totalMinutes: params.totalMinutes,
        currentlyInside: params.currentlyInside,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, teacherPath);
  }

  const privatePath = `teachers/${user.uid}/private/contact`;
  try {
    await setDoc(
      doc(db, 'teachers', user.uid, 'private', 'contact'),
      {
        uid: user.uid,
        email: params.email.slice(0, 160),
        phone: (params.phone || '').slice(0, 20),
        mfaEnabled: true,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, privatePath);
  }
}

export async function syncCloudBackupMetaToFirestore(backup: {
  backupId: string;
  recordCount: number;
  studentCount: number;
  checksum: string;
  academicRange: string;
}) {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;
  const path = `backups/${backup.backupId}`;
  try {
    await setDoc(doc(db, 'backups', backup.backupId), {
      backupId: backup.backupId,
      createdByUid: user.uid,
      recordCount: backup.recordCount,
      studentCount: backup.studentCount,
      checksum: backup.checksum,
      academicRange: backup.academicRange,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export function subscribeToUserCloudLogs(
  uid: string,
  onUpdate: (logs: Array<Record<string, unknown>>) => void,
  onError?: (err: Error) => void
) {
  const path = 'libraryLogs';
  const q = query(
    collection(db, path),
    where('studentUid', '==', uid),
    orderBy('entryTime', 'desc'),
    limit(25)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      onUpdate(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) onError(wrapped);
      }
    }
  );
}
