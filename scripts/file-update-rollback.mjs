import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const defaultOperations = { mkdir, rename, rm, writeFile };

export async function replaceFilesWithRollback(writes, operations = defaultOperations) {
  const transactionId = String(process.pid);
  const staged = writes.map((write, index) => ({
    ...write,
    temporaryPath: `${write.path}.tmp-${transactionId}-${index}`,
    backupPath: `${write.path}.bak-${transactionId}-${index}`,
  }));
  const backedUp = [];
  const committed = [];
  let rollbackFailed = false;

  try {
    await Promise.all(
      staged.map(async (write) => {
        await operations.mkdir(dirname(write.path), { recursive: true });
        await operations.writeFile(write.temporaryPath, write.content, 'utf8');
      }),
    );
    for (const write of staged) {
      try {
        await operations.rename(write.path, write.backupPath);
        backedUp.push(write);
      } catch (error) {
        // 目標檔不存在時視為新增檔案：無需備份，回復時直接刪除
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    for (const write of staged) {
      await operations.rename(write.temporaryPath, write.path);
      committed.push(write);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const write of committed.reverse()) {
      try {
        await operations.rm(write.path, { force: true });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    for (const write of backedUp.reverse()) {
      try {
        await operations.rename(write.backupPath, write.path);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    rollbackFailed = rollbackErrors.length > 0;
    if (rollbackFailed) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        `File replacement failed and rollback was incomplete: ${error instanceof Error ? error.message : error}`,
      );
    }
    throw error;
  } finally {
    await Promise.allSettled(
      staged.map((write) => operations.rm(write.temporaryPath, { force: true })),
    );
    if (!rollbackFailed) {
      await Promise.allSettled(
        backedUp.map((write) => operations.rm(write.backupPath, { force: true })),
      );
    }
  }
}
