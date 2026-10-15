export function generatePassword(length?: number): string;
export function hashPassword(password: string): Promise<{ hash: string; salt: string }>;
export function buildAdminSql(options: {
  username: string;
  password: string;
  displayName?: string;
  now?: Date;
}): Promise<string>;
