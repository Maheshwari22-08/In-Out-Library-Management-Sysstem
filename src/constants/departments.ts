export const DEGREE_DEPARTMENTS: string[] = [
  'Computer Science & Engineering',
  'AI & DS Engineering',
  'Civil & Environmental Engineering',
  'Electrical & Computer Engineering',
  'Electronics & Telecommunication Engineering',
  'Mechanical & Mechatronics Engineering',
  'Applied Sciences & Engineering',
];

export const DIPLOMA_DEPARTMENTS: string[] = [
  'Computer Science & Engineering',
  'Electronics & Telecommunication Engineering',
  'Mechanical Engineering',
  'Applied Sciences & Engineering',
];

export const DEGREE_YEARS: string[] = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
export const DIPLOMA_YEARS: string[] = ['1st Year', '2nd Year', '3rd Year'];

export const TEACHER_DESIGNATIONS: string[] = [
  'Professor',
  'Associate Professor',
  'Assistant Professor',
  'HOD',
  'Senior Lecturer',
  'Lecturer',
  'Lab Assistant',
];

export const ALL_UNIQUE_DEPARTMENTS: string[] = Array.from(
  new Set([...DEGREE_DEPARTMENTS, ...DIPLOMA_DEPARTMENTS])
);

export function getDepartmentsForProgram(program: 'ALL' | 'Degree' | 'Diploma'): string[] {
  if (program === 'Degree') return [...DEGREE_DEPARTMENTS];
  if (program === 'Diploma') return [...DIPLOMA_DEPARTMENTS];
  return ALL_UNIQUE_DEPARTMENTS;
}
