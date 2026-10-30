import { and, asc, count, eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/client.js';
import { staffUsers } from '../db/schema/index.js';

export type StaffRole = 'admin' | 'sales';
export type StaffRow = typeof staffUsers.$inferSelect;

export type PublicStaff = {
  id: string;
  email: string;
  displayName: string;
  role: StaffRole;
  isActive: boolean;
  createdAt: Date;
};

function toPublic(row: StaffRow): PublicStaff {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role as StaffRole,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}

export async function findStaffByEmail(email: string): Promise<StaffRow | null> {
  const [row] = await getDb().select().from(staffUsers).where(eq(staffUsers.email, email.toLowerCase())).limit(1);
  return row ?? null;
}

export async function findStaffById(id: string): Promise<StaffRow | null> {
  const [row] = await getDb().select().from(staffUsers).where(eq(staffUsers.id, id)).limit(1);
  return row ?? null;
}

export async function getPublicStaff(id: string): Promise<PublicStaff | null> {
  const row = await findStaffById(id);
  return row ? toPublic(row) : null;
}

export async function listStaff(): Promise<PublicStaff[]> {
  const rows = await getDb().select().from(staffUsers).orderBy(asc(staffUsers.createdAt));
  return rows.map(toPublic);
}

export async function countStaff(): Promise<number> {
  const [row] = await getDb().select({ n: count() }).from(staffUsers);
  return row?.n ?? 0;
}

export async function countActiveAdmins(): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(staffUsers)
    .where(and(eq(staffUsers.role, 'admin'), eq(staffUsers.isActive, true)));
  return row?.n ?? 0;
}

export async function createStaff(data: {
  email: string;
  password: string;
  displayName: string;
  role: StaffRole;
}): Promise<PublicStaff> {
  const passwordHash = await bcrypt.hash(data.password, 12);
  const [row] = await getDb()
    .insert(staffUsers)
    .values({ email: data.email.toLowerCase(), passwordHash, displayName: data.displayName, role: data.role })
    .returning();
  if (!row) throw new Error('Failed to create staff user');
  return toPublic(row);
}

export async function updateStaff(
  id: string,
  patch: { displayName?: string; role?: StaffRole; isActive?: boolean }
): Promise<PublicStaff | null> {
  const set: Partial<typeof staffUsers.$inferInsert> = {};
  if (patch.displayName !== undefined) set.displayName = patch.displayName;
  if (patch.role !== undefined) set.role = patch.role;
  if (patch.isActive !== undefined) set.isActive = patch.isActive;
  if (Object.keys(set).length === 0) {
    const row = await findStaffById(id);
    return row ? toPublic(row) : null;
  }
  const [row] = await getDb().update(staffUsers).set(set).where(eq(staffUsers.id, id)).returning();
  return row ? toPublic(row) : null;
}

export async function setStaffPassword(id: string, password: string): Promise<void> {
  const passwordHash = await bcrypt.hash(password, 12);
  await getDb().update(staffUsers).set({ passwordHash }).where(eq(staffUsers.id, id));
}
