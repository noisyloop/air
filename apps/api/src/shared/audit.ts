import { prisma } from './prisma.js';

interface AuditInput {
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

/** Fire-and-forget audit logging — never fails the calling request. */
export function audit(input: AuditInput): void {
  void prisma.auditLog
    .create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: input.metadata as never,
        ip: input.ip,
      },
    })
    .catch(() => undefined);
}
